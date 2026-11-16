/**
 * Le courriel qui rend l'accès à un compte dont le mot de passe est perdu.
 *
 * Le cadre commun (`cadre.ts`, maquette E03 du 13 novembre 2026), une version
 * texte qui dit la même chose. Le lien porte le secret
 * dans le FRAGMENT (`/reinitialiser#<secret>`) : il n'est jamais envoyé à un
 * serveur, ni dans un journal d'accès, ni dans un en-tête Referer.
 */

import { MESSAGES } from "@malica/socle/messages";

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { cadreDeCourriel } from "./cadre.ts";

export function courrielReinitialisation(lienBrut: string): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (!/^https?:\/\//i.test(lienBrut)) throw new Error("lien de réinitialisation invalide");
  const sujet = "Choisir un nouveau mot de passe — Malica Office";

  const texte = [
    `Bonjour,`,
    ``,
    `Une demande de nouveau mot de passe a été faite pour votre accès Malica Office.`,
    ``,
    `Choisir un nouveau mot de passe :`,
    lienBrut,
    ``,
    `Ce lien vaut une heure, une seule fois. Vos sessions ouvertes sur d'autres appareils seront fermées.`,
    ``,
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.`,
    ``,
    `— Malica Office`,
  ].join("\n");

  const html = cadreDeCourriel({
    locale: "fr",
    // Le repère et le lien des réglages partent de l'adresse publique, celle du lien.
    urlPublique: new URL(lienBrut).origin,
    apercu: "Le lien est valable une heure, une seule fois.",
    etiquette: { texte: MESSAGES.fr["courriel.etiquette.securite"], signal: "info" },
    titre: "Choisissez un nouveau mot de passe.",
    paragraphesHtml: [
      "Une demande a été faite pour votre accès Malica Office. Le lien ci-dessous est valable une heure, une seule fois. Vos sessions ouvertes sur d'autres appareils seront fermées.",
    ],
    action: { libelle: "Choisir un nouveau mot de passe", url: lienBrut },
    noteHtml:
      "Vous n'êtes pas à l'origine de cette demande&nbsp;? Ignorez ce message&nbsp;: votre mot de passe actuel reste valable.",
    raison: "Une demande de nouveau mot de passe a été faite pour cette adresse.",
  });

  return { sujet, html, texte };
}

/** Envoie le lien si Brevo est configuré. Ne lève jamais : la réponse de l'API ne doit rien trahir. */
export async function envoyerReinitialisation(
  i: { email: string; secret: string },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch = fetch,
): Promise<"envoye" | "non_configure" | "echec"> {
  if (!config) {
    console.warn("[reinitialisation] courriel non configuré : aucun lien envoyé");
    return "non_configure";
  }
  try {
    const c = courrielReinitialisation(`${config.urlPublique}/reinitialiser#${i.secret}`);
    await envoyerParBrevo(
      {
        cle: config.cle,
        expediteur: config.expediteur,
        destinataire: i.email,
        sujet: c.sujet,
        html: c.html,
        texte: c.texte,
      },
      fetchImpl,
    );
    return "envoye";
  } catch (e) {
    console.error(`[reinitialisation] courriel non envoyé : ${(e as Error).message}`);
    return "echec";
  }
}
