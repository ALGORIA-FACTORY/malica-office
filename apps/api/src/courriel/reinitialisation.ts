/**
 * Le courriel qui rend l'accès à un compte dont le mot de passe est perdu.
 *
 * Mêmes contraintes que l'invitation : tableaux, styles en ligne, aucune image
 * distante, une version texte qui dit la même chose. Le lien porte le secret
 * dans le FRAGMENT (`/reinitialiser#<secret>`) : il n'est jamais envoyé à un
 * serveur, ni dans un journal d'accès, ni dans un en-tête Referer.
 */

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { ENCRE, FILET, GRIS, PAPIER, POLICE, SOUCI, SOUCI_SUR_ENCRE, echapper } from "./charte.ts";

export function courrielReinitialisation(lienBrut: string): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (!/^https?:\/\//i.test(lienBrut)) throw new Error("lien de réinitialisation invalide");
  const lien = echapper(lienBrut);
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

  const html = `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${echapper(sujet)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPIER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPIER};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${FILET};">
<tr><td style="background:${ENCRE};padding:28px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:10px;height:10px;background:${SOUCI_SUR_ENCRE};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding-left:12px;font-family:${POLICE};font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${PAPIER};">Malica Office</td>
</tr></table>
</td></tr>
<tr><td style="height:3px;background:${SOUCI};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:44px 40px 8px 40px;font-family:${POLICE};">
<p style="margin:0 0 14px 0;font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${SOUCI};">Mot de passe</p>
<h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${ENCRE};">Choisissez un nouveau mot de passe.</h1>
<p style="margin:20px 0 0 0;font-size:16px;line-height:1.6;color:${ENCRE};">Une demande a été faite pour votre accès Malica Office.</p>
</td></tr>
<tr><td style="padding:32px 40px 8px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${ENCRE};">
<a href="${lien}" style="display:inline-block;padding:16px 30px;font-family:${POLICE};font-size:15px;font-weight:600;color:${PAPIER};text-decoration:none;">Choisir mon mot de passe&nbsp;&nbsp;&rarr;</a>
</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;font-family:${POLICE};">
<p style="margin:0;font-size:13px;line-height:1.6;color:${GRIS};">Le bouton ne s'ouvre pas&nbsp;? Copiez ce lien dans votre navigateur&nbsp;:</p>
<p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${lien}" style="color:${ENCRE};text-decoration:underline;">${lien}</a></p>
</td></tr>
<tr><td style="padding:32px 40px 40px 40px;font-family:${POLICE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-top:1px solid ${FILET};padding-top:20px;font-size:13px;line-height:1.6;color:${GRIS};">
Ce lien vaut <strong style="color:${ENCRE};font-weight:600;">une heure</strong>, une seule fois. Vos sessions ouvertes sur d'autres appareils seront fermées.<br>
Si vous n'êtes pas à l'origine de cette demande, ignorez ce message&nbsp;: votre mot de passe actuel reste valable.
</td>
</tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
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
