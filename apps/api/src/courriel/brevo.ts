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
 *
 * Sans clé, rien n'est envoyé et on le dit (`null`) : le poste et la CI n'ont
 * pas à envoyer de vrais courriels. Une clé SANS expéditeur ou SANS adresse
 * publique est une erreur de configuration, pas un silence.
 */

export interface ConfigurationCourriel {
  cle: string;
  expediteur: { email: string; nom: string };
  urlPublique: string;
}

export interface Expedition {
  cle: string;
  expediteur: { email: string; nom: string };
  destinataire: string;
  sujet: string;
  html: string;
  texte: string;
}

const API_BREVO = "https://api.brevo.com/v3/smtp/email";

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
  };
}

export async function envoyerParBrevo(
  e: Expedition,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string }> {
  const reponse = await fetchImpl(API_BREVO, {
    method: "POST",
    headers: { "api-key": e.cle, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: e.expediteur.email, name: e.expediteur.nom },
      to: [{ email: e.destinataire }],
      subject: e.sujet,
      htmlContent: e.html,
      textContent: e.texte,
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
