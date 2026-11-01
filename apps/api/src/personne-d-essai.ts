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
    `insert into auth.users (id, email)
     select id, 'essai-' || id || '@essai.local' from unnest($1::uuid[]) as id
     on conflict (id) do nothing`,
    [ids],
  );
}
