/**
 * Le courriel d'une notification — une relance d'impayé, et toute autre que
 * `notif.poster` décide d'envoyer par courriel.
 *
 * Fonction pure. Le titre et le corps sont ceux que la base a rendus depuis
 * son gabarit, dans la langue de la personne ; l'habillage (la charte, le pied
 * de page, le lien de secours) vient du dictionnaire du Socle, dans la même
 * langue. Rien n'est écrit ici en français : un courriel arabe se lit de droite
 * à gauche, entièrement.
 */
import { LOCALES, MESSAGES, RTL_LOCALES, type Locale } from "@malica/socle/messages";

import {
  echapper,
  ENCRE,
  FILET,
  GRIS,
  PAPIER,
  POLICE,
  SOUCI,
  SOUCI_SUR_ENCRE,
} from "../courriel/charte.ts";

export interface Notification {
  locale: string;
  titre: string;
  corps: string;
  action: { libelle: string; url: string } | null;
}

function langue(locale: string): Locale {
  return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "fr";
}

export function courrielDeNotification(n: Notification): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (n.action && !/^https?:\/\//i.test(n.action.url)) throw new Error("lien d'action invalide");
  const loc = langue(n.locale);
  const m = MESSAGES[loc];
  const dir = RTL_LOCALES.includes(loc) ? "rtl" : "ltr";
  const aligne = dir === "rtl" ? "right" : "left";
  const titre = echapper(n.titre);
  const corps = echapper(n.corps);

  const texte = [
    n.titre,
    "",
    n.corps,
    ...(n.action ? ["", `${n.action.libelle} :`, n.action.url] : []),
    "",
    m["courriel.notif.pied"],
    "— Malica Office",
  ].join("\n");

  const bouton = n.action
    ? `<tr><td style="padding:28px 40px 8px 40px;" align="${aligne}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${ENCRE};">
<a href="${echapper(n.action.url)}" style="display:inline-block;padding:16px 30px;font-family:${POLICE};font-size:15px;font-weight:600;color:${PAPIER};text-decoration:none;">${echapper(n.action.libelle)}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;font-family:${POLICE};text-align:${aligne};">
<p style="margin:0;font-size:13px;line-height:1.6;color:${GRIS};">${echapper(m["courriel.notif.lienSecours"])}</p>
<p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${echapper(n.action.url)}" style="color:${ENCRE};text-decoration:underline;">${echapper(n.action.url)}</a></p>
</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="${loc}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${titre}</title>
</head>
<body style="margin:0;padding:0;background:${PAPIER};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPIER};">${corps}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPIER};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${FILET};">
<tr><td style="background:${ENCRE};padding:28px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:10px;height:10px;background:${SOUCI_SUR_ENCRE};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:0 12px;font-family:${POLICE};font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${PAPIER};">Malica Office</td>
</tr></table>
</td></tr>
<tr><td style="height:3px;background:${SOUCI};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:40px 40px 8px 40px;font-family:${POLICE};text-align:${aligne};">
<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:600;color:${ENCRE};">${titre}</h1>
<p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;color:${ENCRE};">${corps}</p>
</td></tr>
${bouton}
<tr><td style="padding:32px 40px 40px 40px;font-family:${POLICE};text-align:${aligne};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-top:1px solid ${FILET};padding-top:20px;font-size:13px;line-height:1.6;color:${GRIS};">${echapper(m["courriel.notif.pied"])}</td>
</tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  return { sujet: n.titre, html, texte };
}
