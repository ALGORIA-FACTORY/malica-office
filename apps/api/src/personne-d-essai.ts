/**
 * Des personnes d'essai qui existent.
 *
 * Une adhésion, un rôle d'opérateur, un profil, des préférences nomment une
 * personne de `auth.users` : depuis l'audit d'intégrité du 1er novembre 2026,
 * une clé étrangère le tient (`20261109090000_une_reference_nomme_ce_qui_existe`).
 * Les épreuves qui inventaient un identifiant (`randomUUID()`) pour un
 * dirigeant ou un opérateur créaient donc, sans le dire, des orphelins — la
 * base les refuse désormais. Elles créent d'abord la personne, ici.
 */
import type pg from "pg";

/** Crée, si elles n'existent pas, les personnes de ces identifiants. */
export async function personnesDEssai(
  db: Pick<pg.ClientBase, "query">,
  ...ids: string[]
): Promise<void> {
  await db.query(
    // Une personne d'essai a une adresse prouvée : les épreuves qui l'invitent
    // éprouvent l'invitation, pas la confirmation (`auth.confirmations_adresse`).
    `insert into auth.users (id, email, adresse_confirmee_le)
     select id, 'essai-' || id || '@essai.local', now() from unnest($1::uuid[]) as id
     on conflict (id) do nothing`,
    [ids],
  );
}

/**
 * La comptabilité a invité le dirigeant de la société dans Malica : une invitation acceptée,
 * envoyée par un membre de la comptabilité. C'est ce qui lui donne le droit d'attribuer un
 * abonnement à son client (`facturation.comptabilite_a_invite`, 20261231250000) ; une société
 * venue seule ne l'a pas.
 */
export async function inviteeParLaComptabilite(
  db: Pick<pg.ClientBase, "query">,
  pme: string,
  membreDeLaComptabilite: string,
): Promise<void> {
  await db.query(
    `insert into identity.invitations
       (tenant_id, email, role, token_hash, invited_by, expires_at, accepted_at)
     values ($1::uuid, 'dirigeant-' || $1::text || '@essai.local', 'dirigeant',
             encode(sha256(gen_random_uuid()::text::bytea), 'hex'), $2::uuid,
             now() + interval '7 days', now())`,
    [pme, membreDeLaComptabilite],
  );
}
