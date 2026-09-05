/**
 * Les intégrations du cabinet — ce qui entre et ce qui sort du Socle.
 *
 * Ce dépôt sert un panneau, et tout ce qu'il y affiche vient d'une lecture :
 * l'état d'une intégration est ce que les tables disent — les pièces arrivées
 * par l'application, les lignes de relevé importées, les exports produits, les
 * clés qui ont servi. Aucun connecteur n'est déclaré ici : s'il n'a pas laissé
 * de trace en base, il n'existe pas pour ce panneau.
 *
 * La clé d'API se crée et se révoque par des fonctions de la base, qui
 * journalisent. La valeur en clair n'est rendue qu'à la création ; la vue ne
 * porte pas l'empreinte.
 */

import type { Requete } from "../db.ts";

interface CleBrute {
  id: string;
  libelle: string;
  prefixe: string;
  suffixe: string;
  portees: string[];
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

interface EtatBrut {
  cles_actives: number | string;
  dernier_usage: Date | string | null;
  pieces_app_30j: number | string;
  derniere_piece_app: Date | string | null;
  lignes_releves_30j: number | string;
  dernier_import_releve: Date | string | null;
  exports_30j: number | string;
  dernier_export: Date | string | null;
}

/** Un instant de la base, en ISO, ou rien. */
function instant(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export const integrations = {
  /** Les clés du cabinet, actives d'abord, sans jamais la valeur en clair. */
  async cles(db: Requete, tenantId: string) {
    const { rows } = await db.query<CleBrute>(
      `select id, libelle, prefixe, suffixe, portees, created_at, last_used_at, revoked_at
         from api_keys_v
        where tenant_id = $1
        order by (revoked_at is not null), created_at desc`,
      [tenantId],
    );
    return rows.map((k) => ({
      id: k.id,
      libelle: k.libelle,
      prefixe: k.prefixe,
      suffixe: k.suffixe,
      portees: k.portees,
      createdAt: instant(k.created_at)!,
      lastUsedAt: instant(k.last_used_at),
      revokedAt: instant(k.revoked_at),
    }));
  },

  /** Crée une clé et rend sa valeur en clair — la seule fois où elle est lisible. */
  async creerCle(db: Requete, tenantId: string, libelle: string, portees: string[]) {
    const { rows } = await db.query<{
      r: { id: string; cle: string; prefixe: string; suffixe: string };
    }>(`select public.api_key_creer($1, $2, $3::text[]) as r`, [tenantId, libelle, portees]);
    const r = rows[0]?.r;
    if (!r) throw new Error("cle.non_creee");
    return { id: r.id, cle: r.cle, prefixe: r.prefixe, suffixe: r.suffixe };
  },

  /** Révoque une clé. Elle reste listée, révoquée : une clé ne s'efface pas. */
  async revoquerCle(db: Requete, id: string): Promise<void> {
    await db.query(`select public.api_key_revoquer($1)`, [id]);
  },

  /**
   * L'état des intégrations, tel que les tables le disent.
   *
   * Le périmètre est le cabinet et ses mandats actifs — ce que la RLS rend de
   * toute façon ; la jointure sur les mandats ne fait que nommer ce périmètre.
   * Les fenêtres de trente jours sont des fenêtres d'affichage, pas des règles.
   */
  async etat(db: Requete, tenantId: string) {
    const { rows } = await db.query<EtatBrut>(
      `with perimetre as (
         select g.pme_org_id as id
           from engagements_v g
          where g.cabinet_org_id = $1 and g.status = 'actif'
         union
         select $1::uuid
       )
       select
         (select count(*) from api_keys_v k
           where k.tenant_id = $1 and k.revoked_at is null)                     as cles_actives,
         (select max(k.last_used_at) from api_keys_v k
           where k.tenant_id = $1)                                               as dernier_usage,
         (select count(*) from pieces_v p
           where p.tenant_id in (select id from perimetre) and p.source = 'photo'
             and p.created_at >= now() - interval '30 days')                    as pieces_app_30j,
         (select max(p.created_at) from pieces_v p
           where p.tenant_id in (select id from perimetre) and p.source = 'photo') as derniere_piece_app,
         (select count(*) from banque_lignes_v l
           where l.tenant_id in (select id from perimetre)
             and l.created_at >= now() - interval '30 days')                    as lignes_releves_30j,
         (select max(l.created_at) from banque_lignes_v l
           where l.tenant_id in (select id from perimetre))                      as dernier_import_releve,
         (select count(*) from exports_v x
           where x.tenant_id = $1 and x.created_at >= now() - interval '30 days') as exports_30j,
         (select max(x.created_at) from exports_v x where x.tenant_id = $1)      as dernier_export`,
      [tenantId],
    );
    const e = rows[0];
    if (!e) throw new Error("integrations.illisibles");
    return {
      clesActives: Number(e.cles_actives),
      dernierUsage: instant(e.dernier_usage),
      piecesApp30j: Number(e.pieces_app_30j),
      dernierePieceApp: instant(e.derniere_piece_app),
      lignesReleves30j: Number(e.lignes_releves_30j),
      dernierImportReleve: instant(e.dernier_import_releve),
      exports30j: Number(e.exports_30j),
      dernierExport: instant(e.dernier_export),
    };
  },
};
