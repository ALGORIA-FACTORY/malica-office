/**
 * L'authentification — ce que GoTrue faisait, écrit ici.
 *
 * JWT et bcrypt, comme le prescrit le chapitre 08 du Guide de Stack. Le jeton
 * ne porte qu'une identité : tout ce qui décide d'un droit — appartenance,
 * rôle, mandat — est lu en base par les politiques RLS. Un jeton volé ne
 * confère donc rien de plus que l'identité qu'il nomme, et une révocation
 * d'appartenance prend effet immédiatement, sans attendre son expiration.
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { horsRlsAuthentificationSeule, sousIdentite } from "./db.ts";

/**
 * Chaque incrément double le temps de calcul. 12 place une vérification autour
 * de 250 ms : assez lent pour rendre la force brute inutilisable, assez rapide
 * pour une connexion.
 */
const COUT_BCRYPT = 12;

/** Court, parce qu'un jeton émis n'est pas révocable. */
const DUREE_JETON = "12h";

export interface Utilisateur {
  id: string;
  email: string;
}

function secret(): string {
  const valeur = process.env["JWT_SECRET"];
  if (!valeur || valeur.length < 32) {
    // Un secret absent ou court rendrait tous les jetons falsifiables. On
    // refuse de démarrer plutôt que de servir une authentification factice.
    throw new Error("JWT_SECRET absente ou trop courte (32 caractères minimum)");
  }
  return valeur;
}

export function emettreJeton(utilisateur: Utilisateur): string {
  return jwt.sign({ sub: utilisateur.id, email: utilisateur.email }, secret(), {
    expiresIn: DUREE_JETON,
  });
}

export function lireJeton(jeton: string): Utilisateur | null {
  try {
    const charge = jwt.verify(jeton, secret()) as { sub?: string; email?: string };
    if (!charge.sub || !charge.email) return null;
    return { id: charge.sub, email: charge.email };
  } catch {
    // Signature invalide, jeton expiré, forme inattendue : dans tous les cas
    // l'appelant n'est personne. On ne distingue pas les causes — le dire
    // renseignerait un attaquant sur ce qu'il doit corriger.
    return null;
  }
}

export async function creerCompte(
  email: string,
  motDePasse: string,
  nom?: string,
): Promise<Utilisateur | null> {
  const empreinte = await bcrypt.hash(motDePasse, COUT_BCRYPT);
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<Utilisateur>(
      // Pas de colonne de confirmation : il n'existe pas de flux de
      // vérification par courriel dans ce produit. En inventer une serait
      // prétendre à une garantie qui n'est pas tenue.
      `insert into auth.users (email, encrypted_password, raw_user_meta_data)
         values ($1, $2, $3)
         on conflict (email) do nothing
       returning id, email`,
      [email.toLowerCase(), empreinte, JSON.stringify(nom ? { display_name: nom } : {})],
    );
    // Aucune ligne : l'adresse existe déjà. L'appelant décidera quoi en dire —
    // et il dira la même chose que pour un mot de passe faux.
    return rows[0] ?? null;
  });
}

export async function verifierCompte(
  email: string,
  motDePasse: string,
): Promise<Utilisateur | null> {
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<Utilisateur & { encrypted_password: string | null }>(
      `select id, email, encrypted_password from auth.users where email = $1`,
      [email.toLowerCase()],
    );
    const compte = rows[0];

    // La comparaison est menée même sans compte, contre une empreinte factice :
    // sans cela, l'écart de temps de réponse dirait à un attaquant quelles
    // adresses existent.
    const empreinte = compte?.encrypted_password ?? `$2a$${COUT_BCRYPT}$${"x".repeat(53)}`;
    const valide = await bcrypt.compare(motDePasse, empreinte);

    if (!compte || !valide) return null;
    return { id: compte.id, email: compte.email };
  });
}

/** Ce que l'utilisateur voit de lui-même — lu sous la RLS, comme tout le reste. */
export async function organisations(utilisateur: Utilisateur) {
  return sousIdentite(utilisateur.id, async (db) => {
    const { rows } = await db.query(
      `select o.id, o.name, o.kind, m.role
         from identity.memberships m
         join identity.organizations o on o.id = m.tenant_id
        order by o.name`,
    );
    return rows;
  });
}
