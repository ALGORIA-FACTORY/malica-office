/**
 * Les tiers — le grand livre auxiliaire.
 *
 * Un tiers appartient au DOSSIER, jamais au cabinet qui le saisit. C'est ce qui
 * fait que la balance auxiliaire d'une PME ne contient que ses clients, et que
 * deux PME suivies par le même cabinet ne se voient pas.
 *
 * Toutes ces méthodes prennent donc le tenant du DOSSIER en premier argument,
 * et la RLS fait le reste : un cabinet mandaté lit et écrit, un tiers ne voit
 * rien.
 */

import type { Requete } from "../db.ts";

export const tiers = {
  /** Les auxiliaires d'un dossier, filtrables par nature. */
  async lister(db: Requete, tenantId: string, nature: string | null) {
    const { rows } = await db.query(
      `select t.id, t.nature, t.code, t.raison_sociale, t.identifiant_fiscal,
              t.compte_collectif, t.actif, t.note, t.cree_le, t.categorie_de_bareme,
              a.label as compte_libelle
         from tiers_v t
         left join plan_comptable_v a
           on a.account_code = t.compte_collectif
          and (a.tenant_id is null or a.tenant_id = t.tenant_id)
        where t.tenant_id = $1
          and ($2::text is null or t.nature = $2)
        order by t.nature, t.code`,
      [tenantId, nature],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      nature: r["nature"] as string,
      code: r["code"] as string,
      raisonSociale: r["raison_sociale"] as string,
      identifiantFiscal: (r["identifiant_fiscal"] as string | null) ?? null,
      compteCollectif: r["compte_collectif"] as string,
      compteLibelle: (r["compte_libelle"] as string | null) ?? null,
      actif: Boolean(r["actif"]),
      note: (r["note"] as string | null) ?? null,
      creeLe: r["cree_le"] as string,
      categorieDeBareme: (r["categorie_de_bareme"] as string | null) ?? null,
    }));
  },

  /**
   * Les catégories d'émetteur d'un barème (le timbre : standard, grandes
   * surfaces), nommées dans la langue demandée (`ref.categories_de_bareme`).
   */
  async categoriesDeBareme(db: Requete, locale = "fr") {
    const { rows } = await db.query<{ code: string; libelle: string | null }>(
      `select c.code,
              coalesce(demandee.value, francais.value) as libelle
         from ref.categories_de_bareme c
         left join ref_labels_v demandee
           on demandee.ns = 'bareme_categorie' and demandee.key = c.code and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'bareme_categorie' and francais.key = c.code and francais.locale = 'fr'
        order by c.ordre`,
      [locale],
    );
    return rows.map((r) => ({ code: r.code, libelle: r.libelle ?? r.code }));
  },

  /**
   * Classe l'émetteur au barème d'un droit (le timbre) ; nulle : non classé.
   * La proposition d'une pièce le lit par son matricule (`bareme-du-timbre.ts`).
   */
  async classer(db: Requete, id: string, categorie: string | null): Promise<void> {
    await db.query(`select public.tiers_classer($1, $2)`, [id, categorie]);
  },

  /** Les comptes du plan qui acceptent un auxiliaire — 401, 411, 425, 442… */
  async comptesCollectifs(db: Requete) {
    const { rows } = await db.query(
      `select account_code, label, account_class, requires_auxiliary
         from comptes_collectifs_v`,
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["account_code"] as string,
      libelle: r["label"] as string,
      classe: r["account_class"] as string,
      exigeAuxiliaire: Boolean(r["requires_auxiliary"]),
    }));
  },

  /**
   * Ouvre un tiers. La base vérifie que le compte est bien collectif — un
   * auxiliaire rattaché à 606 n'aurait aucun sens comptable, et l'écran ne doit
   * pas être seul à le savoir.
   */
  async creer(
    db: Requete,
    input: {
      tenantId: string;
      nature: string;
      code: string;
      raisonSociale: string;
      compteCollectif: string;
      identifiantFiscal?: string | null;
      note?: string | null;
    },
  ): Promise<string> {
    // La porte normalise (code en capitales, espaces retirés) et refuse une
    // saisie vide ; la base vérifie que le compte est bien collectif.
    const { rows } = await db.query<{ id: string }>(
      `select public.tiers_ouvrir($1, $2, $3, $4, $5, $6, $7) as id`,
      [
        input.tenantId,
        input.nature,
        input.code,
        input.raisonSociale,
        input.compteCollectif,
        input.identifiantFiscal ?? null,
        input.note ?? null,
      ],
    );
    return rows[0]!.id;
  },

  async modifier(
    db: Requete,
    input: {
      id: string;
      raisonSociale: string;
      compteCollectif: string;
      identifiantFiscal?: string | null;
      note?: string | null;
    },
  ): Promise<void> {
    await db.query(`select public.tiers_modifier($1, $2, $3, $4, $5)`, [
      input.id,
      input.raisonSociale,
      input.compteCollectif,
      input.identifiantFiscal ?? null,
      input.note ?? null,
    ]);
  },

  /**
   * Désactive plutôt que supprime.
   *
   * Un tiers cité par une écriture passée ne s'efface pas : la balance
   * auxiliaire d'un exercice clos doit rester lisible. Il sort des listes de
   * saisie, il reste dans les livres.
   */
  async desactiver(db: Requete, id: string, actif: boolean): Promise<void> {
    await db.query(`select public.tiers_activer($1, $2)`, [id, actif]);
  },
};
