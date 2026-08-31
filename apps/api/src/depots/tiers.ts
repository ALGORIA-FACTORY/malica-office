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
              t.compte_collectif, t.actif, t.note, t.cree_le,
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
    }));
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
    const { rows } = await db.query<{ id: string }>(
      `insert into tiers_v
         (tenant_id, nature, code, raison_sociale, compte_collectif, identifiant_fiscal, note)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        input.tenantId,
        input.nature,
        input.code.trim().toUpperCase(),
        input.raisonSociale.trim(),
        input.compteCollectif.trim(),
        input.identifiantFiscal?.trim() || null,
        input.note?.trim() || null,
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
    await db.query(
      `update tiers_v
          set raison_sociale = $2, compte_collectif = $3,
              identifiant_fiscal = $4, note = $5
        where id = $1`,
      [
        input.id,
        input.raisonSociale.trim(),
        input.compteCollectif.trim(),
        input.identifiantFiscal?.trim() || null,
        input.note?.trim() || null,
      ],
    );
  },

  /**
   * Désactive plutôt que supprime.
   *
   * Un tiers cité par une écriture passée ne s'efface pas : la balance
   * auxiliaire d'un exercice clos doit rester lisible. Il sort des listes de
   * saisie, il reste dans les livres.
   */
  async desactiver(db: Requete, id: string, actif: boolean): Promise<void> {
    await db.query(`update tiers_v set actif = $2 where id = $1`, [id, actif]);
  },
};
