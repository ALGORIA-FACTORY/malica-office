/**
 * 3B — Juger une pièce lue, côté serveur.
 *
 * Relit ce que la base porte — la dernière lecture, les jetons cités, le
 * paramétrage daté —, normalise les montants depuis le texte IMPRIMÉ, contrôle,
 * rend le verdict, et le pose dans `capture.analyses` (append-only : le dernier
 * passage fait foi).
 *
 * Tout passe par la connexion de l'appelant : ce que la RLS ne lui montre pas
 * n'existe pas ici, et une pièce d'un autre tenant répond comme une pièce qui
 * n'existe nulle part (D29).
 *
 * ============================================================== LE TEXTE IMPRIMÉ
 *
 * Les montants de l'extraction (« 1234.560 ») sont déjà passés par le solveur
 * de la lecture. La normalisation repart de ce que la pièce IMPRIME : les
 * jetons cités pour chaque champ, réassemblés dans leur ordre de lecture. C'est
 * ce qui règle le piège des montants coupés en deux jetons (« 1 » et
 * « 234,560 ») : ils se réunissent ici, par leurs citations.
 *
 * ============================================================== LA DATE QUI FAIT FOI
 *
 * Taux, seuils et pack se lisent à la date de la PIÈCE — à défaut, à sa date
 * de réception —, jamais à la date du jour.
 */

import type { Requete } from "../db.ts";
import { dateDeLaPiece } from "../depots/dates.ts";

/*
 * Les deux noms des matricules ne sont plus écrits ici : ils viennent de la
 * liste unique que l'invite de désignation impose au modèle. Une clé relue à
 * la main et un renommage ailleurs, et la lecture devenait muette — le sens de
 * la pièce et la détection de doublon tombaient à `null` sans que rien ne le
 * dise. C'est le motif récurrent de ce dépôt, et il se ferme par le lien.
 */
import { REFERENCES_QUI_TRANCHENT_LE_SENS } from "../fabrique/recette.ts";

import {
  controlerPiece,
  rendreVerdict,
  cleDeDoublon,
  type ContexteControle,
  type PieceAControler,
  type ResultatControle,
} from "./controles.ts";
import { normaliserMontants, type ResultatNormalisation } from "./normaliser-montants.ts";

const [NOM_MATRICULE_EMETTEUR, NOM_MATRICULE_CLIENT] = REFERENCES_QUI_TRANCHENT_LE_SENS;

/** Une règle métier qui refuse : son message va jusqu'à l'appelant. */
const refus = (message: string) => Object.assign(new Error(message), { code: "22023" });

const PARAMETRES = [
  "money.decimals",
  "lecture.confiance_reserve",
  "lecture.confiance_bloquante",
  "lecture.tolerance_arrondi_mineure",
  // Au-dela de cet ecart entre la date de la piece et sa reception, la piece
  // est SIGNALEE. Rien ne distinguait une date confirmee d une date acceptee
  // sans la lire, et une facture de janvier confirmee en mars part dans la
  // declaration de mars.
  "piece.ecart_date_jours",
] as const;

/** La bande du haut de la première page, où s'imprime le titre du document. */
export const HAUT_DE_PAGE = 0.25;

/**
 * Le paramétrage daté de la lecture : décimales, seuils de confiance,
 * tolérance d'arrondi. Un paramètre absent est une erreur, jamais un défaut.
 */
export async function lireParametres(
  db: Requete,
  pack: string,
  date: string,
): Promise<Record<(typeof PARAMETRES)[number], number>> {
  const { rows } = await db.query<{ code: string; value_num: string }>(
    `select distinct on (code) code, value_num from ref.socle_params
      where pack_version_id = $1 and code = any($2) and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)
      order by code, valid_from desc`,
    [pack, PARAMETRES, date],
  );
  const p = Object.fromEntries(rows.map((r) => [r.code, Number(r.value_num)]));
  const manquant = PARAMETRES.find((c) => !(c in p));
  if (manquant) throw refus(`Paramètre « ${manquant} » absent du paramétrage au ${date}.`);
  return p as Record<(typeof PARAMETRES)[number], number>;
}

/**
 * Les marques de devise que les lecteurs de montants retirent comme une
 * décoration : les codes ISO de `ref.devises` et les marques imprimées de
 * `ref.devises_marques` (« D.T. », « د.ت », « € »). Toutes les devises, pas
 * seulement celle du pack : une marque ne décide pas de la devise de la
 * pièce, elle dit seulement qu'un mot n'est pas un nombre. Une liste vide est
 * une erreur — sans elle, aucun « 1 234,560 DT » ne se lirait plus.
 */
export async function lireMarquesDeDevise(db: Requete): Promise<string[]> {
  const { rows } = await db.query<{ marque: string }>(
    `select code as marque from ref.devises
      union
     select marque from ref.devises_marques
      order by 1`,
  );
  if (rows.length === 0) throw new Error("Aucune marque de devise au référentiel.");
  return rows.map((r) => r.marque);
}

export interface Analyse {
  id: string;
  verdict: string;
  motifs: Array<Pick<ResultatControle, "code" | "statut" | "motif">>;
  controles: ResultatControle[];
  normalisation: ResultatNormalisation;
}

/**
 * Ce qu'une lecture porte, tel que la base le relit pour la juger.
 *
 * ================================================================= POURQUOI
 *
 * Le jugement était tissé dans les requêtes : on ne pouvait le jouer qu'avec
 * une base. Le 30 octobre 2026, il a fallu MESURER combien de pièces
 * reçoivent une écriture juste (`mesure-des-propositions.test.ts`) — sur la
 * vraie chaîne, pas sur une copie qui dériverait. La chaîne est donc coupée
 * en deux : ce qui lit (`analyserPiece`), ce qui juge (`jugerLaLecture`).
 */
export interface LectureAJuger {
  payload: PayloadLu;
  /** Le texte IMPRIMÉ d'un champ cité, jetons réassemblés ; null s'il n'est pas cité. */
  imprime: (champ: string) => string | null;
  /** Le haut de la première page, où s'imprime le titre du document. */
  titre: string | null;
  /** Le sens CONFIRMÉ par une personne, s'il l'a été. */
  sensDit: string | null;
  /** La date de la pièce : lue, à défaut donnée par une personne. */
  date: string | null;
  recueLe: string;
  confianceParChamp: Record<string, number>;
  doublonDe: string | null;
}

/** Ce que le référentiel daté dit, pour juger cette lecture-là. */
export interface ReferentielDuJugement {
  parametres: Record<(typeof PARAMETRES)[number], number>;
  marques: readonly string[];
  /** Les taux de TVA en vigueur à la date de la pièce, par code. */
  taux: ReadonlyMap<string, string>;
  /** Les droits que le paramétrage FIXE (le timbre…), en unités mineures, par code. */
  droitsFixes: ReadonlyMap<string, number>;
  tenant: ContexteControle["tenant"];
  typesDocument: ContexteControle["typesDocument"];
  mentionsObligatoires: ContexteControle["mentionsObligatoires"];
  doublonProbable: string | null;
}

/** La part de l'extraction que le jugement relit. */
export interface PayloadLu {
  issuer?: string | null;
  document_date?: string | null;
  document_kind?: string | null;
  currency?: string | null;
  lines?: Array<{ tax_code?: string | null }>;
  other_charges?: Array<{ code?: string | null }>;
  references?: Record<string, string>;
  totals?: { ttc?: string | null };
}

/** Le sens retenu : celui que la personne a dit, à défaut celui de la lecture. */
const sensRetenu = (l: Pick<LectureAJuger, "sensDit" | "payload">): string | null =>
  l.sensDit ?? l.payload.document_kind ?? null;

/**
 * Normaliser les montants d'une lecture, depuis le texte IMPRIMÉ de ses
 * champs cités et le référentiel daté. Pure.
 */
function normaliserLaLecture(l: LectureAJuger, r: ReferentielDuJugement): ResultatNormalisation {
  const { payload, imprime: brut } = l;
  const p = r.parametres;
  const lignes = payload.lines ?? [];
  const droits = payload.other_charges ?? [];
  const nbAutres = droits.length;
  const sansTaux = lignes.find((x) => !x.tax_code || !r.taux.has(x.tax_code));
  const dateRef = l.date ?? l.recueLe;

  if (lignes.length === 0 || sansTaux)
    return {
      etat: "illisible",
      montants: {
        bases: lignes.map(() => ({ ht: null, taux: "" })),
        tva: null,
        autres: Array.from({ length: nbAutres }, () => null),
        ttc: null,
      },
      /*
       * Ce que la pièce imprime, même ici — surtout ici.
       *
       * Ce court-circuit se déclenche quand aucune base par taux n'est
       * lisible, ou quand un code de taux est inconnu du paramétrage. La
       * pièce, elle, continue d'imprimer ses totaux : les déclarer absents
       * ajouterait un reproche faux à un reproche juste (5 octobre 2026).
       *
       * Sans ligne par taux, la base imprimée est le HT global du pied :
       * une facture qui ne ventile pas sa TVA porte quand même sa base.
       */
      imprime: {
        bases:
          lignes.length === 0
            ? [brut("totals.base_ht")]
            : lignes.map(
                (_, i) =>
                  brut(`lines[${i}].base_ht`) ??
                  (lignes.length === 1 ? brut("totals.base_ht") : null),
              ),
        tva: brut("totals.vat"),
        autres: droits.map((_, i) => brut(`other_charges[${i}].amount`)),
        ttc: brut("totals.ttc"),
      },
      confiance: 0,
      conventions: [],
      lecturesValides: 0,
      /*
       * Aucun total n'a été écarté ici : ce court-circuit tombe AVANT
       * qu'on tente la moindre lecture de montant. Dire le contraire
       * ferait porter à la pièce un défaut qu'elle n'a pas.
       */
      totalNonLu: null,
      ligneNonLue: null,
      deduits: [],
      raison:
        lignes.length === 0
          ? "aucune base par taux n'a été lue"
          : `taux « ${sansTaux?.tax_code ?? "—"} » inconnu du paramétrage au ${dateRef}`,
    };

  return normaliserMontants(
    {
      bases: lignes.map((x, i) => ({
        ht: brut(`lines[${i}].base_ht`) ?? (lignes.length === 1 ? brut("totals.base_ht") : null),
        taux: r.taux.get(x.tax_code!)!,
        // Le HT du pied, si la ligne ne se lit pas (29 octobre 2026).
        pied: lignes.length === 1 ? brut("totals.base_ht") : null,
      })),
      tva: brut("totals.vat"),
      autres: droits.flatMap((d, i) => {
        const b = brut(`other_charges[${i}].amount`);
        if (b === null) return [];
        const attendu = d.code ? r.droitsFixes.get(d.code) : undefined;
        return [attendu === undefined ? b : { brut: b, attendu }];
      }),
      ttc: brut("totals.ttc"),
    },
    {
      decimales: p["money.decimals"],
      marques: r.marques,
      toleranceMineure: p["lecture.tolerance_arrondi_mineure"],
    },
  );
}

/**
 * Juger une lecture : ses montants normalisés, ses contrôles motivés, son
 * verdict. Pure — c'est la chaîne même qu'`analyserPiece` pose en base.
 */
export function jugerLaLecture(
  l: LectureAJuger,
  r: ReferentielDuJugement,
): {
  normalisation: ResultatNormalisation;
  controles: ResultatControle[];
  verdict: string;
  motifs: Analyse["motifs"];
} {
  const normalisation = normaliserLaLecture(l, r);
  const refs = l.payload.references ?? {};
  const aControler: PieceAControler = {
    documentKind: sensRetenu(l),
    titre: l.titre,
    emetteur: {
      nom: l.payload.issuer || null,
      identifiantFiscal: refs[NOM_MATRICULE_EMETTEUR] ?? null,
    },
    destinataire: { nom: null, identifiantFiscal: refs[NOM_MATRICULE_CLIENT] ?? null },
    numero: refs["numero"] ?? null,
    date: l.date,
    montants: normalisation,
    confianceParChamp: l.confianceParChamp,
    reception: { doublonDe: l.doublonDe, recueLe: l.recueLe },
    // Le sens CONFIRMÉ par la personne (20 octobre 2026), qu'il redise la
    // lecture ou la corrige : c'est lui qui est retenu (voir plus haut).
    sensConfirme: l.sensDit !== null,
  };
  const contexte: ContexteControle = {
    tenant: r.tenant,
    typesDocument: r.typesDocument,
    mentionsObligatoires: r.mentionsObligatoires,
    seuilConfianceReserve: r.parametres["lecture.confiance_reserve"],
    seuilConfianceBloquant: r.parametres["lecture.confiance_bloquante"],
    ecartDateJours: r.parametres["piece.ecart_date_jours"],
    doublonProbable: r.doublonProbable,
  };
  const controles = controlerPiece(aControler, contexte);
  const { verdict, motifs } = rendreVerdict(controles);
  return { normalisation, controles, verdict, motifs };
}

export async function analyserPiece(db: Requete, pieceId: string): Promise<Analyse> {
  const { rows: pieces } = await db.query<{
    tenant_id: string;
    doublon_de: string | null;
    recue_le: string;
    document_kind: string | null;
    document_kind_statut: string;
  }>(
    `select tenant_id, doublon_de, to_char(created_at, 'YYYY-MM-DD') as recue_le,
            document_kind, document_kind_statut
       from capture.pieces where id = $1`,
    [pieceId],
  );
  const piece = pieces[0];
  if (!piece) throw new Error("piece.introuvable");

  const { rows: extractions } = await db.query<{
    id: string;
    payload: Record<string, unknown>;
    confiance_par_champ: Record<string, number>;
  }>(
    `select id, payload, confiance_par_champ from capture.extractions
      where piece_id = $1 order by created_at desc limit 1`,
    [pieceId],
  );
  const extraction = extractions[0];
  if (!extraction) throw refus("Cette pièce n'a pas encore été lue : il n'y a rien à juger.");
  const payload = extraction.payload as PayloadLu;
  /*
   * LE SENS DIT PAR LA PERSONNE L'EMPORTE SUR LE SENS LU (21 octobre 2026).
   *
   * Recette « vie réelle », ANO-LIVE-002/004 : un ticket d'achat lu « vente »,
   * ou lu sans sens, restait bloqué même après que le dirigeant eut répondu
   * « Un achat » — sa réponse ne comptait que si elle redisait la lecture.
   * Le dirigeant sait s'il a payé ou encaissé ; la lecture le devine.
   */
  const sensDit =
    piece.document_kind_statut === "confirme" && piece.document_kind !== null
      ? piece.document_kind
      : null;

  const { rows: orgs } = await db.query<{
    name: string;
    legal_id: string | null;
    jurisdiction: string;
  }>(`select name, legal_id, jurisdiction from identity.organizations where id = $1`, [
    piece.tenant_id,
  ]);
  const org = orgs[0];
  if (!org) throw new Error("piece.introuvable");

  /*
   * La date lue d'abord ; à défaut, celle que la personne a donnée
   * (`precisions`, R7) — sans quoi une pièce datée à la main restait jugée
   * « date à saisir » et rangée au barème du jour de sa réception.
   */
  const { rows: dites } = await db.query<{ valeur: string }>(
    `select valeur from capture.precisions
      where piece_id = $1 and champ = 'document_date'
      order by decided_at desc limit 1`,
    [pieceId],
  );
  const datePiece = dateDeLaPiece(payload.document_date, dites[0]?.valeur ?? null);
  const dateRef = datePiece ?? piece.recue_le;

  const { rows: packs } = await db.query<{ id: string }>(
    `select id from ref.jurisdiction_packs
      where jurisdiction = $1 and effective_from <= $2::date
      order by effective_from desc limit 1`,
    [org.jurisdiction, dateRef],
  );
  const pack = packs[0]?.id;
  if (!pack) throw refus(`Aucun pack en vigueur pour ${org.jurisdiction} au ${dateRef}.`);

  const p = await lireParametres(db, pack, dateRef);

  /*
   * Le texte imprimé de chaque champ cité, jetons réassemblés dans l'ordre.
   *
   * ================================ UNE PROMESSE QUI N'ÉTAIT PAS TENUE
   *
   * L'en-tête de ce fichier annonce depuis le 24 août que ce mécanisme règle
   * « le piège des montants coupés en deux jetons (« 1 » et « 234,560 ») : ils
   * se réunissent ici, par leurs citations ». C'était faux, et c'est resté
   * faux six semaines.
   *
   * La requête ne joignait que `c.token_id`, soit le PREMIER jeton de la
   * plage. Il n'y avait qu'une citation par champ, donc le `join(" ")`
   * ci-dessous ne joignait jamais rien, et la normalisation recevait « 3 » là
   * où la pièce imprimait « 3 020,000 ».
   *
   * Depuis `20261005120000`, la citation porte `ordinal_end`. On joint donc
   * l'INTERVALLE, et la promesse devient un mécanisme. Pour une citation sans
   * plage, `coalesce` ramène l'intervalle au seul jeton cité : le comportement
   * des citations déjà en base ne change pas.
   */
  const { rows: cites } = await db.query<{ field: string; text: string }>(
    `select c.field, t.text
       from capture.citations c
       join capture.token_plan d on d.id = c.token_id
       join capture.token_plan t
         on t.piece_id = c.piece_id
        and t.page = d.page
        and t.ordinal between d.ordinal and coalesce(c.ordinal_end, d.ordinal)
      where c.piece_id = $1
      order by c.field, t.page, t.ordinal`,
    [pieceId],
  );
  const imprime = new Map<string, string[]>();
  for (const c of cites) imprime.set(c.field, [...(imprime.get(c.field) ?? []), c.text]);

  const { rows: haut } = await db.query<{ text: string }>(
    `select text from capture.token_plan
      where piece_id = $1 and page = (select min(page) from capture.token_plan where piece_id = $1)
        and y0 <= $2
      order by y0, x0`,
    [pieceId, HAUT_DE_PAGE],
  );

  const lecture: LectureAJuger = {
    payload,
    imprime: (champ) => imprime.get(champ)?.join(" ") ?? null,
    titre: haut.length > 0 ? haut.map((t) => t.text).join(" ") : null,
    sensDit,
    date: datePiece,
    recueLe: piece.recue_le,
    confianceParChamp: extraction.confiance_par_champ ?? {},
    doublonDe: piece.doublon_de,
  };

  // Les taux, par code, en vigueur à la date de la pièce.
  const codes = [
    ...new Set((payload.lines ?? []).map((l) => l.tax_code).filter((c): c is string => !!c)),
  ];
  const { rows: taux } = await db.query<{ code: string; rate: string }>(
    `select distinct on (code) code, rate from ref.tva_rates
      where pack_version_id = $1 and code = any($2) and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)
      order by code, valid_from desc`,
    [pack, codes, dateRef],
  );

  // Les droits fixés par le paramétrage (le droit de timbre…) : leur valeur
  // attendue ancre l'échelle des montants quand l'égalité la laisse ouverte.
  const codesDroits = [
    ...new Set(
      (payload.other_charges ?? []).map((d) => d.code).filter((c): c is string => Boolean(c)),
    ),
  ];
  const { rows: fixes } = await db.query<{ code: string; fixed_amount: string | null }>(
    `select distinct on (code) code, fixed_amount from ref.fiscal_charges
      where pack_version_id = $1 and code = any($2)
        and (document_kind = $3 or document_kind is null)
        and valid_from <= $4::date and (valid_to is null or valid_to >= $4::date)
      order by code, document_kind nulls last, valid_from desc`,
    [pack, codesDroits, sensRetenu(lecture), dateRef],
  );
  const echelleMineure = 10 ** p["money.decimals"];

  // La clé de doublon, rangée avec le jugement : la file du cabinet la relit
  // au moment où elle est lue (`app.doublon_probable`), quel que soit l'ordre
  // des lectures. Le jugement pose la même règle, avec cette clé-ci.
  const refs = payload.references ?? {};
  const cle = cleDeDoublon({
    emetteurIdentifiantFiscal: refs[NOM_MATRICULE_EMETTEUR] ?? null,
    emetteurNom: payload.issuer || null,
    numero: refs["numero"] ?? null,
    date: datePiece,
    ttc: payload.totals?.ttc ?? null,
  });

  const [{ rows: types }, { rows: mentions }, { rows: semblables }] = await Promise.all([
    db.query<{ code: string; porte_ecriture: boolean }>(
      `select code, porte_ecriture from ref.document_types`,
    ),
    db.query<{ code: string; label: string }>(
      `select code, label from ref.mentions where pack_version_id = $1 and mandatory`,
      [pack],
    ),
    db.query<{ id: string | null }>(`select app.doublon_probable_de($1, $2, $3, $4) as id`, [
      pieceId,
      cle.numero,
      cle.mf,
      cle.lu,
    ]),
  ]);

  const { normalisation, controles, verdict, motifs } = jugerLaLecture(lecture, {
    parametres: p,
    marques: await lireMarquesDeDevise(db),
    taux: new Map(taux.map((t) => [t.code, t.rate])),
    droitsFixes: new Map(
      fixes
        .filter((f) => f.fixed_amount !== null)
        .map((f) => [f.code, Math.round(Number(f.fixed_amount) * echelleMineure)]),
    ),
    tenant: { nom: org.name, identifiantFiscal: org.legal_id },
    typesDocument: types.map((t) => ({ code: t.code, porteEcriture: t.porte_ecriture })),
    mentionsObligatoires: mentions.map((m) => ({ code: m.code, libelle: m.label })),
    doublonProbable: semblables[0]?.id ?? null,
  });

  const { rows: poses } = await db.query<{ id: string }>(
    `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                   normalisation, controles, verdict, motifs,
                                   doublon_numero, doublon_mf, doublon_lu)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10, $11)
     returning id`,
    [
      piece.tenant_id,
      pieceId,
      extraction.id,
      pack,
      JSON.stringify(normalisation),
      JSON.stringify(controles),
      verdict,
      JSON.stringify(motifs),
      cle.numero,
      cle.mf,
      cle.lu,
    ],
  );

  return { id: poses[0]!.id, verdict, motifs, controles, normalisation };
}
