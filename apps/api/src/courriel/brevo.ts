/**
 * L'envoi d'un courriel transactionnel par Brevo.
 *
 * Un seul appel HTTP, sans bibliothèque : POST /v3/smtp/email, la clé dans
 * l'en-tête `api-key`. L'expéditeur doit être une adresse VÉRIFIÉE du compte
 * Brevo — sans quoi Brevo refuse, et l'invitation reste transmissible par son
 * lien.
 *
 * La configuration vient de l'environnement de l'API :
 *
 *   BREVO_API_KEY                la clé (posée par l'exploitant, jamais commitée)
 *   MALICA_COURRIEL_EXPEDITEUR   l'adresse vérifiée qui envoie
 *   MALICA_COURRIEL_NOM          le nom affiché (« Malica Office » par défaut)
 *   MALICA_URL_PUBLIQUE          l'adresse où le contact ouvre son lien
 *   MALICA_COURRIEL_PRODUCTION   « oui » en production, et là seulement
 *   MALICA_COURRIEL_DESTINATAIRES hors production : les adresses
 *                                (« a@b.tn ») et domaines (« @b.tn ») à qui
 *                                l'on écrit, séparés par des virgules
 *
 * Sans clé, rien n'est envoyé et on le dit (`null`) : le poste et la CI n'ont
 * pas à envoyer de vrais courriels. Une clé SANS expéditeur ou SANS adresse
 * publique est une erreur de configuration, pas un silence.
 *
 * LA GARDE DES DESTINATAIRES. La recette a une vraie clé Brevo et des données
 * qui ressemblent à de vraies : hors production, un courriel ne part que vers
 * une adresse de la liste, et une liste vide n'écrit à personne. La garde se
 * juge AU MOMENT DE L'ENVOI, dans `envoyerParBrevo` — tout chemin qui envoie
 * passe par elle — et un envoi retenu lève `CourrielRetenu`, que le
 * travailleur inscrit `retenu` en base (docs/exploitation.md).
 */

export interface ConfigurationCourriel {
  cle: string;
  expediteur: { email: string; nom: string };
  urlPublique: string;
  /** `null` en production (aucune restriction) ; sinon la liste, peut-être vide. */
  destinataires: ReadonlyArray<string> | null;
}

export interface Expedition {
  cle: string;
  expediteur: { email: string; nom: string };
  destinataires: ReadonlyArray<string> | null;
  destinataire: string;
  sujet: string;
  html: string;
  texte: string;
  /** Les pièces jointes : le PDF d'une facture, rendu par l'API. */
  pieces?: ReadonlyArray<{ nom: string; contenu: Buffer }>;
}

const API_BREVO = "https://api.brevo.com/v3/smtp/email";

/** La clé du refus qu'un envoi retenu inscrit en base (messages du socle). */
export const REFUS_HORS_LISTE = "refus.courriel.hors_liste";

/** Un courriel que la garde des destinataires n'a pas laissé partir. */
export class CourrielRetenu extends Error {
  constructor() {
    super(REFUS_HORS_LISTE);
    this.name = "CourrielRetenu";
  }
}

/** La liste de l'environnement : `null` en production, sinon les entrées en minuscules. */
function listeDesDestinataires(
  env: Record<string, string | undefined>,
): ReadonlyArray<string> | null {
  if (env["MALICA_COURRIEL_PRODUCTION"]?.trim().toLowerCase() === "oui") return null;
  return (env["MALICA_COURRIEL_DESTINATAIRES"] ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0);
}

/** Une adresse est permise si la liste est nulle, la nomme, ou nomme son domaine (« @domaine »). */
export function destinataireAutorise(
  liste: ReadonlyArray<string> | null,
  adresse: string,
): boolean {
  if (liste === null) return true;
  const a = adresse.trim().toLowerCase();
  const domaine = a.slice(a.lastIndexOf("@"));
  return liste.some((x) => (x.startsWith("@") ? x === domaine : x === a));
}

export function configurationCourriel(
  env: Record<string, string | undefined>,
): ConfigurationCourriel | null {
  const cle = env["BREVO_API_KEY"]?.trim();
  if (!cle) return null;
  const email = env["MALICA_COURRIEL_EXPEDITEUR"]?.trim();
  if (!email) throw new Error("BREVO_API_KEY est posée sans MALICA_COURRIEL_EXPEDITEUR");
  const url = env["MALICA_URL_PUBLIQUE"]?.trim();
  if (!url) throw new Error("BREVO_API_KEY est posée sans MALICA_URL_PUBLIQUE");
  return {
    cle,
    expediteur: { email, nom: env["MALICA_COURRIEL_NOM"]?.trim() || "Malica Office" },
    urlPublique: url.replace(/\/+$/, ""),
    destinataires: listeDesDestinataires(env),
  };
}

export async function envoyerParBrevo(
  e: Expedition,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string }> {
  if (!destinataireAutorise(e.destinataires, e.destinataire)) throw new CourrielRetenu();
  const reponse = await fetchImpl(API_BREVO, {
    method: "POST",
    headers: { "api-key": e.cle, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: e.expediteur.email, name: e.expediteur.nom },
      to: [{ email: e.destinataire }],
      subject: e.sujet,
      htmlContent: e.html,
      textContent: e.texte,
      ...(e.pieces?.length
        ? {
            attachment: e.pieces.map((p) => ({
              name: p.nom,
              content: p.contenu.toString("base64"),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!reponse.ok) {
    // Le corps de Brevo dit la raison ; la clé, elle, ne sort jamais d'ici.
    const raison = (await reponse.text().catch(() => "")).slice(0, 300);
    throw new Error(`Brevo a refusé le courriel (${reponse.status}) : ${raison}`);
  }
  const corps = (await reponse.json().catch(() => ({}))) as { messageId?: string };
  return { messageId: corps.messageId ?? "" };
}
