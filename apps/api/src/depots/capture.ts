import { enUnitesExactes } from "@malica/socle/somme-decimale";
/**
 * La capture — pièces, plan de tokens, citations, lecture citée.
 *
 * Le onzième dépôt, et le dernier. Il porte trois choses que les dix autres
 * n'avaient pas :
 *
 * 1. Un fichier. Les octets ne passent pas par `/rpc` — un flux binaire n'a
 *    rien à faire dans un appel JSON. Ils ont leur route, `/pieces/:id/contenu`.
 *    `enregistrer` ne crée donc que la ligne ; le dépôt des octets suit, et le
 *    chemin se déduit de la base, jamais du client.
 *
 * 2. Le contexte de la lecture citée. `contexteLecture` rend en un appel ce que
 *    l'ancien flux allait chercher en cinq : la pièce, son organisation, le pack
 *    en vigueur, les taux et les charges. Mêmes requêtes, mêmes tris, mêmes
 *    filtres — le transport change, pas ce que le modèle reçoit.
 *
 * 3. Le contexte de l'assistant. Même principe : `contexteAssistant` reproduit
 *    exactement les requêtes de `loadMalicaContext`.
 *
 * Ce que ce dépôt ne fait PAS : lire. Les deux passes, le plan de tokens et la
 * désignation restent côté web, où vivent l'œil et le raisonneur. L'API sert
 * les données et persiste le résultat ; elle ne pense pas à leur place.
 */

import { codeDeLecture } from "@malica/socle/issue-de-lecture";
import { refusAvecValeurs } from "@malica/socle/refus-a-dire";
import type {
  ChampObserve,
  EtatDUnTravail,
  GesteDeRetour,
  LectureObservee,
  MontantsDuCabinet,
  PieceDeMonEspace,
} from "@malica/socle/ports/repositories";

import type { Requete } from "../db.ts";
import { analyserPiece, exposantDeLaDevise, lireLesDevises } from "../scan/analyse.ts";
import { lireLesReglagesComptables } from "../scan/reglages-comptables.ts";
import { effacerContenu } from "../stockage.ts";
import { lireLesReglesDeLecture } from "../malica/lecture/regles-de-lecture.ts";

import {
  lireLeContexteDuSudoku,
  modeDuSudoku,
  type ChampsLusAInscrire,
  type ContexteDuSudokuBranche,
} from "../malica/lecture/sudoku.ts";
import { dateDeLaPiece } from "./dates.ts";
import { aujourdhui } from "./decimal.ts";
import { COLONNES_DU_CIRCUIT, COLONNES_DU_SUIVI, versCircuit, versSuivi } from "./suivi.ts";

/** Ce que la base répond sur une lecture. Le motif vient du référentiel. */
interface VerdictDeLecture {
  autorisee: boolean;
  motif: string;
  restantes: number | null;
  droit: number | null;
}

/**
 * Pourquoi la lecture de la pièce `p` a été refusée — le dernier refus inscrit
 * au journal d'audit, tant que la pièce n'a pas été lue. `motif` est le CODE de
 * la base ; l'écran le traduit, ce fichier n'écrit aucune phrase (R4).
 */
const REFUS_DE_LECTURE = `(
  select jsonb_build_object('motif', e.payload ->> 'motif', 'le', e.at)
    from event_log_v e
   where e.object_table = 'pieces' and e.object_id = p.id and e.action = 'lecture.refusee'
     and not exists (select 1 from extractions_v x where x.piece_id = p.id)
   order by e.at desc limit 1)`;

/** Une lecture à persister — la première comme une relecture retenue. */
interface LectureAPersister {
  pieceId: string;
  packId: string;
  tokens: unknown;
  contract: string;
  extract: unknown;
  citations: unknown;
  flags: unknown;
  articles: unknown[];
  documentKind: string | null;
  documentDate: string | null;
  /** Comment la pièce a été relevée (pdf-text, le modèle de vision…). Facultatif : les appels d'avant le 18 septembre ne le passaient pas. */
  mode?: string | null;
  /** La confiance de chaque champ lu, entre 0 et 1. Facultative, même raison. */
  confianceParChamp?: Record<string, number>;
}

/** Ce qu'une relecture doit savoir avant de payer un modèle. */
interface RelectureAFaire {
  pieceId: string;
  extractionId: string;
  contract: string;
  flags: Array<{ code: string }>;
  consigne: { lecteur: string; paddleTente: boolean };
  /** La raison de s'abstenir, ou nul : remplacee, lecture_depassee, correction_humaine, coupee. */
  abstention: string | null;
  /** La correction humaine trouvée (precision, ecriture, decision, retour…), ou nul. */
  trace: string | null;
}

/** Les arguments de lecture communs aux deux portes, dans leur ordre. */
function argumentsDeLecture(input: LectureAPersister): unknown[] {
  return [
    JSON.stringify(input.tokens),
    input.contract,
    JSON.stringify(input.extract),
    JSON.stringify(input.citations),
    JSON.stringify(input.flags),
    input.mode ?? null,
    JSON.stringify(input.confianceParChamp ?? {}),
  ];
}

/**
 * Projeter les articles d'une pièce — un seul endroit.
 *
 * Deux chemins y mènent : la lecture, et la date donnée à la main quand la
 * lecture n'a pas su la lire. Recopier ce corps pour le second aurait donné
 * deux imputations possibles pour la même pièce selon le chemin emprunté, et
 * c'est le genre d'écart qu'on ne voit qu'à la balance.
 */
async function projeterLesArticles(
  db: Requete,
  input: {
    pieceId: string;
    packId: string;
    articles: unknown[];
    documentKind: string | null;
    documentDate: string | null;
  },
  /**
   * Reconstruire même sans article. Une relecture retenue fait foi : si elle
   * n'en lit aucun, la projection de la lecture d'avant ne doit pas survivre à
   * l'écran des charges (la porte SQL vide, puis n'insère rien).
   */
  memeVide = false,
): Promise<void> {
  if (input.articles.length === 0 && !memeVide) return;

  // Sans sens de facture, pas de compte : on ne suppose pas « achat ». Les
  // articles sont gardés sans imputation ; elle viendra avec la précision de
  // la personne, au moment de la proposition.
  let compte: string | undefined;
  if (input.documentKind) {
    const { rows } = await db.query(
      // Une ligne par code de taxe : cinq pour un achat, cinq pour une vente,
      // et le même `main_account` sur les cinq. Sans ordre, deux bases
      // pouvaient rendre une ligne différente — et le jour où un pack
      // distinguerait l'imputation par code de taxe, l'imputation d'une pièce
      // aurait dépendu du plan d'exécution (R11).
      `select main_account from ref_account_mappings_v
        where pack_version_id = $1 and document_kind = $2
        order by main_account limit 1`,
      [input.packId, input.documentKind],
    );
    compte = (rows as Record<string, unknown>[])[0]?.["main_account"] as string | undefined;
  }

  await db.query(`select public.capture_articles_persist($1, $2, $3::date, $4, $5::jsonb)`, [
    input.pieceId,
    input.packId,
    input.documentDate ?? null,
    compte ?? null,
    JSON.stringify(input.articles),
  ]);
}

/**
 * Effacer une pièce par une porte de la base, puis ses octets.
 *
 * L'ordre compte. On lit le tenant AVANT : après, la ligne n'existe plus et
 * l'on ne saurait plus où est le fichier. Et les octets ne partent qu'une fois
 * que la base a dit oui — un refus laisse la pièce entière.
 */
async function effacerPar(
  db: Requete,
  pieceId: string,
  porte: () => Promise<{ effacee: boolean }>,
): Promise<boolean> {
  const { rows } = await db.query<{ tenant_id: string }>(
    `select tenant_id from pieces_v where id = $1`,
    [pieceId],
  );
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) return false;
  // La pièce, c'est toutes ses versions : effacée, elle part tout entière
  // (`capture_piece_supprimer`), et les octets de chacune avec elle. On les
  // nomme AVANT : après, la chaîne n'existe plus.
  const { rows: versions } = await db.query<{ id: string }>(
    `select v as id from app.versions_de_la_piece($1) v`,
    [pieceId],
  );
  // Une pièce archivée garde ses octets : le cabinet la conserve.
  if ((await porte()).effacee) {
    for (const v of versions) await effacerContenu(tenantId, v.id);
  }
  return true;
}

/** Ce que rend `public.piece_qui_accompagne` (voir la migration `20261025223000`). */
interface PieceQuiAccompagneBrute {
  genre: "recu" | "justificatif";
  vis: string;
  creeLe: string;
  mere: {
    id: string;
    typeDeDocument: string | null;
    emetteur: string | null;
    date: string | null;
    ttc: string | null;
    devise: string | null;
  } | null;
  reglements: Array<{
    id: string;
    moyenCode: string;
    montantMineur: number | string | null;
    devise: string;
    payeLe: string | null;
    eteint: boolean;
  }>;
  vaut: boolean;
  annulation: { paiementId: string; le: string; motifCode: string } | null;
  candidats: Array<{
    id: string;
    moyenCode: string;
    montantMineur: number | string | null;
    devise: string;
    payeLe: string | null;
    pieceId: string;
    tiers: string | null;
  }>;
}

function versPiece(r: Record<string, unknown>) {
  return {
    id: r["id"] as string,
    tenantId: r["tenant_id"] as string,
    entityId: (r["entity_id"] as string | null) ?? null,
    status: r["status"] as string,
    source: r["source"] as string,
    vis: r["vis"] as string,
    storagePath: r["storage_path"] as string,
    createdAt: r["created_at"] as string,
    documentKind: (r["document_kind"] as string | null) ?? null,
    documentKindStatut:
      (r["document_kind_statut"] as "a_determiner" | "a_confirmer" | "confirme" | undefined) ??
      "a_determiner",
    // `null` = la question est encore ouverte, et l'écran doit la poser.
    gardeeLe: (r["gardee_le"] as string | null) ?? null,
    transmiseLe: r["transmise_le"] ? new Date(r["transmise_le"] as string).toISOString() : null,
    sourcePieceId: (r["source_piece_id"] as string | null) ?? null,
    // La photo qu'elle remplace, et celle qui l'a remplacée (`capture.remplacements`).
    remplace: (r["remplace"] as string | null) ?? null,
    remplaceePar: (r["remplacee_par"] as string | null) ?? null,
    versionCourante: r["version_courante"] as string,
  };
}

/** Ce que rend `app.montants_pris_en_charge` : une écriture prise en charge, lue ou non. */
interface MontantsBruts {
  lisible: boolean;
  document_kind: string;
  date_ecriture: string;
  currency: string;
  totals?: { base_ht: string; vat: string; ttc: string };
  other_charges?: Array<{ code: string; amount: string }>;
}

/**
 * Les montants du cabinet, ou `null` : la PME en reçoit les totaux, les
 * droits, le sens, la date et la devise — jamais les lignes de l'écriture.
 * Une écriture qui ne se lit pas comme une facture n'en publie aucun : la
 * pièce garde sa lecture.
 */
function versMontantsDuCabinet(m: unknown): MontantsDuCabinet | null {
  if (!m || typeof m !== "object") return null;
  const b = m as MontantsBruts;
  if (!b.lisible || !b.totals) return null;
  return {
    baseHt: b.totals.base_ht,
    tva: b.totals.vat,
    ttc: b.totals.ttc,
    droits: (b.other_charges ?? []).map((d) => ({ code: d.code, amount: d.amount })),
    devise: b.currency,
    documentKind: b.document_kind,
    dateEcriture: b.date_ecriture,
  };
}

/** Forcée, mais l'écriture ne se lit pas comme une facture : le cabinet le voit. */
const ecritureIllisible = (m: unknown) =>
  Boolean(m && typeof m === "object" && (m as MontantsBruts).lisible === false);

/**
 * Les colonnes d'une pièce telles que `versPiece` les lit, préfixées de
 * l'alias de la requête quand elle en joint d'autres.
 */
function colonnesDeLaPiece(alias?: string): string {
  return [
    "id",
    "tenant_id",
    "entity_id",
    "vis",
    "source",
    "storage_path",
    "status",
    "created_at",
    "document_kind",
    "document_kind_statut",
    "gardee_le",
    "transmise_le",
    "source_piece_id",
    "remplace",
    "remplacee_par",
    "version_courante",
  ]
    .map((c) => (alias ? `${alias}.${c}` : c))
    .join(", ");
}

export const capture = {
  /**
   * Ouvre la ligne d'une pièce et rend son identifiant.
   *
   * L'ordre est inversé par rapport à l'ancien adaptateur, qui déposait le
   * fichier d'abord et enregistrait ensuite. Il le fallait : le chemin contient
   * l'identifiant, et l'identifiant naît de l'insertion. Le chemin est ensuite
   * réécrit dans la même transaction, pour que `storage_path` dise toujours la
   * vérité.
   */
  async enregistrer(
    db: Requete,
    input: {
      tenantId: string;
      entityId?: string | null;
      source: string;
      vis: string;
      idempotencyKey: string;
      contentType?: string | null;
      pageCount?: number | null;
      /**
       * Ce que la personne a DÉCLARÉ au moment de la photo.
       *
       * Déclaré, pas vérifié : le statut posé est « a_confirmer », et la
       * lecture pourra le contredire — c'est elle qui tranche, par la
       * position du matricule. Une déclaration est une intention, pas une
       * preuve.
       */
      documentKind?: string | null;
      /**
       * La pièce dont celle-ci est issue : la facture, pour un reçu de
       * paiement ou un justificatif. Sans elle, le cabinet voit un reçu
       * flottant et personne ne peut dire ce qu'il atteste.
       */
      sourcePieceId?: string | null;
      /**
       * Les règlements qu'un reçu ATTESTE — ceux que l'écran a mis dessus.
       *
       * Inscrits dans la même transaction que le reçu (`recu_attester_paiements`) :
       * un reçu sans cette liste ne saurait pas qu'il ne compte plus quand l'un
       * d'eux est annulé.
       */
      paiementsAttestes?: string[] | null;
      /**
       * La pièce que cette photo REMPLACE (« Reprendre la photo ») : la
       * nouvelle prend sa place — retour en cours, rattachements, file du
       * cabinet —, l'ancienne reste comme version précédente. Dans la même
       * transaction que l'enregistrement : une photo de remplacement ne naît
       * jamais sans lien.
       */
      remplace?: string | null;
    },
  ): Promise<{ id: string; chemin: string }> {
    // L'empreinte (`p_sha256`) reste nulle ICI : à l'enregistrement, les octets
    // ne sont pas encore arrivés. Elle est calculée sur le flux reçu et scellée
    // par la route de dépôt (stockage.ts, capture_sceller_empreinte).
    const { rows } = await db.query<{ id: string }>(
      `select public.capture_piece_register($1, $2, $3, $4, $5, $6::app.vis_t,
                                            null, $7::smallint, $8, $9) as id`,
      [
        input.tenantId,
        input.source,
        // Provisoire, réécrit juste après : la RPC exige un chemin non nul, et
        // l'identifiant qui le compose n'existe pas encore.
        `${input.tenantId}/en-cours`,
        input.idempotencyKey,
        input.entityId ?? null,
        // Une photo de remplacement naît privée : c'est `piece_remplacer` qui
        // lui donne la place de l'ancienne, sans en faire une transmission
        // nouvelle (un impayé ne l'empêche pas de corriger une pièce envoyée).
        input.remplace ? "personnel" : input.vis,
        input.pageCount ?? null,
        input.documentKind ?? null,
        input.sourcePieceId ?? null,
      ],
    );
    const id = rows[0]!.id;

    // Le chemin — dossier, puis identifiant — se pose par sa porte, qui le
    // calcule de la pièce elle-même (la clé d'idempotence peut rendre une
    // pièce déjà enregistrée : son dossier vient de la base, pas de l'appel).
    // Un client ne réécrit plus `storage_path` (lot 6, verrous en base).
    const { rows: pose } = await db.query<{ chemin: string }>(
      `select public.capture_piece_poser_chemin($1, $2) as chemin`,
      [id, input.contentType ?? null],
    );
    const chemin = pose[0]!.chemin;

    // Rejouable : la même clé rend le même reçu, et la base n'inscrit la
    // même liste qu'une fois.
    if (input.paiementsAttestes && input.paiementsAttestes.length > 0) {
      await db.query(`select public.recu_attester_paiements($1, $2::uuid[])`, [
        id,
        input.paiementsAttestes,
      ]);
    }
    // Rejouable aussi : la même paire rend `deja`.
    if (input.remplace) {
      await db.query(`select public.piece_remplacer($1, $2)`, [input.remplace, id]);
    }
    return { id, chemin };
  },

  /**
   * Son Mon espace, hors des sociétés qu'il a quittées (lot 4) : il part avec
   * son compte. La base le rend à son auteur seul ; il le télécharge (route
   * `/pieces/:id/contenu`, sous RLS) et le supprime, sans jamais l'envoyer.
   */
  async monEspaceHorsSociete(db: Requete): Promise<PieceDeMonEspace[]> {
    const { rows } = await db.query(
      `select id, tenant_id, societe, created_at, content_type, document_kind
         from public.mon_espace_hors_societe()`,
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      tenantId: r["tenant_id"] as string,
      societe: r["societe"] as string,
      createdAt: new Date(r["created_at"] as string | Date).toISOString(),
      contentType: (r["content_type"] as string | null) ?? null,
      documentKind: (r["document_kind"] as string | null) ?? null,
    }));
  },

  async lister(db: Requete, tenantId: string) {
    // Une pièce remplacée par une nouvelle photo quitte les listes : elle
    // reste, comme version précédente, derrière celle qui la remplace.
    const { rows } = await db.query(
      `select ${colonnesDeLaPiece()}
         from pieces_v where tenant_id = $1 and remplacee_par is null and archivee_le is null
        order by created_at desc limit 100`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map(versPiece);
  },

  /**
   * Le dossier d'une pièce : sa dernière extraction, ses citations, son plan de
   * tokens. Les octets ne sont pas ici — ils ont leur route.
   */
  /**
   * Les pièces d'un dossier, chacune avec sa dernière lecture.
   *
   * `left join lateral` plutôt qu'une seconde requête recollée en mémoire :
   * la dernière extraction de chaque pièce se choisit là où sont les lignes.
   * Les pièces jamais lues restent dans le résultat, avec des colonnes nulles
   * — les cacher reviendrait à nier qu'elles ont été déposées.
   */
  async listAvecLecture(db: Requete, tenantId: string) {
    /*
     * UNE LECTURE PARTIELLE EST UNE LECTURE.
     *
     * 13 octobre 2026. Cinq pièces de suite affichaient « Émetteur non
     * trouvé », sans date et sans total, alors que la lecture AVAIT trouvé
     * « ALGORIA », « COMPTOIR », « ORBIS ». La cause tient en une ligne :
     * read-piece.ts range sous le contrat « extract.v1.partiel » toute lecture
     * qui ne valide pas le schéma entier, et cette liste ne demandait que
     * « extract.v1 ». Tout ce qui avait été lu devenait invisible parce
     * qu'il manquait autre chose.
     *
     * Cette liste ne promet nulle part d'être complète : elle montre ce qu'on
     * sait. Le préfixe couvre donc les deux contrats.
     */
    const { rows } = await db.query(
      `select p.id, p.status, p.created_at, p.created_by, p.vis, p.gardee_le, p.transmise_le,
              p.document_kind,
              x.payload,
              app.piece_accompagne(p.id) as accompagne,
              (select valeur from precisions_v q
                where q.piece_id = p.id and q.champ = 'document_kind'
                order by decided_at desc limit 1) as precision_kind,
              -- Le nom de l'émetteur corrigé par une personne (R7 : la lecture
              -- reste telle quelle), que la liste préfère au nom lu.
              app.emetteur_dit(p.id) as emetteur_dit,
              ${REFUS_DE_LECTURE} as lecture_refusee,
              w.etat as lecture_etat, w.dernier_motif as lecture_motif,
              w.prenable_a as lecture_reessaie_le, w.demande_le as lecture_demande_le,
              -- Forcée, le total, le sens et la date sont ceux du
              -- cabinet : il décide.
              case when s.prise is not null
                   then app.montants_pris_en_charge(p.id) end as du_cabinet,
              ${COLONNES_DU_SUIVI},
              ${COLONNES_DU_CIRCUIT}
         from pieces_v p
         left join lateral (
           select e.payload
             from extractions_v e
            -- extract.v1 ET extract.v1.partiel : voir le commentaire au-dessus.
            where e.piece_id = p.id and e.contract like 'extract.v1%'
            order by e.created_at desc
            limit 1
         ) x on true
         -- Où en est la pièce chez le cabinet : seulement si elle y est partie.
         left join lateral (
           select * from app.suivi_de_la_piece(p.id) where p.vis = 'partage'
         ) s on true
         -- Le passage siège → propriétaire, et le côté de qui regarde.
         left join lateral app.circuit_de_la_piece(p.id) c on true
         /*
          * LE DERNIER TRAVAIL DE LECTURE, POUR QUE L'ÉCHEC SE VOIE.
          *
          * 24 octobre 2026, Wissem : « rien ne dit que la lecture casse ».
          * L'état est DÉRIVÉ par la vue (rien n'est stocké), une fois pour
          * tout le dossier — pas une sous-requête par pièce.
          */
         left join (
           select distinct on (t.piece_id) t.piece_id, t.etat, t.dernier_motif, t.prenable_a,
                  t.demande_le
             from fabrique.etat_des_travaux_v t
            where t.tenant_id = $1 and t.nature = 'lecture_piece'
            order by t.piece_id, t.demande_le desc
         ) w on w.piece_id = p.id
        -- Une version précédente n'est pas une pièce de plus (« Reprendre la photo »).
        -- Une pièce archivée a quitté la société : la RLS la laisse lire au
        -- cabinet engagé, et le dirigeant qui est aussi son propre comptable
        -- la revoyait ici, « à reprendre » (recette du 1er novembre 2026).
        where p.tenant_id = $1 and p.remplacee_par is null and p.archivee_le is null
        order by p.created_at desc`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => {
      const lu = (r["payload"] ?? null) as {
        issuer?: string;
        document_date?: string;
        document_kind?: string;
        currency?: string;
        totals?: { ttc?: string };
      } | null;
      const cab = versMontantsDuCabinet(r["du_cabinet"]);
      return {
        id: r["id"] as string,
        status: r["status"] as string,
        createdAt: r["created_at"] as string,
        auteurId: (r["created_by"] as string | null) ?? null,
        vis: r["vis"] as string,
        gardeeLe: (r["gardee_le"] as string | null) ?? null,
        transmiseLe: r["transmise_le"] ? new Date(r["transmise_le"] as string).toISOString() : null,
        accompagne: Boolean(r["accompagne"]),
        emetteur: (r["emetteur_dit"] as string | null) ?? lu?.issuer ?? null,
        dateDocument: cab?.dateEcriture ?? lu?.document_date ?? null,
        kind:
          cab?.documentKind ??
          (lu?.document_kind as string | undefined) ??
          (r["precision_kind"] as string | null) ??
          null,
        total: cab?.ttc ?? lu?.totals?.ttc ?? null,
        devise: cab?.devise ?? lu?.currency ?? null,
        typeDeDocument: (r["document_kind"] as string | null) ?? null,
        suivi: versSuivi(r),
        circuit: versCircuit(r),
        lectureRefusee: (r["lecture_refusee"] ?? null) as { motif: string; le: string } | null,
        // Le motif brut ne quitte jamais le serveur : il peut porter un message
        // technique. Seul son code `lecture.*` reconnu voyage.
        lecture: r["lecture_etat"]
          ? {
              etat: r["lecture_etat"] as EtatDUnTravail,
              demandeLe: new Date(r["lecture_demande_le"] as string | Date).toISOString(),
              code: codeDeLecture(r["lecture_motif"] as string | null),
              reessaieLe:
                r["lecture_reessaie_le"] == null
                  ? null
                  : new Date(r["lecture_reessaie_le"] as string | Date).toISOString(),
            }
          : null,
      };
    });
  },

  async dossier(db: Requete, pieceId: string) {
    const { rows: pieces } = await db.query(
      `select ${colonnesDeLaPiece()} from pieces_v where id = $1`,
      [pieceId],
    );
    const brut = (pieces as Record<string, unknown>[])[0];
    if (!brut) throw new Error("piece.not_found");

    const [
      { rows: ex },
      { rows: cit },
      { rows: tok },
      { rows: prec },
      { rows: refus },
      { rows: suivi },
      { rows: circuit },
      { rows: montants },
    ] = await Promise.all([
      db.query(
        `select id, contract, payload, flags, created_at
           from extractions_v where piece_id = $1 order by created_at desc limit 1`,
        [pieceId],
      ),
      db.query(`select field, page, bbox, zone from citations_v where piece_id = $1`, [pieceId]),
      db.query(
        `select page, ordinal, text, x0, y0, x1, y1
           from token_plan_v where piece_id = $1 order by ordinal`,
        [pieceId],
      ),
      // La dernière précision par champ : ce que la personne a tranché.
      db.query(
        `select distinct on (champ) champ, valeur
           from precisions_v where piece_id = $1 order by champ, decided_at desc`,
        [pieceId],
      ),
      db.query(`select ${REFUS_DE_LECTURE} as lecture_refusee from pieces_v p where p.id = $1`, [
        pieceId,
      ]),
      // Où elle en est chez le cabinet — la même lecture que les listes.
      db.query(`select ${COLONNES_DU_SUIVI} from app.suivi_de_la_piece($1) s`, [pieceId]),
      // Où elle en est chez le propriétaire, et de quel côté on la regarde.
      db.query(`select ${COLONNES_DU_CIRCUIT} from app.circuit_de_la_piece($1) c`, [pieceId]),
      // Forcée, ses montants sont ceux du cabinet ; validée, ceux de la lecture.
      db.query(`select app.montants_pris_en_charge($1) as m`, [pieceId]),
    ]);

    const extraction = (ex as Record<string, unknown>[])[0];
    const precisions = Object.fromEntries(
      (prec as Record<string, unknown>[]).map((p) => [p["champ"] as string, p["valeur"] as string]),
    );
    /*
     * L'extraction est immuable (R7) ; la précision la complète sans la
     * toucher. Le payload RENDU porte la réponse de la personne — là où la
     * lecture avait laissé un vide, et aussi là où la personne a corrigé le
     * type après lecture (23 octobre 2026) : ce qu'elle a confirmé l'emporte,
     * comme dans le jugement (`scan/analyse.ts`). L'écran, la proposition
     * d'écriture et la liste voient le même type ; la base garde les deux.
     */
    const payloadRendu = (() => {
      const brutPayload = extraction?.["payload"];
      if (!brutPayload || typeof brutPayload !== "object") return brutPayload;
      const p = { ...(brutPayload as Record<string, unknown>) };
      if (precisions["document_kind"]) {
        p["document_kind"] = precisions["document_kind"];
      }
      // La date donnée à la main complète une date non lue — jamais une date
      // lue. Sans elle, la fiche redemandait la date pour toujours.
      const date = dateDeLaPiece(
        p["document_date"] as string | null | undefined,
        precisions["document_date"],
      );
      if (date) p["document_date"] = date;
      // Le nom de l'émetteur corrigé (3 novembre 2026) l'emporte sur le nom
      // lu, comme le type : la personne a la pièce sous les yeux, la lecture
      // a pu prendre un logo pour un nom (« MITEK » pour « MyTek »).
      if (precisions["issuer"]) p["issuer"] = precisions["issuer"];
      return p;
    })();
    return {
      piece: versPiece(brut),
      extraction: extraction
        ? {
            id: extraction["id"] as string,
            contract: extraction["contract"] as string,
            payload: payloadRendu,
            flags: extraction["flags"] ?? [],
            createdAt: extraction["created_at"] as string,
          }
        : null,
      precisions,
      suivi: suivi[0] ? versSuivi(suivi[0] as Record<string, unknown>) : null,
      circuit: circuit[0] ? versCircuit(circuit[0] as Record<string, unknown>) : null,
      montantsDuCabinet: versMontantsDuCabinet((montants as Record<string, unknown>[])[0]?.["m"]),
      ecritureIllisible: ecritureIllisible((montants as Record<string, unknown>[])[0]?.["m"]),
      lectureRefusee: ((refus as Record<string, unknown>[])[0]?.["lecture_refusee"] ?? null) as {
        motif: string;
        le: string;
      } | null,
      citations: (cit as Record<string, unknown>[]).map((c) => ({
        field: c["field"] as string,
        page: Number(c["page"]),
        bbox: c["bbox"] ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
        zone: (c["zone"] as string | null) ?? null,
      })),
      tokens: (tok as Record<string, unknown>[]).map((t) => ({
        page: Number(t["page"]),
        ordinal: Number(t["ordinal"]),
        text: t["text"] as string,
        x0: Number(t["x0"]),
        y0: Number(t["y0"]),
        x1: Number(t["x1"]),
        y1: Number(t["y1"]),
      })),
    };
  },

  /**
   * Tout ce que la lecture citée doit savoir avant d'appeler l'œil.
   *
   * Les requêtes sont celles de l'ancien flux, à la virgule près — même tri sur
   * le pack, même absence de filtre de validité sur les charges. Améliorer l'une
   * d'elles ici changerait ce que le modèle reçoit, donc ce qu'il rend : ce
   * n'est pas un portage, c'est une décision, et elle se prend ailleurs.
   */
  async contexteLecture(db: Requete, pieceId: string) {
    const { rows: pieces } = await db.query(
      `select id, tenant_id, storage_path, source, content_type,
              to_char(recue_le, 'YYYY-MM-DD') as recue_le
         from pieces_v where id = $1`,
      [pieceId],
    );
    const piece = (pieces as Record<string, unknown>[])[0];
    if (!piece) throw new Error("piece.introuvable");

    // Le nom et le matricule du dossier : c'est ce qui permet de dire si la
    // pièce est émise PAR lui (vente) ou POUR lui (achat) — et, quand aucune
    // des deux parties n'est lui, de ne pas trancher.
    const { rows: orgs } = await db.query(
      `select name, legal_id, jurisdiction, currency from organizations_v where id = $1`,
      [piece["tenant_id"] as string],
    );
    const org = (orgs as Record<string, unknown>[])[0];
    // ============================== NI JURIDICTION NI DEVISE PAR DÉFAUT
    //
    // Un `?? "TN"` ici choisissait le pack tunisien pour un dossier dont la
    // juridiction manque, et l'échelle du millime avec lui. R4, corollaire :
    // un référentiel silencieusement faux produit un résultat plausible, et
    // c'est la pire forme d'erreur. Les deux colonnes sont NOT NULL en base :
    // si la ligne manque, c'est la pièce qui ne mène nulle part.
    if (!org) throw new Error("organisation.introuvable");
    const jurisdiction = org["jurisdiction"] as string;

    const { rows: packs } = await db.query(
      `select id from ref_packs_v
        where jurisdiction = $1 and effective_from <= current_date
        order by effective_from desc limit 1`,
      [jurisdiction],
    );
    const packId = (packs as Record<string, unknown>[])[0]?.["id"] as string | undefined;
    if (!packId) throw new Error("pack.absent");

    // Toutes les devises du référentiel : exposant, séparateur décimal,
    // marques imprimées. La relecture décide de celle de la PIÈCE
    // (`deviseDeLaPiece`), comme le jugement — et non plus de celle du
    // dossier seule (revue de la PR 144) : « 2.800 » se lit de deux façons à
    // trois décimales, « 100,000 » d'une seule quand la virgule est le
    // séparateur décimal de la devise, et « 100,00 € » n'est pas en dinars.
    const devises = await lireLesDevises(db);

    const [{ rows: taux }, { rows: charges }, { rows: tiers }] = await Promise.all([
      db.query(`select code, label, rate from ref_tva_rates_v where pack_version_id = $1`, [
        packId,
      ]),
      db.query(`select code, label from ref_fiscal_charges_v where pack_version_id = $1`, [packId]),
      // Les tiers déjà connus du dossier. Sans eux, l'œil relit « DREAM OPTIC »
      // comme un inconnu à chaque facture, alors qu'il porte un code auxiliaire
      // et un compte. Les rapprocher reste le travail du filtre : on donne la
      // liste au modèle, il ne l'invente pas.
      db.query(
        `select code, raison_sociale, nature, identifiant_fiscal
           from tiers_v where tenant_id = $1 and actif order by nature, code`,
        [piece["tenant_id"] as string],
      ),
    ]);

    return {
      piece: {
        id: piece["id"] as string,
        tenantId: piece["tenant_id"] as string,
        storagePath: piece["storage_path"] as string,
        source: piece["source"] as string,
        contentType: (piece["content_type"] as string | null) ?? null,
        // Le jour de sa réception : les règles du sudoku s'y lisent quand la
        // pièce n'a pas de date lue (comme le jugement, `analyse.ts`).
        recueLe: piece["recue_le"] as string,
      },
      jurisdiction,
      currency: org["currency"] as string,
      devises,
      // Comment le pack écrit une date et un matricule, au jour de réception.
      regles: await lireLesReglesDeLecture(db, packId, piece["recue_le"] as string),
      dossier: {
        raisonSociale: (org["name"] as string) ?? "",
        identifiantFiscal: (org["legal_id"] as string | null) ?? null,
      },
      packId,
      // `rate` et les montants restent des NOMBRES ici, comme les rendait
      // PostgREST. Le web les remet en chaîne exactement comme avant : une
      // décimale de plus dans l'invite changerait la lecture.
      taxCodes: (taux as Record<string, unknown>[]).map((t) => ({
        code: t["code"] as string,
        label: (t["label"] as string) ?? (t["code"] as string),
        rate: Number(t["rate"]),
      })),
      chargeCodes: (charges as Record<string, unknown>[]).map((c) => ({
        code: c["code"] as string,
        label: (c["label"] as string) ?? (c["code"] as string),
      })),
      tiers: (tiers as Record<string, unknown>[]).map((x) => ({
        code: x["code"] as string,
        raisonSociale: x["raison_sociale"] as string,
        nature: x["nature"] as string,
        identifiantFiscal: (x["identifiant_fiscal"] as string | null) ?? null,
      })),
    };
  },

  /**
   * La grille d'un type de document et les paramètres du pack, pour le sudoku,
   * AU JOUR de la pièce ; et son mode (`lecture.sudoku` : observe ou désigne),
   * résolu pour le dossier comme tout réglage (le dossier, son cabinet, le
   * pack). Tout vient de la base : rien n'est écrit dans le code (R4).
   *
   * Le MODE se résout au jour de la LECTURE, pas à celui de la pièce : c'est un
   * choix de fonctionnement du cabinet, pas une règle fiscale datée. Résolu à la
   * date de la pièce, une facture antérieure au défaut du pack n'avait aucun
   * mode, et le sudoku se taisait (relevé le 1er novembre 2026).
   */
  async contexteSudoku(
    db: Requete,
    dossierId: string,
    packId: string,
    grilleCode: string,
    deviseCode: string,
    jour: string,
  ): Promise<ContexteDuSudokuBranche> {
    const [contexte, reglages] = await Promise.all([
      lireLeContexteDuSudoku(db, packId, grilleCode, deviseCode, jour),
      lireLesReglagesComptables(db, dossierId, packId, aujourdhui()),
    ]);
    return { ...contexte, mode: modeDuSudoku(reglages) };
  },

  /**
   * Ce que le sudoku a lu, champ par champ, prouvé ou non. Une lecture ne se
   * réécrit pas (R7) : chaque passage ajoute ses lignes sous un même
   * `lecture_id`, et l'inscription la plus récente fait foi, en entier.
   */
  async inscrireChampsLus(db: Requete, input: ChampsLusAInscrire): Promise<{ inscrits: number }> {
    // Par la porte (`capture_champs_lus_inscrire`) : seules les portes écrivent.
    const { rows } = await db.query<{ n: number }>(
      `select public.capture_champs_lus_inscrire($1, $2, $3::date, $4, $5, $6::jsonb) as n`,
      [
        input.pieceId,
        input.packId,
        input.jour,
        input.grille,
        input.issue,
        JSON.stringify(input.champs),
      ],
    );
    return { inscrits: rows[0]?.n ?? 0 };
  },

  /**
   * Ce que le lecteur prouvé a lu sur la pièce, pour qu'on le VOIE avant de
   * l'allumer : la dernière inscription (un seul `lecture_id`), son issue et
   * ses champs. Rien n'est écrit ; la lecture passe sous l'identité de
   * l'appelant, et la politique de `capture.champs_lus` (celle de la pièce)
   * décide de ce qu'il voit — un inconnu ne relit rien.
   *
   * Le rôle et la famille d'experts ne sont pas dans la ligne : ils se lisent
   * par le champ de la grille et son concept (R12). Leurs libellés, et celui
   * de l'avertissement, viennent de `ref.labels` dans la langue demandée, le
   * français à défaut, le code en dernier. Le libellé du champ est celui de la
   * grille : aucun espace de noms ne le traduit encore.
   */
  async lectureObservee(
    db: Requete,
    pieceId: string,
    locale: string,
  ): Promise<LectureObservee | null> {
    const { rows } = await db.query<{
      lecture_id: string;
      issue: LectureObservee["issue"];
      le: Date | string;
      grille_code: string | null;
      grille_nom: string | null;
      champ_code: string | null;
      champ_libelle: string | null;
      role: string | null;
      role_libelle: string | null;
      expert: string | null;
      expert_libelle: string | null;
      statut: ChampObserve["statut"] | null;
      valeur: string | null;
      rang: number | null;
      instance: string | null;
      citations: unknown;
      avertissement: string | null;
      avertissement_libelle: string | null;
    }>(
      `with derniere as (
         select l.lecture_id
           from capture.champs_lus l
          where l.piece_id = $1
          order by l.created_at desc, l.lecture_id
          limit 1)
       select l.lecture_id, l.issue, l.created_at as le,
              l.grille_code, g.nom as grille_nom,
              l.champ_code, gc.libelle as champ_libelle,
              gc.role, coalesce(rd.value, rf.value, gc.role) as role_libelle,
              c.expert, coalesce(ed.value, ef.value, c.expert) as expert_libelle,
              l.statut, l.valeur, l.rang, l.instance, l.citations,
              l.avertissement,
              coalesce(ad.value, af.value, l.avertissement) as avertissement_libelle
         from capture.champs_lus l
         join derniere d on d.lecture_id = l.lecture_id
         left join ref.grilles g on g.id = l.grille_id
         left join ref.grille_champs gc on gc.id = l.grille_champ_id
         left join ref.concepts c on c.id = gc.concept_id
         left join ref_labels_v rd on rd.ns = 'concept_role' and rd.key = gc.role and rd.locale = $2
         left join ref_labels_v rf on rf.ns = 'concept_role' and rf.key = gc.role and rf.locale = 'fr'
         left join ref_labels_v ed on ed.ns = 'concept_expert' and ed.key = c.expert and ed.locale = $2
         left join ref_labels_v ef on ef.ns = 'concept_expert' and ef.key = c.expert and ef.locale = 'fr'
         left join ref_labels_v ad
           on ad.ns = 'avertissement_lecture' and ad.key = l.avertissement and ad.locale = $2
         left join ref_labels_v af
           on af.ns = 'avertissement_lecture' and af.key = l.avertissement and af.locale = 'fr'
        where l.piece_id = $1
        order by l.rang nulls first, gc.parcelle, gc.code, l.instance nulls first`,
      [pieceId, locale],
    );
    const tete = rows[0];
    if (!tete) return null;
    const code = (c: string | null, libelle: string | null) =>
      c === null ? null : { code: c, libelle: libelle ?? c };
    return {
      lectureId: tete.lecture_id,
      issue: tete.issue,
      grille: code(tete.grille_code, tete.grille_nom),
      le: new Date(tete.le).toISOString(),
      // La ligne de tentative (champ nul) ne porte que l'issue : elle n'est pas un champ.
      champs: rows
        .filter((r) => r.champ_code !== null && r.statut !== null)
        .map((r) => ({
          code: r.champ_code!,
          libelle: r.champ_libelle ?? r.champ_code!,
          role: code(r.role, r.role_libelle),
          expert: code(r.expert, r.expert_libelle),
          statut: r.statut!,
          valeur: r.valeur,
          rang: r.rang,
          instance: r.instance,
          citations: Array.isArray(r.citations) ? r.citations : [],
          avertissement: code(r.avertissement, r.avertissement_libelle),
        })),
    };
  },

  /**
   * Persiste le résultat de la lecture, et les articles cités qui en découlent.
   *
   * Les deux RPC sont ici dans UNE transaction, là où l'ancien flux les appelait
   * l'une après l'autre par le réseau. Une lecture persistée sans ses articles
   * n'existe plus.
   */
  /**
   * Ce que la personne précise quand la lecture ne pouvait pas conclure.
   * Une entrée nouvelle, jamais une modification : la fonction SQL contraint
   * le champ, la valeur et l'état de la pièce.
   */
  async preciser(
    db: Requete,
    pieceId: string,
    champ: string,
    valeur: string,
  ): Promise<{ id: string | null; champ: string; valeur: string }> {
    // `id` est nul quand la personne redit le nom déjà retenu : rien ne s'écrit.
    const { rows } = await db.query(`select public.capture_precision_persist($1, $2, $3) as p`, [
      pieceId,
      champ,
      valeur,
    ]);
    const p = (rows as Array<{ p: { id: string | null; champ: string; valeur: string } }>)[0]?.p;
    if (!p) throw new Error("precision.non_enregistree");
    return { id: p.id, champ: p.champ, valeur: p.valeur };
  },

  /**
   * Juger une pièce lue : normalisation des montants, contrôles motivés,
   * verdict — posés dans `capture.analyses`. Voir `scan/analyse.ts`.
   */
  async analyser(db: Requete, pieceId: string) {
    return analyserPiece(db, pieceId);
  },

  /** Rend la ligne inscrite (`capture.extractions`) : le journal la référence, sans la recopier. */
  async persisterLecture(
    db: Requete,
    input: LectureAPersister,
  ): Promise<{ extractionId: string | null }> {
    const { rows } = await db.query<{ r: { extraction_id?: string } | null }>(
      `select public.capture_read_persist($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb,
                                          $7, $8::jsonb) as r`,
      [input.pieceId, ...argumentsDeLecture(input)],
    );

    await projeterLesArticles(db, input);
    return { extractionId: rows[0]?.r?.extraction_id ?? null };
  },

  /**
   * La relecture de nuit est-elle ACTIVE pour le dossier de cette pièce ? La
   * base le dit (`app.relecture_de_nuit` : le réglage du dossier, de son
   * cabinet, puis le défaut du pack) ; ce dépôt ne lit aucune valeur.
   */
  async relectureDeNuit(db: Requete, pieceId: string): Promise<boolean> {
    const { rows } = await db.query<{ active: boolean }>(
      `select app.relecture_de_nuit(tenant_id) is not null as active from pieces_v where id = $1`,
      [pieceId],
    );
    if (!rows[0]) throw new Error("refus.introuvable.piece");
    return rows[0].active;
  },

  /**
   * Inscrire la relecture de la lecture qui fait foi. L'heure (« pas avant »)
   * est celle de la base : la lecture + le délai du dossier.
   */
  async inscrireRelecture(
    db: Requete,
    pieceId: string,
    consigne: { lecteur: string; paddleTente: boolean },
  ): Promise<{ travailId: string; deja: boolean; pasAvant: string }> {
    const { rows } = await db.query<{
      r: { travail_id: string; deja: boolean; pas_avant: string };
    }>(`select fabrique.relecture_inscrire($1, $2::jsonb) as r`, [
      pieceId,
      JSON.stringify(consigne),
    ]);
    const r = rows[0]!.r;
    return { travailId: r.travail_id, deja: r.deja, pasAvant: r.pas_avant };
  },

  /** Ce qu'une relecture doit savoir avant de payer un modèle (`fabrique.relecture_a_faire`). */
  async relectureAFaire(db: Requete, travailId: string): Promise<RelectureAFaire> {
    const { rows } = await db.query<{
      r: {
        piece_id: string;
        extraction_id: string;
        contract: string;
        flags: Array<{ code: string }>;
        consigne: { lecteur: string; paddleTente: boolean };
        abstention: string | null;
        trace: string | null;
      };
    }>(`select fabrique.relecture_a_faire($1) as r`, [travailId]);
    const r = rows[0]!.r;
    return {
      pieceId: r.piece_id,
      extractionId: r.extraction_id,
      contract: r.contract,
      flags: r.flags,
      consigne: r.consigne,
      abstention: r.abstention,
      trace: r.trace,
    };
  },

  /**
   * Persister une relecture RETENUE : une lecture nouvelle (R7), par sa porte
   * (`capture_relecture_persist`), qui exige le travail pris et revérifie
   * qu'aucune personne n'a corrigé la pièce depuis.
   */
  async persisterRelecture(
    db: Requete,
    input: LectureAPersister & { travailId: string },
  ): Promise<{ extractionId: string | null }> {
    const { rows } = await db.query<{ r: { extraction_id?: string } | null }>(
      `select public.capture_relecture_persist($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb,
                                               $7::jsonb, $8, $9::jsonb) as r`,
      [input.travailId, input.pieceId, ...argumentsDeLecture(input)],
    );

    await projeterLesArticles(db, input, true);
    return { extractionId: rows[0]?.r?.extraction_id ?? null };
  },

  /**
   * Donner à la main la date qu'on n'a pas su lire.
   *
   * ================================================================= POURQUOI
   *
   * Depuis le 5 octobre 2026, une pièce dont la date n'a pas été lue a une
   * période NULLE — « pas de rangement plutôt qu'un rangement faux ». C'était
   * juste, et c'est resté incomplet : l'écran des charges annonçait « 3 pièces
   * attendent leur date » et aucun geste ne les débloquait. Une impasse
   * annoncée reste une impasse.
   *
   * Deux temps, et le second est celui qu'on oublie : la précision s'inscrit,
   * puis les articles SE REPROJETTENT. Sans la reprojection, la date serait
   * enregistrée et la pièce resterait hors de tous les mois — le drapeau
   * changerait, pas le chiffre.
   */
  async daterLaPiece(
    db: Requete,
    pieceId: string,
    date: string,
  ): Promise<{ periode: string | null }> {
    await db.query(`select public.capture_precision_persist($1, 'document_date', $2)`, [
      pieceId,
      date,
    ]);

    // Ce qu'il faut pour reprojeter : la dernière lecture, le type tranché, et
    // le pack du dossier. Rien n'est recalculé — ce sont les mêmes valeurs qui
    // ont servi à la lecture, avec la date en plus.
    const { rows } = await db.query<{
      tenant_id: string;
      document_kind: string | null;
      payload: { articles?: unknown[] } | null;
      jurisdiction: string;
    }>(
      `select p.tenant_id, p.document_kind, e.payload, o.jurisdiction
         from pieces_v p
         join organizations_v o on o.id = p.tenant_id
         left join lateral (
           select payload from extractions_v x
            where x.piece_id = p.id order by x.created_at desc limit 1
         ) e on true
        where p.id = $1`,
      [pieceId],
    );
    const ligne = rows[0];
    if (!ligne) throw new Error("refus.introuvable.piece");

    const articles = ligne.payload?.articles ?? [];
    if (articles.length === 0) return { periode: date.slice(0, 7) };

    const { rows: packs } = await db.query<{ id: string }>(
      `select id from ref_packs_v
        where jurisdiction = $1 and effective_from <= $2
        order by effective_from desc limit 1`,
      [ligne.jurisdiction, date],
    );
    const packId = packs[0]?.id;
    if (!packId) {
      // R4 : pas de repli. Un dossier sans pack à cette date ne se projette
      // pas en silence sous un pack voisin.
      throw new Error(`aucun pack en vigueur au ${date} pour ${ligne.jurisdiction}`);
    }

    await projeterLesArticles(db, {
      pieceId,
      packId,
      articles,
      documentKind: ligne.document_kind,
      documentDate: date,
    });
    return { periode: date.slice(0, 7) };
  },

  /**
   * Le dossier que l'assistant a le droit de lire.
   *
   * Reproduit `loadMalicaContext` requête pour requête, limites comprises :
   * 500 pièces, 25 écritures, 20 échéances, 40 motifs, 80 citations.
   */
  async contexteAssistant(db: Requete, tenantId: string, pieceId: string | null) {
    const { rows: orgs } = await db.query(
      `select name, kind, jurisdiction, currency, validation_mode
         from organizations_v where id = $1`,
      [tenantId],
    );
    const org = (orgs as Record<string, unknown>[])[0];
    if (!org) throw new Error("organisation.introuvable");

    /*
     * La fiche fiscale du dossier.
     *
     * Sans elle, Malica ne sait pas si le client est assujetti à la TVA ni
     * s'il relève du réel : elle ne peut donc ni qualifier une opération ni
     * répondre sur la déduction. Elle supposerait, ou elle interrogerait.
     *
     * Absente, elle reste NULLE. Un dossier sans fiche n'est pas un dossier au
     * régime réel par défaut — c'est un dossier dont on ignore le régime, et
     * Malica doit le dire plutôt que de choisir.
     */
    const { rows: fiches } = await db.query(
      `select f.regime_imposition, f.regime_tva, f.prorata_tva, f.secteur,
              f.debut_activite, f.cloture_exercice, f.valid_from,
              ri.libelle as regime_imposition_libelle,
              rt.libelle as regime_tva_libelle
         from identity.fiches_fiscales f
         left join ref.regimes_fiscaux ri
           on ri.jurisdiction = $2 and ri.axe = 'imposition'
          and ri.code = f.regime_imposition
          and ri.valid_from <= f.valid_from
          and (ri.valid_to is null or ri.valid_to > f.valid_from)
         left join ref.regimes_fiscaux rt
           on rt.jurisdiction = $2 and rt.axe = 'tva'
          and rt.code = f.regime_tva
          and rt.valid_from <= f.valid_from
          and (rt.valid_to is null or rt.valid_to > f.valid_from)
        where f.tenant_id = $1 and f.valid_to is null
        order by f.valid_from desc limit 1`,
      [tenantId, org["jurisdiction"] as string],
    );
    const fiche = (fiches as Record<string, unknown>[])[0] ?? null;

    const [
      { rows: packs },
      { rows: pieces },
      { rows: ecritures },
      { rows: echeances },
      { rows: motifs },
    ] = await Promise.all([
      db.query(
        // `id` est indispensable : la résolution des rôles joint dessus. Sans lui,
        // les 160 rôles remontaient « aucun compte » et l'''IA aurait répondu
        // qu'''aucune imputation n'''existe.
        `select id, version, effective_from from ref_packs_v
            where jurisdiction = $1 and effective_from <= current_date
            order by effective_from desc limit 1`,
        [org["jurisdiction"] as string],
      ),
      db.query(
        `select id, status from pieces_v
          where tenant_id = $1 and remplacee_par is null and archivee_le is null limit 500`,
        [tenantId],
      ),
      db.query(
        `select id, date_ecriture, journal, libelle, status from ecritures_v
            where tenant_id = $1 order by date_ecriture desc limit 25`,
        [tenantId],
      ),
      db.query(
        `select label, due_date, status from echeances_v
            where tenant_id = $1 order by due_date limit 20`,
        [tenantId],
      ),
      db.query(
        `select code, severity, requires_note from ref_rejet_motifs_v
            where active = true limit 40`,
      ),
    ]);

    const ids = (ecritures as Record<string, unknown>[]).map((e) => e["id"] as string);
    const { rows: lignes } = ids.length
      ? await db.query(
          `select ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code
             from ecriture_lignes_v where ecriture_id = any($1::uuid[]) order by ordinal`,
          [ids],
        )
      : { rows: [] as Record<string, unknown>[] };

    let piece: unknown = null;
    if (pieceId) {
      const { rows: p } = await db.query(`select id, status, source from pieces_v where id = $1`, [
        pieceId,
      ]);
      const brut = (p as Record<string, unknown>[])[0];
      if (brut) {
        const [{ rows: ex }, { rows: cit }] = await Promise.all([
          db.query(
            `select contract, payload, flags from extractions_v
              where piece_id = $1 order by created_at desc limit 1`,
            [pieceId],
          ),
          db.query(`select field, page, zone from citations_v where piece_id = $1 limit 80`, [
            pieceId,
          ]),
        ]);
        const extraction = (ex as Record<string, unknown>[])[0];
        piece = {
          id: brut["id"] as string,
          status: brut["status"] as string,
          source: brut["source"] as string,
          contract: (extraction?.["contract"] as string | undefined) ?? null,
          extract: extraction?.["payload"] ?? null,
          flags: extraction?.["flags"] ?? null,
          citations: (cit as Record<string, unknown>[]).map((c) => ({
            field: c["field"] as string,
            page: Number(c["page"]),
            zone: (c["zone"] as string | null) ?? null,
          })),
        };
      }
    }

    // ------------------------------------------- ce que le cabinet a arrêté
    //
    // Sans cela, Malica répondrait sur le plan livré et contredirait le
    // paramétrage — elle citerait 4371 quand le cabinet a choisi autre chose.
    //
    // La résolution est celle du moteur, à trois niveaux : le dossier d'abord,
    // le cabinet qui le mandate ensuite, le pack en dernier. Le cabinet se
    // trouve par l'engagement, puisque c'est lui qui porte les règles maison.
    const pack = (packs as Record<string, unknown>[])[0];

    const { rows: roles } = await db.query(
      `select r.code, r.libelle,
              coalesce(d.account_code, c.account_code, p.account_code) as compte,
              case when d.account_code is not null then 'dossier'
                   when c.account_code is not null then 'cabinet'
                   when p.account_code is not null then 'pack'
                   else 'aucun' end as origine
         from ref.account_roles r
         left join ref.role_bindings p
           on p.role_code = r.code and p.pack_version_id = $2
         left join parametrage_role_bindings_v d
           on d.role_code = r.code and d.portee = 'dossier' and d.portee_id = $1
         left join parametrage_role_bindings_v c
           on c.role_code = r.code and c.portee = 'cabinet'
          and c.portee_id in (select cabinet_org_id from engagements_v where pme_org_id = $1)
        order by r.code`,
      [tenantId, (pack?.["id"] as string | undefined) ?? null],
    );

    const [{ rows: sousComptes }, { rows: auxiliaires }] = await Promise.all([
      db.query(
        `select account_code, label, parent_code from plan_comptable_v
          where tenant_id = $1 order by account_code`,
        [tenantId],
      ),
      db.query(
        `select code, raison_sociale, nature, compte_collectif
           from tiers_v where tenant_id = $1 and actif order by nature, code`,
        [tenantId],
      ),
    ]);
    return {
      organisation: {
        name: org["name"] as string,
        kind: org["kind"] as string,
        jurisdiction: org["jurisdiction"] as string,
        currency: org["currency"] as string,
        validationMode: org["validation_mode"] as string,
      },
      pack: pack
        ? { version: pack["version"] as string, effectiveFrom: pack["effective_from"] as string }
        : null,
      // Ce que le client EST au regard de l'impôt. Nul quand on l'ignore.
      fiche: fiche
        ? {
            regimeImposition: (fiche["regime_imposition_libelle"] as string | null) ?? null,
            regimeTva: (fiche["regime_tva_libelle"] as string | null) ?? null,
            prorataTva: fiche["prorata_tva"] === null ? null : String(fiche["prorata_tva"]),
            secteur: (fiche["secteur"] as string | null) ?? null,
            debutActivite: (fiche["debut_activite"] as string | null) ?? null,
            clotureExercice: (fiche["cloture_exercice"] as string | null) ?? null,
          }
        : null,
      pieces: (pieces as Record<string, unknown>[]).map((p) => ({
        status: (p["status"] as string) ?? "inconnu",
      })),
      ecritures: (ecritures as Record<string, unknown>[]).map((e) => ({
        id: e["id"] as string,
        date: e["date_ecriture"] as string,
        journal: e["journal"] as string,
        libelle: e["libelle"] as string,
        status: e["status"] as string,
      })),
      // Les montants restent des nombres, comme les rendait PostgREST : le web
      // les remet en chaîne à l'identique avant de composer l'invite.
      lignes: (lignes as Record<string, unknown>[]).map((l) => ({
        ecritureId: l["ecriture_id"] as string,
        compte: l["account_code"] as string,
        libelle: (l["libelle"] as string) ?? "",
        debit: Number(l["debit"]),
        credit: Number(l["credit"]),
        taxCode: (l["tax_code"] as string | null) ?? null,
      })),
      echeances: (echeances as Record<string, unknown>[]).map((e) => ({
        label: e["label"] as string,
        dueDate: e["due_date"] as string,
        status: e["status"] as string,
      })),
      motifs: (motifs as Record<string, unknown>[]).map((m) => ({
        code: m["code"] as string,
        severity: m["severity"] as string,
        requiresNote: Boolean(m["requires_note"]),
      })),
      // Le paramétrage tel qu'il s'applique à CE dossier. Les 160 rôles, pas
      // seulement ceux qui diffèrent : Malica doit pouvoir répondre « sur quel
      // compte » à n'importe quelle question, pas seulement sur les cas que le
      // cabinet a retouchés.
      roles: (roles as Record<string, unknown>[]).map((r) => ({
        code: r["code"] as string,
        libelle: r["libelle"] as string,
        compte: (r["compte"] as string | null) ?? null,
        origine: r["origine"] as string,
      })),
      sousComptes: (sousComptes as Record<string, unknown>[]).map((c) => ({
        code: c["account_code"] as string,
        libelle: c["label"] as string,
        parent: c["parent_code"] as string,
      })),
      tiers: (auxiliaires as Record<string, unknown>[]).map((x) => ({
        code: x["code"] as string,
        raisonSociale: x["raison_sociale"] as string,
        nature: x["nature"] as string,
        compteCollectif: x["compte_collectif"] as string,
      })),
      piece,
    };
  },

  /**
   * Le verdict de la base sur une lecture : permise ou non, et pourquoi.
   *
   * Ce dépôt ne décide rien : il relaie `public.lecture_autorisee`, qui porte
   * le plafond (R3, R6). Le motif est celui du référentiel, rendu tel quel.
   */
  async lectureAutorisee(db: Requete, pieceId: string) {
    const { rows } = await db.query<{ v: VerdictDeLecture }>(
      "select public.lecture_autorisee($1) as v",
      [pieceId],
    );
    return rows[0]!.v;
  },

  /**
   * Inscrire POURQUOI une lecture a été refusée, pour que l'écran le dise.
   *
   * La base rejoue le verdict et n'inscrit que son propre motif (code, jamais
   * une phrase). Rend le verdict.
   */
  async inscrireRefusDeLecture(db: Requete, pieceId: string) {
    const { rows } = await db.query<{ v: VerdictDeLecture }>(
      "select public.lecture_refusee_inscrire($1) as v",
      [pieceId],
    );
    return rows[0]!.v;
  },

  /**
   * Compter une lecture rendue — la SEULE écriture de `facturation.lectures`.
   *
   * `public.lecture_consommer` refuse d'elle-même si son verdict n'autorise
   * pas, et ne compte pas deux fois une pièce déjà comptée.
   */
  async consommerLecture(db: Requete, pieceId: string) {
    const { rows } = await db.query<{ v: VerdictDeLecture }>(
      "select public.lecture_consommer($1) as v",
      [pieceId],
    );
    return rows[0]!.v;
  },

  /** Journal d'un appel d'agent. Rend l'identifiant de la trace, ou null. */
  async journaliserAgent(
    db: Requete,
    input: {
      tenantId: string;
      agent: string;
      model: string;
      role: string;
      status: string;
      latencyMs: number;
      tokensIn?: number | null;
      tokensOut?: number | null;
      pieceId?: string | null;
      erreur?: string | null;
    },
  ): Promise<string | null> {
    const { rows } = await db.query<{ id: string | null }>(
      `select public.agents_run_log($1, $2, $3, $4, $5, $6::integer,
                                    $7::integer, $8::integer, $9, $10) as id`,
      [
        input.tenantId,
        input.agent,
        input.model,
        input.role,
        input.status,
        input.latencyMs,
        input.tokensIn ?? null,
        input.tokensOut ?? null,
        input.pieceId ?? null,
        input.erreur ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  },

  /**
   * Supprimer une pièce qui n'est pas partie, ou que le cabinet a retournée.
   *
   * ============================================== CE QUI DÉCIDE, ET OÙ
   *
   * Pas ici. C'est `capture_piece_supprimer` qui refuse — pièce transmise et
   * non retournée, pièce engagée, pièce servant de justificatif —, qui
   * archive une pièce qu'une écriture contre-passée retient, et la RLS qui
   * décide de ce que l'appelant voit. Cette méthode ne fait qu'enchaîner deux
   * gestes que la base ne peut pas faire seule : demander, puis effacer les
   * octets d'une pièce effacée.
   *
   * L'ordre compte. On lit le tenant AVANT la suppression : après, la ligne
   * n'existe plus et l'on ne saurait plus où est le fichier.
   */
  /**
   * ====================================================== LE SECOND ARGUMENT
   *
   * `capture_piece_supprimer(piece, p_par_accord)` : le second argument dit
   * « le cabinet a donné son accord ». Seul `piece_repondre` a le droit de le
   * poser à vrai. Depuis un écran il vaut TOUJOURS `false`, et cette méthode
   * est ce que l'écran appelle : elle le passe, et refuse tout autre valeur.
   * Sans ce refus, un client qui écrirait `true` dans son appel supprimerait
   * une pièce transmise sans l'accord de personne.
   */
  async supprimer(db: Requete, pieceId: string, parAccord: false = false): Promise<boolean> {
    if (parAccord !== false) {
      throw Object.assign(new Error("suppression.accord_reserve_au_cabinet"), { code: "42501" });
    }
    // La base efface, ou archive une pièce qu'une écriture contre-passée
    // retient : celle-là garde ses octets.
    return effacerPar(db, pieceId, async () => {
      const { rows } = await db.query<{ issue: "supprimee" | "archivee" }>(
        `select public.capture_piece_supprimer($1, $2) as issue`,
        [pieceId, parAccord],
      );
      return { effacee: rows[0]?.issue === "supprimee" };
    });
  },

  /**
   * « Renvoyer » : la pièce retournée repart à qui l'a retournée — au
   * propriétaire (le siège), au cabinet (qui lui transmet) —, son retour clos.
   *
   * Rien ne s'inscrit ici, et c'est le propos (« Malica sans blocage »,
   * 28 octobre 2026) : le renvoi faisait inscrire par la PME l'écriture de la
   * pièce — et, après une contre-passation, celle de l'ANCIENNE lecture. Le
   * cabinet propose maintenant sur la lecture courante, ou force.
   */
  async renvoyer(db: Requete, pieceId: string): Promise<{ le: string }> {
    const { rows } = await db.query<{ le: string }>(
      `select public.piece_renvoyer($1) ->> 'le' as le`,
      [pieceId],
    );
    return { le: new Date(rows[0]!.le).toISOString() };
  },

  /**
   * La fiche d'une pièce qui en ACCOMPAGNE une autre — un reçu produit par
   * Malica, le justificatif photographié d'un règlement — ou `null`.
   *
   * La base dit tout (`piece_qui_accompagne`) : le genre, la pièce mère, les
   * règlements attestés ou prouvés, s'il compte encore et pourquoi pas, et —
   * pour un justificatif — les règlements sans preuve où il peut aller. Les
   * libellés viennent du référentiel, dans la langue demandée.
   */
  /**
   * Ce que la PME lit d'un retour — du cabinet, ou du propriétaire au siège :
   * motif (libellé du référentiel), note, date, qui l'a retournée, le geste
   * demandé et s'il est fait (`piece_retour`). `null` hors retour.
   */
  async retourDeLaPiece(db: Requete, pieceId: string, locale: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
      `select public.piece_retour($1, $2) as r`,
      [pieceId, locale],
    );
    const r = rows[0]?.r ?? null;
    if (!r) return null;
    return {
      le: new Date(r["le"] as string).toISOString(),
      note: (r["note"] as string | null) ?? null,
      motif: r["motif"] as string,
      motifLibelle: r["motifLibelle"] as string,
      geste: r["geste"] as GesteDeRetour,
      chez: r["chez"] as "proprietaire" | "cabinet",
      qui: (r["qui"] as string | null) ?? null,
      fait: Boolean(r["fait"]),
    };
  },

  /**
   * La réponse à un retour — du client au cabinet, ou du siège au propriétaire
   * qui la lui a retournée —, tracée et notifiée.
   */
  async repondreAuCabinet(db: Requete, pieceId: string, texte: string): Promise<void> {
    await db.query(`select public.piece_repondre_au_cabinet($1, $2)`, [pieceId, texte]);
  },

  async pieceQuiAccompagne(db: Requete, pieceId: string, locale: string) {
    const { rows } = await db.query<{ f: PieceQuiAccompagneBrute | null }>(
      `select public.piece_qui_accompagne($1) as f`,
      [pieceId],
    );
    const f = rows[0]?.f ?? null;
    if (!f) return null;

    /*
     * La base rend des CODES ; leurs noms viennent du référentiel, dans la
     * langue demandée, le français à défaut, le code en dernier (R4). Une
     * requête pour tous les moyens de la fiche.
     */
    const codes = [...new Set([...f.reglements, ...f.candidats].map((r) => r.moyenCode))];
    const { rows: noms } = await db.query<{
      code: string;
      moyen: string;
      par: string;
      preuve: string;
    }>(
      `select c.code,
              coalesce(md.value, mf.value, c.code) as moyen,
              coalesce(pd.value, pf.value, c.code) as par,
              coalesce(jd.value, jf.value, c.code) as preuve
         from unnest($1::text[]) as c(code)
         left join ref_labels_v md on md.ns = 'moyen_paiement' and md.key = c.code and md.locale = $2
         left join ref_labels_v mf on mf.ns = 'moyen_paiement' and mf.key = c.code and mf.locale = 'fr'
         left join ref_labels_v pd on pd.ns = 'moyen_paiement_par' and pd.key = c.code and pd.locale = $2
         left join ref_labels_v pf on pf.ns = 'moyen_paiement_par' and pf.key = c.code and pf.locale = 'fr'
         left join ref_labels_v jd on jd.ns = 'justificatif_du_moyen' and jd.key = c.code and jd.locale = $2
         left join ref_labels_v jf on jf.ns = 'justificatif_du_moyen' and jf.key = c.code and jf.locale = 'fr'`,
      [codes, locale],
    );
    const nom = new Map(noms.map((n) => [n.code, n]));
    const { rows: motif } = f.annulation
      ? await db.query<{ libelle: string }>(
          `select coalesce(
                    (select value from ref_labels_v where ns = 'paiement_motif_annulation'
                        and key = $1 and locale = $2),
                    (select value from ref_labels_v where ns = 'paiement_motif_annulation'
                        and key = $1 and locale = 'fr'),
                    $1) as libelle`,
          [f.annulation.motifCode, locale],
        )
      : { rows: [] };

    const montantMineur = (v: number | string | null) => (v === null ? null : Number(v));
    return {
      genre: f.genre,
      vis: f.vis,
      creeLe: new Date(f.creeLe).toISOString(),
      mere: f.mere,
      reglements: f.reglements.map((r) => ({
        ...r,
        moyen: nom.get(r.moyenCode)?.moyen ?? r.moyenCode,
        moyenPar: nom.get(r.moyenCode)?.par ?? r.moyenCode,
        nomDeLaPreuve: nom.get(r.moyenCode)?.preuve ?? r.moyenCode,
        montantMineur: montantMineur(r.montantMineur),
      })),
      vaut: f.vaut,
      annulation: f.annulation
        ? {
            paiementId: f.annulation.paiementId,
            le: new Date(f.annulation.le).toISOString(),
            motif: motif[0]?.libelle ?? f.annulation.motifCode,
          }
        : null,
      candidats: f.candidats.map((c) => ({
        ...c,
        moyen: nom.get(c.moyenCode)?.moyen ?? c.moyenCode,
        montantMineur: montantMineur(c.montantMineur),
      })),
    };
  },

  /**
   * Rattacher un justificatif à un autre règlement, sans preuve, du dossier.
   * Il quitte les règlements qu'il prouvait par un fait nouveau (R7).
   */
  async deplacerJustificatif(db: Requete, pieceId: string, paiementId: string): Promise<void> {
    await db.query(`select public.justificatif_deplacer($1, $2)`, [pieceId, paiementId]);
  },

  /**
   * Reprendre la photo : la nouvelle devient la preuve des mêmes règlements,
   * l'ancienne disparaît — dans la même transaction, ou rien. Une pièce
   * transmise au cabinet ne se remplace pas sans son accord.
   */
  async remplacerJustificatif(db: Requete, ancienId: string, nouveauId: string): Promise<boolean> {
    // L'ancienne photo d'un justificatif n'a pas d'écriture : elle est effacée.
    return effacerPar(db, ancienId, async () => {
      await db.query(`select public.justificatif_remplacer($1, $2)`, [ancienId, nouveauId]);
      return { effacee: true };
    });
  },

  /** Supprimer un reçu, ou un justificatif après l'avoir détaché de ses règlements. */
  async supprimerPieceQuiAccompagne(db: Requete, pieceId: string): Promise<boolean> {
    return effacerPar(db, pieceId, async () => {
      const { rows } = await db.query<{ effacee: boolean }>(
        `select public.piece_qui_accompagne_supprimer($1) as effacee`,
        [pieceId],
      );
      return { effacee: rows[0]?.effacee === true };
    });
  },

  /**
   * Inscrire un paiement sur une pièce.
   *
   * ================================================================= POURQUOI
   *
   * Demandé le 10 octobre 2026 : après la lecture, le moyen de paiement, et
   * la photo de son justificatif sauf en espèces.
   *
   * =========================================== UN PAIEMENT S'AJOUTE, IL NE SE CORRIGE PAS
   *
   * La table est append-only (R7). Un acompte puis un solde font DEUX lignes,
   * et c'est la réalité : une colonne sur la pièce aurait dit « payée par
   * chèque » là où il y a eu des espèces le 3 et un chèque le 28.
   *
   * Une erreur se corrige donc par un paiement d'annulation, daté, qui laisse
   * l'histoire lisible — jamais en réécrivant celui d'avant.
   *
   * ============================================ CE QUE CETTE MÉTHODE VÉRIFIE
   *
   * Que le moyen existe AU PACK, à la date du paiement. Un code inventé
   * passerait sinon sans bruit et l'écriture s'appuierait sur un compte de
   * trésorerie qui n'existe pas — faute invisible jusqu'à la balance.
   *
   * Ce qu'elle NE vérifie PAS : la présence du justificatif. Un dirigeant qui
   * n'a pas son talon sous la main doit pouvoir avancer, la pièce marquée
   * comme il se doit. Un écran qui refuse se contourne en cochant
   * « espèces », et l'information est perdue au lieu d'être gagnée.
   */
  async enregistrerPaiement(
    db: Requete,
    input: {
      pieceId: string;
      packId: string;
      moyenCode: string;
      /** En unités mineures. Nul quand rien n'a encore été payé. */
      montantMineur?: number | null;
      devise: string;
      payeLe?: string | null;
      justificatifPieceId?: string | null;
      /** Le numero du cheque, de la traite, la reference du virement. */
      reference?: string | null;
    },
  ): Promise<string> {
    // La porte vérifie le moyen au paramétrage du pack, à la date du règlement
    // (ou du jour), et tire dossier, établissement et visibilité de la pièce.
    const { rows } = await db.query<{ id: string }>(
      `select public.paiement_inscrire($1, $2, $3, $4::bigint, $5, $6::date, $7, $8) as id`,
      [
        input.pieceId,
        input.moyenCode,
        input.packId,
        input.montantMineur ?? null,
        input.devise,
        input.payeLe ?? null,
        input.justificatifPieceId ?? null,
        input.reference ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /**
   * Les pièces ISSUES d'une pièce : son reçu, ses justificatifs.
   *
   * Le cabinet doit pouvoir les télécharger avec la facture — « aussi du reçu
   * de dépense ou revenu ». Sans cette lecture, les documents existent, sont
   * transmis, et restent introuvables depuis la pièce qu'ils accompagnent.
   */
  async piecesIssuesDe(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      // Ceux de toutes ses versions : un reçu reste issu de la facture dont la
      // photo a été reprise.
      `select ${colonnesDeLaPiece()}
         from pieces_v where source_piece_id in (select app.versions_de_la_piece($1))
        order by created_at`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map(versPiece);
  },

  /**
   * Les documents RATTACHÉS à une pièce après sa lecture, dans un sens ou dans
   * l'autre : un bon de livraison, un avoir, un devis (24 octobre 2026).
   *
   * L'état courant d'une paire LOGIQUE est son dernier fait (`rattachements_v`,
   * bouts lus à leur version courante) ; une paire détachée n'est plus rendue.
   * `pieces_v` fait le reste : une pièce que ce lecteur ne voit pas
   * n'apparaît pas, même rattachée.
   */
  async piecesRattachees(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select ${colonnesDeLaPiece("p")}
         from rattachements_v r
         join pieces_v p
           on p.id = case when r.piece_id = $1 then r.piece_liee_id else r.piece_id end
        where (r.piece_id = $1 or r.piece_liee_id = $1) and r.fait = 'rattache'
        order by r.created_at`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map(versPiece);
  },

  /** Rattacher un document à une pièce. La base garde les règles (voir la migration). */
  async rattacher(db: Requete, pieceId: string, autreId: string): Promise<{ deja: boolean }> {
    const { rows } = await db.query<{ deja: boolean }>(
      `select (public.piece_rattacher($1, $2) ->> 'deja')::boolean as deja`,
      [pieceId, autreId],
    );
    return { deja: Boolean(rows[0]?.deja) };
  },

  /** Détacher un document — un fait nouveau, motivé ; le rattachement reste au registre. */
  async detacher(db: Requete, pieceId: string, autreId: string, motif: string): Promise<void> {
    await db.query(`select public.piece_detacher($1, $2, $3)`, [pieceId, autreId, motif]);
  },

  /**
   * Rattacher une preuve à un paiement DÉJÀ inscrit.
   *
   * Le paiement est en ajout seul : il ne se réécrit pas. La preuve tardive
   * est donc une écriture nouvelle, et c'est la dernière qui vaut — reprendre
   * une photo floue est le cas normal.
   */
  async rattacherJustificatif(db: Requete, paiementId: string, pieceId: string): Promise<void> {
    await db.query(`select public.paiement_rattacher_justificatif($1, $2)`, [paiementId, pieceId]);
  },

  /** Les paiements d'une pièce, du plus ancien au plus récent. */
  async paiementsDUnePiece(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select p.id, p.moyen_code, p.montant_mineur, p.devise, p.paye_le,
              p.justificatif_piece_id, p.created_at, p.reference,
              p.annule_paiement_id, p.annulation_motif_id, p.eteint, p.pack_version_id,
              app.dette_eteinte(p.id)::text as brut,
              (select e.id from ecritures_v e
                where e.paiement_id = p.id and e.nature = 'reglement'
                  and e.reverses_id is not null and e.status = 'proposee'
                order by e.created_at desc limit 1) as annulation_a_inscrire
         from paiements_v p
        -- Les règlements de toutes ses versions : une photo reprise garde ceux
        -- saisis sur l'ancienne, qui restent inscrits où ils sont nés (R7).
        where p.piece_id in (select app.versions_de_la_piece($1)) order by p.created_at`,
      [pieceId],
    );
    /*
     * La dette éteinte se lit par `app.dette_eteinte`, la même fonction que la
     * proposition de règlement ; ses décimales sont celles de la devise du
     * paiement (`ref.devises`), comme la proposition (revue de #148 : une
     * seule source d'exposant).
     */
    const decimalesDe = new Map<string, Promise<number>>();
    const decimales = (devise: string) => {
      let d = decimalesDe.get(devise);
      if (!d) {
        d = exposantDeLaDevise(db, devise);
        decimalesDe.set(devise, d);
      }
      return d;
    };
    const lignes = rows as Record<string, unknown>[];
    const dettes = await Promise.all(
      lignes.map(async (r) => {
        const brut = r["brut"] as string | null;
        const jour = r["paye_le"] as string | null;
        if (brut == null || jour == null) return null;
        const d = await decimales(r["devise"] as string);
        return Number(enUnitesExactes(brut, d));
      }),
    );
    return lignes.map((r, i) => ({
      id: r["id"] as string,
      moyenCode: r["moyen_code"] as string,
      montantMineur: r["montant_mineur"] === null ? null : Number(r["montant_mineur"]),
      detteEteinteMineur: dettes[i] ?? null,
      devise: r["devise"] as string,
      payeLe: (r["paye_le"] as string | null) ?? null,
      justificatifPieceId: (r["justificatif_piece_id"] as string | null) ?? null,
      createdAt: (r["created_at"] as Date).toISOString(),
      /** Le numéro du chèque, de la traite, la référence du virement. */
      reference: (r["reference"] as string | null) ?? null,
      /** Le paiement que cette ligne éteint, s'il s'agit d'une annulation. */
      annulePaiementId: (r["annule_paiement_id"] as string | null) ?? null,
      annulationMotifId: (r["annulation_motif_id"] as string | null) ?? null,
      /**
       * Éteint : annulé, ou annulation d'un autre.
       *
       * La vue répond pour les deux faces, et aucun écran ne choisit. « Ce
       * qui est payé aujourd'hui » est la somme des lignes NON éteintes —
       * une seule définition, un seul endroit.
       */
      eteint: Boolean(r["eteint"]),
      /** La contre-passation proposée qui attend l'expert du dossier. */
      annulationAInscrire: (r["annulation_a_inscrire"] as string | null) ?? null,
    }));
  },

  /**
   * Annuler un paiement — par une écriture nouvelle, motivée.
   *
   * Le 13 octobre 2026, une facture portait deux paiements au TTC plein :
   * le dirigeant avait voulu changer de moyen, et l'écran n'offrait
   * qu'« ajouter ». Le reçu qu'on en aurait tiré attestait le double.
   *
   * La table refuse l'UPDATE (R7) : un paiement est un fait déclaré, daté,
   * qui a pu partir au cabinet. La fonction du Socle inscrit donc la ligne
   * qui l'éteint, et refuse d'annuler deux fois ou d'annuler une annulation.
   */
  async annulerPaiement(db: Requete, paiementId: string, motifId: string): Promise<void> {
    await db.query(`select public.paiement_annuler($1, $2)`, [paiementId, motifId]);
  },

  /** Les motifs d'annulation du référentiel, traduits. */
  async motifsDAnnulation(db: Requete, locale: string) {
    const { rows } = await db.query(
      `select m.id, m.code, m.requires_note, m.pour, m.remplace,
              -- Proposé à la personne : en vigueur, et pas « systeme » (le
              -- motif qu'écrit la base quand un règlement éteint « pas encore
              -- payé »). Les autres restent lisibles : l'historique les nomme.
              (m.valid_to is null and m.pour <> 'systeme') as proposable,
              coalesce(l.value, m.code) as libelle
         from ref.paiement_motifs_annulation m
         left join ref.labels l
           on l.ns = 'paiement_motif_annulation' and l.key = m.code and l.locale = $1
        order by m.rang, m.code`,
      [locale],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      exigeUneNote: Boolean(r["requires_note"]),
      pour: r["pour"] as "reglement" | "non_paye" | "systeme",
      proposable: Boolean(r["proposable"]),
      remplace: Boolean(r["remplace"]),
    }));
  },

  /**
   * Corriger un règlement d'un geste : l'ancien s'annule avec son motif et
   * le nouveau s'inscrit, dans la même transaction (`paiement_corriger`). La
   * pièce n'est jamais, même un instant, sans règlement ou réglée deux fois,
   * et les règles de `un_reglement_dit_vrai` jugent le nouveau sans l'ancien.
   */
  async corrigerPaiement(
    db: Requete,
    input: {
      paiementId: string;
      motifId: string;
      moyenCode: string;
      montantMineur: number;
      payeLe: string;
      reference?: string | null;
    },
  ): Promise<string> {
    const { rows: moyen } = await db.query<{ code: string }>(
      `select m.code from ref_payment_means_v m
         join capture.paiements p on p.pack_version_id = m.pack_version_id
        where p.id = $1 and m.code = $2 and m.code <> 'non_paye'
          and m.valid_from <= $3::date and (m.valid_to is null or m.valid_to >= $3::date)`,
      [input.paiementId, input.moyenCode, input.payeLe],
    );
    if (moyen.length === 0) {
      throw Object.assign(
        new Error(refusAvecValeurs("refus.paiement.moyen_inconnu", { moyen: input.moyenCode })),
        { code: "22023" },
      );
    }
    const { rows } = await db.query<{ id: string }>(
      `select public.paiement_corriger($1, $2, $3, $4::bigint, $5::date, $6) as id`,
      [
        input.paiementId,
        input.motifId,
        input.moyenCode,
        input.montantMineur,
        input.payeLe,
        input.reference ?? null,
      ],
    );
    return rows[0]!.id;
  },
};
