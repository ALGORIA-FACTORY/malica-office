/**
 * L'abonnement — le forfait, les places, ce que chaque société consomme.
 *
 * Ce dépôt n'ajoute AUCUNE logique à ce que la base rend (R3). Il ne compte
 * pas les places, ne calcule pas un plafond, ne somme rien, ne filtre ni ne
 * trie : la question est posée à une vue ou à une fonction, la réponse est
 * relayée telle quelle. Les montants restent des chaînes (`numeric`), les
 * motifs des codes — l'écran les traduit (R4).
 *
 * « La licence de l'appelant » est une condition des vues, pas un filtre d'ici :
 * elles ne rendent que la licence dont l'appelant est titulaire, et la RLS des
 * tables sous-jacentes s'applique à lui (`security_invoker`).
 *
 * Le plafond mord dans la base, jamais ici : `inviterSiege` délègue à
 * `public.siege_inviter`, qui refuse la place de trop.
 */

import type { Requete } from "../db.ts";

export const facturation = {
  /**
   * Le forfait de l'appelant. Titulaire : la ligne entière. Membre d'une
   * organisation de la licence (un collaborateur) : le compteur de lectures
   * seul, offre, prix et places à `null` — c'est la base qui le décide. `null`
   * quand l'appelant n'est rattaché à aucune licence. Plusieurs licences
   * détenues : la base rend la première par identifiant.
   */
  async monForfait(db: Requete) {
    const { rows } = await db.query(
      `select offre, statut, lectures_droit, lectures_consommees, lectures_restantes,
              organisations, sieges_occupes, sieges_inclus, sieges_max, prix_mensuel_ht
         from public.mon_forfait()`,
    );
    return rows[0] ?? null;
  },

  /** Les membres de toutes les organisations de la licence. */
  async sieges(db: Requete) {
    const { rows } = await db.query(
      `select user_id, nom, role, tenant_id, organisation
         from licence_sieges_v order by organisation, role, nom, user_id`,
    );
    return rows;
  },

  /** Les organisations de la licence, et ce que chacune a consommé ce mois-ci. */
  async organisations(db: Requete) {
    const { rows } = await db.query(
      `select tenant_id, nom, lectures_consommees
         from licence_organisations_v order by nom, tenant_id`,
    );
    return rows;
  },

  /**
   * Inviter un collaborateur sur une organisation de la licence.
   *
   * La base refuse si la licence est au complet, et si l'appelant n'est pas le
   * dirigeant de l'organisation. Rend l'invitation, comme `collab.inviter`.
   */
  async inviterSiege(db: Requete, email: string, tenantId: string) {
    const { rows } = await db.query<{
      r: { id: string; email: string; role: string; expiresAt: string; deja: boolean };
    }>(`select public.siege_inviter($1, $2) as r`, [tenantId, email]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_creee");
    return { ...r, deja: Boolean(r.deja) };
  },

  /**
   * Reprendre la place d'un membre. `{ libere, motif?, pieces }` : tant qu'il
   * reste des pièces personnelles à trancher, la base répond `libere: false` et
   * le CODE du motif.
   */
  async libererPlace(db: Requete, tenantId: string, membre: string) {
    const { rows } = await db.query<{
      r: { libere: boolean; motif?: string; pieces: number };
    }>(`select public.siege_reprendre_sa_place($1, $2) as r`, [tenantId, membre]);
    const r = rows[0]?.r;
    if (!r) throw new Error("siege.non_libere");
    return r;
  },
};
