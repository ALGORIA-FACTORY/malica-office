/**
 * Le courriel d'une notification — un seul gabarit pour les 35 genres d'événement
 * et pour les relances d'impayé.
 *
 * Fonction pure. Le titre et le corps sont ceux que la base a rendus depuis le
 * gabarit `email` du genre, dans la langue de la personne ; le ton (succès,
 * erreur, alerte, en cours, neutre) vient du même gabarit et colore la barre du
 * haut. L'habillage (la charte, le pied de page, le lien de secours) vient du
 * dictionnaire du Socle, dans la même langue. Rien n'est écrit ici en français :
 * un courriel arabe se lit de droite à gauche, entièrement.
 *
 * Le gabarit est responsive (une colonne de 600 px au plus, 16 px de gouttière
 * sur téléphone) et s'affiche en clair ou en sombre selon le client de messagerie.
 * Les couleurs sont fonctionnelles : aucune n'est décorative.
 */
import { LOCALES, MESSAGES, RTL_LOCALES, type Locale } from "@malica/socle/messages";

import {
  AMBRE,
  AZURE,
  CARTE,
  CARTE_SOMBRE,
  echapper,
  ENCRE,
  EVERGREEN,
  FILET,
  FILET_SOMBRE,
  FOND_SOMBRE,
  GRIS,
  GRIS_SOMBRE,
  PAPIER,
  POLICE,
  POLICE_ARABE,
  TEXTE_SOMBRE,
  VERMILION,
} from "../courriel/charte.ts";

/** Le ton d'un courriel : la couleur fonctionnelle de sa barre. */
export const TONS = ["neutre", "succes", "erreur", "alerte", "en_cours"] as const;
type Ton = (typeof TONS)[number];

const COULEUR_DU_TON: Record<Ton, string> = {
  succes: EVERGREEN,
  erreur: VERMILION,
  alerte: AMBRE,
  en_cours: AZURE,
  neutre: GRIS,
};

export interface Notification {
  locale: string;
  titre: string;
  corps: string;
  action: { libelle: string; url: string } | null;
  ton: string;
}

function langue(locale: string): Locale {
  return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "fr";
}

function tonConnu(ton: string): Ton {
  // Pas de repli : un ton inconnu est une erreur de gabarit, la base le refuse déjà.
  if ((TONS as readonly string[]).includes(ton)) return ton as Ton;
  throw new Error(`ton de courriel inconnu : ${ton}`);
}

/**
 * La feuille du gabarit : les classes portent les couleurs, de sorte que le mode
 * sombre et la mise en page téléphone se règlent ici, une seule fois.
 */
function feuille(police: string): string {
  return `<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 0; }
.fond { background: ${PAPIER}; }
.carte { background: ${CARTE}; border: 1px solid ${FILET}; }
.texte { color: ${ENCRE}; font-family: ${police}; }
.discret { color: ${GRIS}; font-family: ${police}; }
.filet { border-top: 1px solid ${FILET}; }
.bouton { background: ${ENCRE}; }
.bouton a { color: ${PAPIER}; }
.lien { color: ${ENCRE}; }
@media (prefers-color-scheme: dark) {
  .fond { background: ${FOND_SOMBRE} !important; }
  .carte { background: ${CARTE_SOMBRE} !important; border-color: ${FILET_SOMBRE} !important; }
  .texte { color: ${TEXTE_SOMBRE} !important; }
  .discret { color: ${GRIS_SOMBRE} !important; }
  .filet { border-color: ${FILET_SOMBRE} !important; }
  .bouton { background: ${TEXTE_SOMBRE} !important; }
  .bouton a { color: ${ENCRE} !important; }
  .lien { color: ${TEXTE_SOMBRE} !important; }
}
@media only screen and (max-width: 620px) {
  .gouttiere { padding: 16px 0 !important; }
  .pad { padding-left: 20px !important; padding-right: 20px !important; }
  .titre { font-size: 22px !important; }
  .bouton-plein { display: block !important; width: 100% !important; }
  .bouton-plein a { display: block !important; text-align: center !important; }
}
</style>`;
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
  const police = dir === "rtl" ? POLICE_ARABE : POLICE;
  const barre = COULEUR_DU_TON[tonConnu(n.ton)];
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
    ? `<tr><td class="pad" style="padding:28px 40px 8px 40px;" align="${aligne}">
<table role="presentation" class="bouton-plein" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="bouton" style="background:${ENCRE};border-radius:0;">
<a href="${echapper(n.action.url)}" style="display:inline-block;padding:16px 30px;font-family:${police};font-size:15px;font-weight:600;color:${PAPIER};text-decoration:none;">${echapper(n.action.libelle)}</a>
</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:20px 40px 0 40px;text-align:${aligne};">
<p class="discret" style="margin:0;font-size:13px;line-height:1.6;color:${GRIS};">${echapper(m["courriel.notif.lienSecours"])}</p>
<p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;word-break:break-all;"><a class="lien" href="${echapper(n.action.url)}" style="color:${ENCRE};text-decoration:underline;">${echapper(n.action.url)}</a></p>
</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="${loc}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${titre}</title>
${feuille(police)}
</head>
<body class="fond" style="margin:0;padding:0;background:${PAPIER};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPIER};">${corps}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fond" style="background:${PAPIER};">
<tr><td class="gouttiere" align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" class="carte" style="width:100%;max-width:600px;background:${CARTE};border:1px solid ${FILET};">
<tr><td class="pad" style="background:${ENCRE};padding:24px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:28px;height:28px;border:1px solid ${PAPIER};font-family:${POLICE};font-size:11px;font-weight:600;letter-spacing:0.02em;text-align:center;color:${PAPIER};">rG</td>
<td style="padding:0 12px;font-family:${police};font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${PAPIER};">Malica Office</td>
</tr></table>
</td></tr>
<tr><td style="height:4px;background:${barre};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="pad" style="padding:40px 40px 8px 40px;font-family:${police};text-align:${aligne};">
<h1 class="titre texte" style="margin:0;font-size:26px;line-height:1.25;font-weight:600;color:${ENCRE};">${titre}</h1>
<p class="texte" style="margin:18px 0 0 0;font-size:16px;line-height:1.6;color:${ENCRE};">${corps}</p>
</td></tr>
${bouton}
<tr><td class="pad" style="padding:32px 40px 40px 40px;font-family:${police};text-align:${aligne};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="filet discret" style="border-top:1px solid ${FILET};padding-top:20px;font-size:13px;line-height:1.6;color:${GRIS};">${echapper(m["courriel.notif.pied"])}</td>
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
