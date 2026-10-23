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

import type { Requete } from "../db.ts";
import { analyserPiece } from "../scan/analyse.ts";
import { effacerContenu } from "../stockage.ts";

import { referentiel } from "./referentiel.ts";

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

/** Le chemin d'une pièce se déduit de la base : tenant, puis identifiant. */
function cheminRelatif(tenantId: string, pieceId: string): string {
  return `${tenantId}/${pieceId}`;
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
): Promise<void> {
  if (input.articles.length === 0) return;

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
    sourcePieceId: (r["source_piece_id"] as string | null) ?? null,
  };
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
        input.vis,
        input.pageCount ?? null,
        input.documentKind ?? null,
        input.sourcePieceId ?? null,
      ],
    );
    const id = rows[0]!.id;

    // La clé d'idempotence peut rendre une pièce déjà enregistrée : on relit le
    // tenant plutôt que de faire confiance à celui qu'on a reçu.
    const { rows: ligne } = await db.query<{ tenant_id: string }>(
      `select tenant_id from pieces_v where id = $1`,
      [id],
    );
    const tenant = ligne[0]!.tenant_id;
    const chemin = cheminRelatif(tenant, id);

    await db.query(
      `update pieces_v
          set storage_path = $2,
              content_type = coalesce($3, content_type)
        where id = $1`,
      [id, chemin, input.contentType ?? null],
    );
    return { id, chemin };
  },

  async lister(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, entity_id, vis, source, storage_path, status, created_at,
                document_kind, document_kind_statut, gardee_le, source_piece_id
         from pieces_v where tenant_id = $1 order by created_at desc limit 100`,
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
      `select p.id, p.status, p.created_at, p.vis, p.gardee_le, p.document_kind, x.payload,
              (select valeur from precisions_v q
                where q.piece_id = p.id and q.champ = 'document_kind'
                order by decided_at desc limit 1) as precision_kind,
              ${REFUS_DE_LECTURE} as lecture_refusee
         from pieces_v p
         left join lateral (
           select e.payload
             from extractions_v e
            -- extract.v1 ET extract.v1.partiel : voir le commentaire au-dessus.
            where e.piece_id = p.id and e.contract like 'extract.v1%'
            order by e.created_at desc
            limit 1
         ) x on true
        where p.tenant_id = $1
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
      return {
        id: r["id"] as string,
        status: r["status"] as string,
        createdAt: r["created_at"] as string,
        vis: r["vis"] as string,
        gardeeLe: (r["gardee_le"] as string | null) ?? null,
        emetteur: lu?.issuer ?? null,
        dateDocument: lu?.document_date ?? null,
        kind:
          (lu?.document_kind as string | undefined) ??
          (r["precision_kind"] as string | null) ??
          null,
        total: lu?.totals?.ttc ?? null,
        devise: lu?.currency ?? null,
        typeDeDocument: (r["document_kind"] as string | null) ?? null,
        lectureRefusee: (r["lecture_refusee"] ?? null) as { motif: string; le: string } | null,
      };
    });
  },

  async dossier(db: Requete, pieceId: string) {
    const { rows: pieces } = await db.query(
      `select id, tenant_id, entity_id, vis, source, storage_path, status, created_at,
              document_kind, document_kind_statut, gardee_le, source_piece_id
         from pieces_v where id = $1`,
      [pieceId],
    );
    const brut = (pieces as Record<string, unknown>[])[0];
    if (!brut) throw new Error("piece.not_found");

    const [{ rows: ex }, { rows: cit }, { rows: tok }, { rows: prec }, { rows: refus }] =
      await Promise.all([
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
      `select id, tenant_id, storage_path, source, content_type from pieces_v where id = $1`,
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

    // L'échelle de la devise vient du pack, pas du code. La lecture des
    // montants s'en sert pour décider si un texte est ambigu : « 2.800 » se lit
    // de deux façons à trois décimales, d'une seule à deux.
    const { moneyDecimals } = await referentiel.socleParams(db, packId);

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
      },
      jurisdiction,
      currency: org["currency"] as string,
      moneyDecimals,
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
  ): Promise<{ id: string; champ: string; valeur: string }> {
    const { rows } = await db.query(`select public.capture_precision_persist($1, $2, $3) as p`, [
      pieceId,
      champ,
      valeur,
    ]);
    const p = (rows as Array<{ p: { id: string; champ: string; valeur: string } }>)[0]?.p;
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

  async persisterLecture(
    db: Requete,
    input: {
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
    },
  ): Promise<void> {
    await db.query(
      `select public.capture_read_persist($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb,
                                          $7, $8::jsonb)`,
      [
        input.pieceId,
        JSON.stringify(input.tokens),
        input.contract,
        JSON.stringify(input.extract),
        JSON.stringify(input.citations),
        JSON.stringify(input.flags),
        input.mode ?? null,
        JSON.stringify(input.confianceParChamp ?? {}),
      ],
    );

    await projeterLesArticles(db, input);
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
    if (!ligne) throw new Error("piece introuvable ou non autorisee");

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
      db.query(`select id, status from pieces_v where tenant_id = $1 limit 500`, [tenantId]),
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
   * Supprimer une pièce qui n'est encore partie nulle part.
   *
   * ============================================== CE QUI DÉCIDE, ET OÙ
   *
   * Pas ici. C'est `capture_piece_supprimer` qui refuse — pièce transmise,
   * pièce engagée, pièce servant de justificatif — et la RLS qui décide de ce
   * que l'appelant voit. Cette méthode ne fait qu'enchaîner deux gestes que la
   * base ne peut pas faire seule : demander, puis effacer les octets.
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
    const { rows } = await db.query<{ tenant_id: string }>(
      `select tenant_id from pieces_v where id = $1`,
      [pieceId],
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) return false;

    await db.query(`select public.capture_piece_supprimer($1, $2)`, [pieceId, parAccord]);
    // La base a dit oui : les octets n'ont plus de raison d'exister.
    await effacerContenu(tenantId, pieceId);
    return true;
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
    const au = input.payeLe ?? new Date().toISOString().slice(0, 10);
    const { rows: moyen } = await db.query<{ code: string }>(
      `select code from ref_payment_means_v
        where pack_version_id = $1 and code = $2
          and valid_from <= $3::date and (valid_to is null or valid_to >= $3::date)`,
      [input.packId, input.moyenCode, au],
    );
    if (moyen.length === 0) {
      throw Object.assign(
        new Error(`Ce moyen de paiement n'existe pas au paramétrage : ${input.moyenCode}`),
        { code: "22023" },
      );
    }

    const { rows } = await db.query<{ id: string }>(
      `insert into capture.paiements
         (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
          montant_mineur, devise, paye_le, justificatif_piece_id, reference)
       select p.tenant_id, p.entity_id, p.vis, p.id, $2, $3,
              $4::bigint, $5, $6::date, $7, $8
         from pieces_v p where p.id = $1
       returning id`,
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
    const id = rows[0]?.id;
    if (!id) throw new Error("piece introuvable ou non autorisee");
    return id;
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
      `select id, tenant_id, entity_id, vis, source, storage_path, status, created_at,
              document_kind, document_kind_statut, gardee_le, source_piece_id
         from pieces_v where source_piece_id = $1 order by created_at`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map(versPiece);
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
      `select id, moyen_code, montant_mineur, devise, paye_le,
              justificatif_piece_id, created_at, reference,
              annule_paiement_id, eteint
         from paiements_v where piece_id = $1 order by created_at`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      moyenCode: r["moyen_code"] as string,
      montantMineur: r["montant_mineur"] === null ? null : Number(r["montant_mineur"]),
      devise: r["devise"] as string,
      payeLe: (r["paye_le"] as string | null) ?? null,
      justificatifPieceId: (r["justificatif_piece_id"] as string | null) ?? null,
      createdAt: (r["created_at"] as Date).toISOString(),
      /** Le numéro du chèque, de la traite, la référence du virement. */
      reference: (r["reference"] as string | null) ?? null,
      /** Le paiement que cette ligne éteint, s'il s'agit d'une annulation. */
      annulePaiementId: (r["annule_paiement_id"] as string | null) ?? null,
      /**
       * Éteint : annulé, ou annulation d'un autre.
       *
       * La vue répond pour les deux faces, et aucun écran ne choisit. « Ce
       * qui est payé aujourd'hui » est la somme des lignes NON éteintes —
       * une seule définition, un seul endroit.
       */
      eteint: Boolean(r["eteint"]),
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
      `select m.id, m.code, m.requires_note,
              coalesce(l.value, m.code) as libelle
         from ref.paiement_motifs_annulation m
         left join ref.labels l
           on l.ns = 'paiement_motif_annulation' and l.key = m.code and l.locale = $1
        where m.valid_to is null
        order by m.rang, m.code`,
      [locale],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      exigeUneNote: Boolean(r["requires_note"]),
    }));
  },
};
