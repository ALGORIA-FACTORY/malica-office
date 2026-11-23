/**
 * La notification de paiement de Flouci (webhook v2, docs.flouci.com « Payment
 * Webhooks », relue le 23 novembre 2026).
 *
 * ================================================================== POURQUOI
 *
 * Sans elle, un paiement n'est constaté que si le client revient sur Malica :
 * un client qui paie puis ferme l'onglet reste débité et impayé jusqu'à son
 * retour (audit du 23 novembre 2026, M3). Flouci appelle cette adresse dès que
 * le paiement atteint un état final, et relance jusqu'à cinq fois tant qu'il ne
 * reçoit pas de 2xx.
 *
 * ================================================================ CE QUI FAIT FOI
 *
 * La notification ne décide RIEN. Elle est un signal : sa signature prouve
 * qu'elle vient de Flouci, puis le paiement est vérifié chez Flouci par le même
 * chemin que le retour du client (`facturation.verifierPaiement`) — montant et
 * identifiant recoupés, verrou, « payé une fois ». Une notification rejouée,
 * dupliquée ou forgée ne peut donc rien solder de plus que ce que Flouci
 * confirme lui-même.
 *
 * ================================================================== LA SIGNATURE
 *
 * `X-Flouci-Signature: t=<horodatage unix>,v1=<HMAC-SHA256 hexadécimal>`, clé :
 * le jeton privé de l'application, contenu signé : `"<t>.<corps brut>"` octet
 * par octet. L'horodatage est refusé au-delà de `FENETRE_MS` (rejeu), et la
 * comparaison se fait en temps constant.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** L'écart toléré entre l'horodatage signé et l'horloge du serveur (doc Flouci : 300 s). */
export const FENETRE_MS = 300_000;

/**
 * Le chemin de l'API où Flouci notifie. `app.ts` le monte en toutes lettres :
 * le test du Caddyfile lit les routes de l'API dans son texte, et Caddy comme le
 * relais de développement doivent le router.
 */
const CHEMIN_NOTIFICATION_FLOUCI = "/notifications-de-paiement/flouci";

/** L'adresse de notification d'un environnement, à donner à Flouci avec chaque session. */
export function adresseDeNotification(urlPublique: string): string {
  return `${urlPublique.replace(/\/+$/, "")}${CHEMIN_NOTIFICATION_FLOUCI}`;
}

/**
 * La signature de Flouci est-elle valide pour ce corps brut ? `false` pour tout
 * en-tête absent, mal formé, trop ancien ou faux — sans dire lequel.
 */
export function signatureFlouciValide(
  entete: string | undefined,
  corpsBrut: Buffer,
  clePrivee: string,
  maintenant: number = Date.now(),
): boolean {
  if (!entete || !clePrivee) return false;
  const champs = new Map<string, string>();
  for (const morceau of entete.split(",")) {
    const i = morceau.indexOf("=");
    if (i > 0) champs.set(morceau.slice(0, i).trim(), morceau.slice(i + 1).trim());
  }
  const t = champs.get("t");
  const v1 = champs.get("v1");
  if (!t || !/^[0-9]{1,12}$/.test(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(maintenant - Number(t) * 1000) > FENETRE_MS) return false;
  const attendu = createHmac("sha256", clePrivee).update(`${t}.`).update(corpsBrut).digest();
  const recu = Buffer.from(v1, "hex");
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ce qu'on retient d'une notification signée : le paiement de Malica
 * (`developer_tracking_id`) et la session Flouci (`payment_id`). Le reste du
 * corps — l'événement, le montant — n'est pas cru : Flouci sera interrogé.
 */
export function lireNotification(
  corpsBrut: Buffer,
): { paiementId: string; reference: string } | null {
  let corps: unknown;
  try {
    corps = JSON.parse(corpsBrut.toString("utf8"));
  } catch {
    return null;
  }
  if (!corps || typeof corps !== "object") return null;
  const c = corps as Record<string, unknown>;
  const paiementId = c["developer_tracking_id"];
  const reference = c["payment_id"];
  if (typeof paiementId !== "string" || !UUID.test(paiementId)) return null;
  if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(reference)) return null;
  return { paiementId, reference };
}
