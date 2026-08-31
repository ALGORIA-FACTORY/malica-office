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
 *    exactement les requêtes de `loadRegalicaContext`.
 *
 * Ce que ce dépôt ne fait PAS : lire. Les deux passes, le plan de tokens et la
 * désignation restent côté web, où vivent l'œil et le raisonneur. L'API sert
 * les données et persiste le résultat ; elle ne pense pas à leur place.
 */

import type { Requete } from "../db.ts";

/** Le chemin d'une pièce se déduit de la base : tenant, puis identifiant. */
function cheminRelatif(tenantId: string, pieceId: string): string {
  return `${tenantId}/${pieceId}`;
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
    },
  ): Promise<{ id: string; chemin: string }> {
    const { rows } = await db.query<{ id: string }>(
      `select public.capture_piece_register($1, $2, $3, $4, $5, $6::app.vis_t,
                                            null, $7::smallint) as id`,
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
      `select id, tenant_id, entity_id, vis, source, storage_path, status, created_at
         from pieces_v where tenant_id = $1 order by created_at desc limit 100`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map(versPiece);
  },

  /**
   * Le dossier d'une pièce : sa dernière extraction, ses citations, son plan de
   * tokens. Les octets ne sont pas ici — ils ont leur route.
   */
  async dossier(db: Requete, pieceId: string) {
    const { rows: pieces } = await db.query(
      `select id, tenant_id, entity_id, vis, source, storage_path, status, created_at
         from pieces_v where id = $1`,
      [pieceId],
    );
    const brut = (pieces as Record<string, unknown>[])[0];
    if (!brut) throw new Error("piece.not_found");

    const [{ rows: ex }, { rows: cit }, { rows: tok }] = await Promise.all([
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
    ]);

    const extraction = (ex as Record<string, unknown>[])[0];
    return {
      piece: versPiece(brut),
      extraction: extraction
        ? {
            id: extraction["id"] as string,
            contract: extraction["contract"] as string,
            payload: extraction["payload"],
            flags: extraction["flags"] ?? [],
            createdAt: extraction["created_at"] as string,
          }
        : null,
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

    const { rows: orgs } = await db.query(
      `select jurisdiction, currency from organizations_v where id = $1`,
      [piece["tenant_id"] as string],
    );
    const org = (orgs as Record<string, unknown>[])[0];
    const jurisdiction = (org?.["jurisdiction"] as string) ?? "TN";

    const { rows: packs } = await db.query(
      `select id from ref_packs_v
        where jurisdiction = $1 and effective_from <= current_date
        order by effective_from desc limit 1`,
      [jurisdiction],
    );
    const packId = (packs as Record<string, unknown>[])[0]?.["id"] as string | undefined;
    if (!packId) throw new Error("pack.absent");

    const [{ rows: taux }, { rows: charges }] = await Promise.all([
      db.query(`select code, label, rate from ref_tva_rates_v where pack_version_id = $1`, [
        packId,
      ]),
      db.query(`select code, label from ref_fiscal_charges_v where pack_version_id = $1`, [packId]),
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
      currency: (org?.["currency"] as string) ?? null,
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
    };
  },

  /**
   * Persiste le résultat de la lecture, et les articles cités qui en découlent.
   *
   * Les deux RPC sont ici dans UNE transaction, là où l'ancien flux les appelait
   * l'une après l'autre par le réseau. Une lecture persistée sans ses articles
   * n'existe plus.
   */
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
    },
  ): Promise<void> {
    await db.query(
      `select public.capture_read_persist($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
      [
        input.pieceId,
        JSON.stringify(input.tokens),
        input.contract,
        JSON.stringify(input.extract),
        JSON.stringify(input.citations),
        JSON.stringify(input.flags),
      ],
    );

    if (input.articles.length === 0) return;

    const { rows } = await db.query(
      `select main_account from ref_account_mappings_v
        where pack_version_id = $1 and document_kind = $2`,
      [input.packId, input.documentKind ?? "facture_achat"],
    );
    const compte = (rows as Record<string, unknown>[])[0]?.["main_account"] as string | undefined;

    await db.query(`select public.capture_articles_persist($1, $2, $3::date, $4, $5::jsonb)`, [
      input.pieceId,
      input.packId,
      input.documentDate ?? null,
      compte ?? null,
      JSON.stringify(input.articles),
    ]);
  },

  /**
   * Le dossier que l'assistant a le droit de lire.
   *
   * Reproduit `loadRegalicaContext` requête pour requête, limites comprises :
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

    const [
      { rows: packs },
      { rows: pieces },
      { rows: ecritures },
      { rows: echeances },
      { rows: motifs },
    ] = await Promise.all([
      db.query(
        `select version, effective_from from ref_packs_v
            where jurisdiction = $1 and effective_from <= current_date
            order by effective_from desc limit 1`,
        [(org["jurisdiction"] as string) ?? "TN"],
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

    const pack = (packs as Record<string, unknown>[])[0];
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
      piece,
    };
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
};
