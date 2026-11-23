/**
 * Un compte d'essai dont l'adresse est prouvée.
 *
 * Depuis l'audit du 23 novembre 2026, un compte neuf n'a qu'une adresse
 * DÉCLARÉE : aucune invitation ne s'ouvre pour lui avant le lien de
 * confirmation (`auth.confirmations_adresse`), seule preuve admise. Les
 * épreuves qui éprouvent l'invitation, la matrice des droits ou l'entrée en
 * relation partent d'une adresse déjà prouvée — c'est la confirmation elle-même
 * qu'éprouve `une-adresse-se-prouve-avant-l-invitation.test.ts`.
 */
import { creerCompte, type Utilisateur } from "./auth.ts";
import { horsRlsAuthentificationSeule } from "./db.ts";

export async function compteDEssai(
  email: string,
  motDePasse: string,
  nom?: string,
): Promise<Utilisateur | null> {
  const u = await creerCompte(email, motDePasse, nom);
  if (!u) return null;
  await horsRlsAuthentificationSeule((db) =>
    db.query(`update auth.users set adresse_confirmee_le = now() where id = $1`, [u.id]),
  );
  return u;
}
