/**
 * Les gestes métier — ce qu'un appel RPC EST pour le métier.
 *
 * Une étape `rpc` dit `office.forcer`. Un nom de méthode n'est pas une preuve :
 * il ne dit ni la pièce, ni l'objet, ni l'issue métier. La table de référence
 * `observabilite.gestes` dit, pour chaque méthode sensible, l'étape métier
 * qu'elle est (`forcage`), le geste (`ecriture.forcer`), le type de l'objet,
 * et où l'appel le nomme. Ce module la lit — aucune liste n'est écrite ici —
 * et émet, à la sortie de l'appel, l'étape métier : l'acteur, l'objet, l'heure,
 * l'issue (refus compris, avec sa clé), et les lignes d'`audit.event_log` qui
 * portent le changement.
 *
 * Les changements visibles des deux côtés — la PME envoie, le cabinet
 * retourne — se relient par la PIÈCE : chaque pièce que l'audit a touchée
 * reçoit son étape, et `observabilite.diagnostic_piece` les rassemble.
 *
 * Le référentiel se relit toutes les `JOURNAL_REFERENTIEL_MS` (cinq minutes) :
 * une ligne ajoutée par migration est servie sans redémarrage. Base
 * injoignable, le dernier connu vaut ; jamais lu, aucun geste ne s'émet (l'étape
 * `rpc` reste) — c'est dit dans `docs/journalisation-parcours.md`.
 */
import { lireLeReferentielDuJournal, type Requete } from "../db.ts";
import { consigner, type Issue } from "./journal.ts";
import { noterLObjet, uuidBienForme, type Trace } from "./trace.ts";

export interface Geste {
  readonly depot: string;
  readonly methode: string;
  readonly etape: string;
  readonly geste: string;
  readonly objetType: string;
  readonly objetChemin: readonly string[] | null;
  readonly dossierChemin: readonly string[] | null;
}

export interface ReferentielDuJournal {
  readonly gestes: ReadonlyMap<string, Geste>;
  /** Les étapes que l'appareil a le droit d'émettre (`emise_par_l_appareil`). */
  readonly etapesDeLAppareil: ReadonlySet<string>;
}

const VIDE: ReferentielDuJournal = { gestes: new Map(), etapesDeLAppareil: new Set() };

const delai = (): number => {
  const v = Number(process.env["JOURNAL_REFERENTIEL_MS"]);
  return Number.isInteger(v) && v > 0 ? v : 5 * 60 * 1000;
};

let connu: { valeur: ReferentielDuJournal; lu: number } | null = null;
let enLecture: Promise<ReferentielDuJournal> | null = null;

function interpreter(brut: unknown): ReferentielDuJournal {
  const r = (brut ?? {}) as { gestes?: unknown; etapesDeLAppareil?: unknown };
  const gestes = new Map<string, Geste>();
  for (const g of Array.isArray(r.gestes) ? (r.gestes as Geste[]) : []) {
    gestes.set(`${g.depot}.${g.methode}`, g);
  }
  const etapes = Array.isArray(r.etapesDeLAppareil)
    ? (r.etapesDeLAppareil as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  return { gestes, etapesDeLAppareil: new Set(etapes) };
}

/** Le référentiel, relu s'il a vieilli ; le dernier connu si la base ne répond pas. */
export function referentielDuJournal(): Promise<ReferentielDuJournal> {
  if (connu && Date.now() - connu.lu < delai()) return Promise.resolve(connu.valeur);
  enLecture ??= lireLeReferentielDuJournal()
    .then((brut) => {
      const valeur = interpreter(brut);
      connu = { valeur, lu: Date.now() };
      return valeur;
    })
    .catch((erreur: unknown) => {
      console.error("[journal] référentiel illisible :", (erreur as Error).message);
      return connu?.valeur ?? VIDE;
    })
    .finally(() => {
      enLecture = null;
    });
  return enLecture;
}

export async function gesteDe(depot: string, methode: string): Promise<Geste | null> {
  return (await referentielDuJournal()).gestes.get(`${depot}.${methode}`) ?? null;
}

/**
 * L'identifiant qu'un appel porte à un chemin (`{0}`, `{0,pieceId}`, `{0,0}`),
 * ou `null`. Seul un uuid bien formé sort : un jeton, un texte, un montant
 * restent dans l'appel.
 */
function identifiantAuChemin(
  args: readonly unknown[],
  chemin: readonly string[] | null,
): string | null {
  if (!chemin) return null;
  let valeur: unknown = args;
  for (const pas of chemin) {
    if (valeur === null || typeof valeur !== "object") return null;
    valeur = Array.isArray(valeur)
      ? /^\d+$/.test(pas)
        ? valeur[Number(pas)]
        : undefined
      : Object.hasOwn(valeur, pas)
        ? (valeur as Record<string, unknown>)[pas]
        : undefined;
  }
  return uuidBienForme(valeur);
}

const TABLE_DES_PIECES = "capture.pieces";

/*
 * Les objets qui MÈNENT à une pièce, et la lecture qui y mène. Ce n'est pas un
 * référentiel métier : c'est le schéma — une écriture porte sa pièce
 * (`socle.ecritures.piece_id`), et l'audit d'une écriture vise l'écriture, pas
 * la pièce. Sans cette lecture, `office.book` n'apparaîtrait pas dans la
 * chronologie de la pièce qu'il comptabilise.
 */
const PIECE_DE_L_OBJET: Readonly<Record<string, string>> = {
  piece: "select id::text as piece, tenant_id::text as dossier from capture.pieces where id = $1",
  ecriture:
    "select piece_id::text as piece, tenant_id::text as dossier from socle.ecritures where id = $1",
};

/**
 * La pièce d'un geste, AVANT l'appel, sous la RLS de l'appelant : si
 * l'appelant voit l'objet (la pièce, ou l'écriture qui la porte), sa pièce
 * devient celle de l'opération. Un geste refusé reste ainsi rattaché à la
 * pièce qu'il visait — la transaction annulée n'aura rien audité — sans qu'un
 * appelant puisse inscrire son geste dans la chronologie d'une pièce qu'il ne
 * voit pas. Une lecture indexée, sous un point de sauvegarde : elle ne peut
 * pas faire échouer l'appel qu'elle précède.
 */
export async function noterLaPieceDuGeste(
  db: Requete,
  geste: Geste,
  args: readonly unknown[],
): Promise<void> {
  const lecture = PIECE_DE_L_OBJET[geste.objetType];
  const objet = lecture ? identifiantAuChemin(args, geste.objetChemin) : null;
  if (!lecture || !objet) return;
  await db.query("savepoint observabilite_piece");
  try {
    const { rows } = await db.query<{ piece: string | null; dossier: string }>(lecture, [objet]);
    if (rows[0]?.piece) noterLObjet({ tenant: rows[0].dossier, piece: rows[0].piece });
    await db.query("release savepoint observabilite_piece");
  } catch {
    await db.query("rollback to savepoint observabilite_piece");
  }
}

/**
 * L'étape métier d'un appel, à sa sortie. Une étape par pièce que l'audit a
 * touchée (seize au plus, comme l'audit noté) ; sans pièce, une seule.
 *
 * Réussi, l'objet et l'action viennent de l'audit. Refusé ou en panne, rien
 * n'a été audité : l'objet est celui que l'appel nomme, la pièce celle que la
 * RLS de l'appelant a laissé voir avant l'appel (`rpc.ts`), et la clé du refus
 * est citée.
 */
export function emettreLeGeste(
  geste: Geste,
  appel: { args: readonly unknown[] },
  trace: Trace,
  sortie: { issue: Issue; codeRefus: string | null; debut: Date; dureeMs: number },
): void {
  const reussi = sortie.issue === "ok";
  const objets = reussi ? trace.objets : [];
  const pieces = [
    ...new Set(
      [
        ...objets.filter((o) => o.table === TABLE_DES_PIECES).map((o) => o.objet),
        // La pièce que la lecture d'avant l'appel a trouvée, vue par l'appelant.
        geste.objetType in PIECE_DE_L_OBJET ? trace.piece : null,
      ].filter((p): p is string => p !== null),
    ),
  ].slice(0, 16);
  const objetId =
    identifiantAuChemin(appel.args, geste.objetChemin) ??
    objets.find((o) => o.objet)?.objet ??
    null;
  const detail = {
    depot: geste.depot,
    methode: geste.methode,
    geste: geste.geste,
    action: objets[0]?.action ?? null,
    objet_type: geste.objetType,
    code_refus: sortie.codeRefus,
  };
  for (const piece of pieces.length > 0 ? pieces : [null]) {
    consigner(
      geste.etape,
      sortie.issue,
      {
        cle: `${geste.etape}:${piece ?? objetId ?? "-"}:${trace.cleDeRequete}`,
        debut: sortie.debut,
        dureeMs: sortie.dureeMs,
        piece,
        audits: reussi ? trace.audits : [],
        detail: { ...detail, objet_id: geste.objetType === "piece" && piece ? piece : objetId },
      },
      trace,
    );
  }
}
