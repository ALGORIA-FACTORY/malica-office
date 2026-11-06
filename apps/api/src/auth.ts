/**
 * L'authentification — ce que GoTrue faisait, écrit ici.
 *
 * JWT et bcrypt, comme le prescrit le chapitre 08 du Guide de Stack. Le jeton
 * ne porte qu'une identité : tout ce qui décide d'un droit — appartenance,
 * rôle, mandat — est lu en base par les politiques RLS. Un jeton volé ne
 * confère donc rien de plus que l'identité qu'il nomme, et une révocation
 * d'appartenance prend effet immédiatement, sans attendre son expiration.
 *
 * Le jeton lui-même se révoque (audit du 6 novembre 2026, S4) : il porte un
 * identifiant de session (`sid`) et sa date d'émission à la milliseconde
 * (`iat`), confrontés à chaque requête à ce que la base tient — les sessions
 * fermées une à une, et l'instant avant lequel toutes les sessions du compte
 * sont closes (`20261202110100_le_jeton_d_acces_se_revoque`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import {
  horsRlsAuthentificationEnUneRequete,
  horsRlsAuthentificationSeule,
  sousIdentite,
  type Requete,
} from "./db.ts";

/**
 * Chaque incrément double le temps de calcul. 12 place une vérification autour
 * de 250 ms : assez lent pour rendre la force brute inutilisable, assez rapide
 * pour une connexion.
 */
const COUT_BCRYPT = 12;

/** Douze heures, comme le cookie du navigateur. Le jeton se révoque : la déconnexion le ferme. */
const DUREE_JETON = "12h";

export interface Utilisateur {
  id: string;
  email: string;
}

/** Ce qu'un jeton bien signé dit de la session qu'il ouvre. */
export interface JetonLu extends Utilisateur {
  /** L'identifiant de la session (`sid`) : ce que ferme la déconnexion d'un appareil. */
  session: string;
  /** Son émission, à la milliseconde : comparée à l'instant où tout a été fermé. */
  emisLe: Date;
  /** Son expiration : au-delà, le fermer ne sert plus à rien. */
  expireLe: Date;
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
  // `iat` à la milliseconde (une NumericDate peut être fractionnaire) : la
  // réinitialisation ferme les sessions puis en ouvre une, dans la même
  // seconde — à la seconde près, la nouvelle tomberait avec les anciennes.
  return jwt.sign(
    { sub: utilisateur.id, email: utilisateur.email, sid: randomUUID(), iat: Date.now() / 1000 },
    secret(),
    { expiresIn: DUREE_JETON },
  );
}

/**
 * La signature et la forme, sans la base — `sessionEnVigueur` dit le reste.
 * Un jeton sans `sid`, émis avant le 6 novembre 2026, ne se fermerait pas : il
 * n'ouvre plus rien, et la personne se reconnecte une fois.
 */
export function lireJeton(jeton: string): JetonLu | null {
  try {
    const charge = jwt.verify(jeton, secret()) as {
      sub?: string;
      email?: string;
      sid?: string;
      iat?: number;
      exp?: number;
    };
    if (!charge.sub || !charge.email || !charge.sid || !charge.iat || !charge.exp) return null;
    return {
      id: charge.sub,
      email: charge.email,
      session: charge.sid,
      // Arrondi, pas tronqué : 1762430000.123 × 1000 peut valoir …122,9999.
      emisLe: new Date(Math.round(charge.iat * 1000)),
      expireLe: new Date(charge.exp * 1000),
    };
  } catch {
    // Signature invalide, jeton expiré, forme inattendue : dans tous les cas
    // l'appelant n'est personne. On ne distingue pas les causes — le dire
    // renseignerait un attaquant sur ce qu'il doit corriger.
    return null;
  }
}

/**
 * La session de ce jeton tient-elle encore ? Ni fermée une à une, ni émise
 * avant l'instant où toutes l'ont été. Une requête hors transaction, deux
 * sondes d'index : le prix de la révocation, payé à chaque requête
 * authentifiée.
 */
export async function sessionEnVigueur(jeton: JetonLu): Promise<boolean> {
  const { rows } = await horsRlsAuthentificationEnUneRequete<{ tient: boolean }>(
    "select auth.session_en_vigueur($1, $2, $3) as tient",
    [jeton.id, jeton.session, jeton.emisLe],
  );
  return rows[0]?.tient === true;
}

/**
 * Ferme la session de ce jeton, et elle seule : la déconnexion d'un appareil.
 * Les fermetures dont le jeton a expiré ne servent plus, elles partent.
 */
export async function fermerLaSession(jeton: JetonLu): Promise<void> {
  await horsRlsAuthentificationSeule(async (db) => {
    await db.query(
      `insert into auth.sessions_fermees (id, user_id, expire_le)
         values ($1, $2, $3)
       on conflict (id) do nothing`,
      [jeton.session, jeton.id, jeton.expireLe],
    );
    await db.query(`delete from auth.sessions_fermees where expire_le < now()`);
  });
}

/**
 * Toutes les sessions du compte tombent : ses jetons d'accès émis jusqu'ici,
 * et ses jetons longs. Dans la transaction de l'appelant — la réinitialisation
 * le fait avec le changement de mot de passe, d'un seul geste.
 *
 * L'instant est tronqué à la milliseconde, la précision du jeton : celui
 * qu'émet ensuite le même geste n'est jamais « d'avant ».
 */
async function fermerToutesLesSessionsDans(db: Requete, userId: string): Promise<void> {
  await db.query(
    `update auth.users set sessions_invalidees_le = date_trunc('milliseconds', now())
      where id = $1`,
    [userId],
  );
  await db.query(
    `update auth.refresh_tokens set revoque_le = now()
      where user_id = $1 and revoque_le is null`,
    [userId],
  );
}

/** La déconnexion de partout : tous les appareils du compte. */
export async function fermerToutesLesSessions(userId: string): Promise<void> {
  await horsRlsAuthentificationSeule((db) => fermerToutesLesSessionsDans(db, userId));
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

/**
 * Ce que l'utilisateur voit de lui-même — lu sous la RLS, comme tout le reste.
 * Ses adhésions, réelles ou par l'accès total (`mes_adhesions_v`) : la table
 * des adhésions, lue sans filtre, rendait aussi celles de ses collègues.
 */
export async function organisations(utilisateur: Utilisateur) {
  return sousIdentite(utilisateur.id, async (db) => {
    const { rows } = await db.query(
      `select o.id, o.name, o.kind, m.role
         from mes_adhesions_v m
         join identity.organizations o on o.id = m.tenant_id
        order by o.name`,
    );
    return rows;
  });
}

/* ------------------------------------------------ le jeton de rafraîchissement
 *
 * Le jeton d'accès dure douze heures. Sur un téléphone, douze heures voudraient
 * dire un mot de passe chaque matin, et une file hors ligne qui se vide la nuit
 * tomberait en 401. D'où un second jeton, long, révocable parce qu'il vit en
 * base, par son empreinte, et qui tourne à chaque usage : un jeton volé ne vaut
 * qu'un seul rafraîchissement, et le
 * légitime, présenté ensuite, est refusé — ce qui se voit.
 *
 * Le navigateur n'en reçoit pas : il garde le cookie de douze heures.
 */

/** Trente jours : un dirigeant qui n'ouvre pas l'application pendant un mois se reconnecte. */
const DUREE_RAFRAICHISSEMENT_MS = 30 * 24 * 60 * 60 * 1000;

function empreinteDe(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function nouveauSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Émet un jeton de rafraîchissement pour cet utilisateur. Rend le secret, une seule fois. */
export async function emettreJetonDeRafraichissement(
  utilisateur: Utilisateur,
  appareil: string | null,
): Promise<string> {
  const secret = nouveauSecret();
  await horsRlsAuthentificationSeule((db) =>
    db.query(
      `insert into auth.refresh_tokens (user_id, empreinte, appareil, expire_le)
         values ($1, $2, $3, $4)`,
      [
        utilisateur.id,
        empreinteDe(secret),
        appareil,
        new Date(Date.now() + DUREE_RAFRAICHISSEMENT_MS),
      ],
    ),
  );
  return secret;
}

/**
 * Tourne un jeton : l'ancien est révoqué, un nouveau est émis, l'identité est
 * rendue. `null` si le jeton est inconnu, expiré ou déjà tourné — on ne dit
 * pas lequel, pour la même raison qu'à la connexion.
 */
export async function rafraichir(
  secret: string,
  appareil: string | null,
): Promise<{ utilisateur: Utilisateur; jetonRafraichissement: string } | null> {
  const nouveau = nouveauSecret();
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<{
      id: string;
      user_id: string;
      email: string;
      expire_le: Date;
      revoque_le: Date | null;
    }>(
      `select t.id, t.user_id, u.email, t.expire_le, t.revoque_le
         from auth.refresh_tokens t
         join auth.users u on u.id = t.user_id
        where t.empreinte = $1
        for update of t`,
      [empreinteDe(secret)],
    );
    const ancien = rows[0];
    if (!ancien || ancien.revoque_le || ancien.expire_le.getTime() < Date.now()) return null;

    const { rows: emis } = await db.query<{ id: string }>(
      `insert into auth.refresh_tokens (user_id, empreinte, appareil, expire_le)
         values ($1, $2, $3, $4)
       returning id`,
      [
        ancien.user_id,
        empreinteDe(nouveau),
        appareil,
        new Date(Date.now() + DUREE_RAFRAICHISSEMENT_MS),
      ],
    );
    await db.query(
      `update auth.refresh_tokens set revoque_le = now(), remplace_par = $2 where id = $1`,
      [ancien.id, emis[0]!.id],
    );
    return {
      utilisateur: { id: ancien.user_id, email: ancien.email },
      jetonRafraichissement: nouveau,
    };
  });
}

/* ------------------------------------------------ le mot de passe oublié
 *
 * Une demande rend un secret à envoyer par courriel — jamais à l'écran : la
 * réponse de l'API est la même que l'adresse existe ou non. Le secret vaut une
 * heure, une seule fois ; seule son empreinte est gardée. L'utiliser change le
 * mot de passe et ferme toutes les sessions du compte, jetons d'accès et jetons
 * longs : un téléphone perdu ne survit pas à un changement de mot de passe.
 */

const DUREE_REINITIALISATION_MS = 60 * 60 * 1000;

/** `null` si l'adresse est inconnue — l'appelant n'en dira rien. */
export async function demanderReinitialisation(
  email: string,
): Promise<{ email: string; secret: string; expireLe: Date } | null> {
  const secret = nouveauSecret();
  const expireLe = new Date(Date.now() + DUREE_REINITIALISATION_MS);
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<{ email: string }>(
      `insert into auth.reinitialisations (user_id, empreinte, expire_le)
       select u.id, $2, $3 from auth.users u where u.email = $1
       returning $1::text as email`,
      [email.toLowerCase(), empreinteDe(secret), expireLe],
    );
    const ligne = rows[0];
    return ligne ? { email: ligne.email, secret, expireLe } : null;
  });
}

/**
 * Change le mot de passe contre un secret valide. `null` si le secret est
 * inconnu, expiré ou déjà utilisé — sans dire lequel.
 */
export async function reinitialiser(
  secret: string,
  motDePasse: string,
): Promise<Utilisateur | null> {
  const empreinte = await bcrypt.hash(motDePasse, COUT_BCRYPT);
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<{
      id: string;
      user_id: string;
      email: string;
      expire_le: Date;
      utilise_le: Date | null;
    }>(
      `select r.id, r.user_id, u.email, r.expire_le, r.utilise_le
         from auth.reinitialisations r
         join auth.users u on u.id = r.user_id
        where r.empreinte = $1
        for update of r`,
      [empreinteDe(secret)],
    );
    const demande = rows[0];
    if (!demande || demande.utilise_le || demande.expire_le.getTime() < Date.now()) return null;
    await db.query(`update auth.users set encrypted_password = $2 where id = $1`, [
      demande.user_id,
      empreinte,
    ]);
    // Toutes les demandes du compte tombent avec celle-ci, et toutes ses
    // sessions : les jetons d'accès émis jusqu'ici, et les jetons longs.
    await db.query(
      `update auth.reinitialisations set utilise_le = now()
        where user_id = $1 and utilise_le is null`,
      [demande.user_id],
    );
    await fermerToutesLesSessionsDans(db, demande.user_id);
    return { id: demande.user_id, email: demande.email };
  });
}

/** Révoque un jeton — la déconnexion. Un jeton inconnu ou déjà révoqué ne dit rien. */
export async function revoquerJetonDeRafraichissement(secret: string): Promise<void> {
  await horsRlsAuthentificationSeule((db) =>
    db.query(
      `update auth.refresh_tokens set revoque_le = now()
        where empreinte = $1 and revoque_le is null`,
      [empreinteDe(secret)],
    ),
  );
}
