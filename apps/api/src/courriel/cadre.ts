/**
 * Le cadre commun de tous les courriels de Malica Office.
 *
 * Il suit l'anatomie des maquettes du 13 novembre 2026 (page Système) :
 *   1. repère rG, et la pastille de la société concernée ;
 *   2. étiquette : un point et un mot dans la couleur du signal ;
 *   3. titre : ce qui s'est passé, en une phrase ;
 *   4. texte : ce que ça change pour la personne ;
 *   5. bloc de données : une carte arrondie (montant, ligne, échéance…) ;
 *   6. bouton : une pilule pleine, un verbe ;
 *   7. lien de secours : l'adresse en clair, si le bouton ne s'ouvre pas ;
 *   8. signature : « — Malica » quand c'est elle qui parle ;
 *   9. pied : pourquoi ce message, et où régler ses alertes.
 *
 * Fonction pure : des valeurs entrent, le HTML sort.
 * Le HTML suit les contraintes des messageries, pas celles d'un navigateur :
 * tableaux, styles en ligne, 600 px au plus, une colonne sur téléphone. Le
 * clair est en ligne (Outlook l'affiche), le sombre vient de la feuille
 * (`prefers-color-scheme`). Tout texte reçu est échappé ; aucune phrase n'est
 * écrite ici — elles viennent du dictionnaire du Socle ou de la base.
 */
import { MESSAGES, RTL_LOCALES, type Locale } from "@malica/socle/messages";

import {
  CLAIR,
  echapper,
  POLICE,
  POLICE_ARABE,
  POLICE_MONO,
  SOMBRE,
  type Palette,
} from "./charte.ts";

/** Le signal de l'étiquette : la couleur fonctionnelle du message. */
export const SIGNAUX = ["fait", "attend", "retard", "info", "neutre"] as const;
export type Signal = (typeof SIGNAUX)[number];

/** Une ligne du bloc de données : un libellé à gauche, une valeur à droite. */
export interface LigneDeDonnees {
  libelle: string;
  valeur: string;
  /** La valeur est un chiffre ou une référence : en IBM Plex Mono. */
  mono?: boolean;
}

export interface Cadre {
  locale: Locale;
  /** L'adresse publique de l'appli : le repère et le lien des réglages en partent. */
  urlPublique: string;
  /** Le texte d'aperçu que montre la boîte de réception, sous l'objet. */
  apercu: string;
  /** La société concernée, en pastille à droite du repère. */
  organisation?: string | null;
  etiquette: { texte: string; signal: Signal };
  titre: string;
  /** Le texte : un ou deux paragraphes, déjà échappés ou écrits en HTML sûr. */
  paragraphesHtml: string[];
  donnees?: LigneDeDonnees[];
  action?: { libelle: string; url: string } | null;
  /** Une précision sous un filet, après le bouton (un lien personnel, une demande à ignorer). */
  noteHtml?: string | null;
  /** « — Malica » : quand c'est Malica qui parle à la première personne. */
  signature?: boolean;
  /** Pourquoi ce message arrive, en tête du pied. */
  raison: string;
}

/** La couleur et le fond d'un signal, dans une palette. */
function couleurDuSignal(p: Palette, s: Signal): string {
  switch (s) {
    case "fait":
      return p.fait;
    case "attend":
      return p.attend;
    case "retard":
      return p.retard;
    case "info":
      return p.info;
    case "neutre":
      return p.texte3;
  }
}

/** L'initiale de la société, dans sa pastille. */
function initiale(nom: string): string {
  const lettre = [...nom.trim()][0];
  return lettre ? lettre.toLocaleUpperCase("fr") : "·";
}

/**
 * La feuille : le sombre et le téléphone. Chaque classe remplace une couleur du
 * clair écrite en ligne ; les signaux portent chacun la leur.
 */
function feuille(signal: Signal): string {
  const s = SOMBRE;
  return `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; }
.logo-sombre { display: none; }
@media (prefers-color-scheme: dark) {
  .m-fond { background: ${s.fond} !important; }
  .m-carte { background: ${s.carte} !important; border-color: ${s.filet} !important; }
  .m-bloc { background: ${s.bloc} !important; border-color: ${s.filet} !important; }
  .m-filet { border-color: ${s.filet} !important; }
  .m-tx { color: ${s.texte} !important; }
  .m-t2 { color: ${s.texte2} !important; }
  .m-t3 { color: ${s.texte3} !important; }
  .m-signal { color: ${couleurDuSignal(s, signal)} !important; }
  .m-point { background: ${couleurDuSignal(s, signal)} !important; }
  .m-bouton { background: ${s.accent} !important; }
  .m-bouton a { color: ${s.surAccent} !important; }
  .m-pastille { border-color: ${s.filet} !important; }
  .m-initiale { background: ${s.faitFond} !important; color: ${s.fait} !important; }
  .logo-clair { display: none !important; }
  .logo-sombre { display: inline-block !important; }
}
@media only screen and (max-width: 620px) {
  .m-gouttiere { padding: 20px 12px !important; }
  .m-pad { padding-left: 22px !important; padding-right: 22px !important; }
  .m-titre { font-size: 25px !important; }
  .m-bouton-plein { width: 100% !important; }
  .m-bouton-plein a { display: block !important; text-align: center !important; }
}
</style>`;
}

/** Le repère rG : noir sur le clair, blanc sur le sombre ; son nom s'il n'est pas chargé. */
function repere(urlPublique: string, taille: number, opacite = 1): string {
  const style = `width:${taille}px;height:${taille}px;border:0;outline:none;text-decoration:none;opacity:${opacite};vertical-align:middle;`;
  return (
    `<img class="logo-clair" src="${echapper(`${urlPublique}/courriel/rg-noir.png`)}" width="${taille}" height="${taille}" alt="Malica Office" style="${style}">` +
    `<img class="logo-sombre" src="${echapper(`${urlPublique}/courriel/rg-blanc.png`)}" width="${taille}" height="${taille}" alt="" style="${style}display:none;">`
  );
}

/** Le HTML du courriel ; la version texte, chaque appelant l'écrit avec ses phrases. */
export function cadreDeCourriel(c: Cadre): string {
  if (c.action && !/^https?:\/\//i.test(c.action.url)) throw new Error("lien d'action invalide");
  if (!/^https?:\/\//i.test(c.urlPublique)) throw new Error("adresse publique invalide");
  if (!(SIGNAUX as readonly string[]).includes(c.etiquette.signal))
    throw new Error(`signal de courriel inconnu : ${c.etiquette.signal}`);

  const m = MESSAGES[c.locale];
  const p = CLAIR;
  const dir = RTL_LOCALES.includes(c.locale) ? "rtl" : "ltr";
  const debut = dir === "rtl" ? "right" : "left";
  const fin = dir === "rtl" ? "left" : "right";
  const police = dir === "rtl" ? POLICE_ARABE : POLICE;
  const signal = couleurDuSignal(p, c.etiquette.signal);
  const base = c.urlPublique.replace(/\/+$/, "");
  const reglages = `${base}/pme/reglages`;

  const pastille = c.organisation
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${fin}" class="m-pastille" style="border:1px solid ${p.filet};border-radius:999px;"><tr>
<td style="padding:5px 6px 5px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="m-initiale" width="22" height="22" align="center" style="width:22px;height:22px;border-radius:999px;background:${p.faitFond};color:${p.fait};font-family:${police};font-size:11px;font-weight:600;line-height:22px;">${echapper(initiale(c.organisation))}</td>
<td class="m-tx" style="padding:0 10px 0 8px;font-family:${police};font-size:13px;font-weight:600;color:${p.texte};white-space:nowrap;">${echapper(c.organisation)}</td>
</tr></table></td></tr></table>`
    : "";

  const donnees =
    c.donnees && c.donnees.length > 0
      ? `<tr><td class="m-pad" style="padding:22px 36px 0 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-bloc" style="background:${p.bloc};border:1px solid ${p.filet};border-radius:18px;">
<tr><td style="padding:6px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${c.donnees
  .map(
    (l, i) => `<tr>
<td class="m-t2${i > 0 ? " m-filet" : ""}" style="padding:13px 0;${i > 0 ? `border-top:1px solid ${p.filet};` : ""}font-family:${police};font-size:14px;line-height:1.4;color:${p.texte2};text-align:${debut};">${echapper(l.libelle)}</td>
<td class="m-tx${i > 0 ? " m-filet" : ""}" style="padding:13px 0;${i > 0 ? `border-top:1px solid ${p.filet};` : ""}font-family:${l.mono ? POLICE_MONO : police};font-size:14px;line-height:1.4;font-weight:600;color:${p.texte};text-align:${fin};">${echapper(l.valeur)}</td>
</tr>`,
  )
  .join("\n")}
</table>
</td></tr></table>
</td></tr>`
      : "";

  const bouton = c.action
    ? `<tr><td class="m-pad" style="padding:28px 36px 0 36px;" align="${debut}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="m-bouton-plein"><tr>
<td class="m-bouton" style="background:${p.accent};border-radius:999px;">
<a href="${echapper(c.action.url)}" style="display:inline-block;padding:15px 28px;font-family:${police};font-size:16px;line-height:22px;font-weight:600;color:${p.surAccent};text-decoration:none;border-radius:999px;">${echapper(c.action.libelle)}&nbsp;&nbsp;${dir === "rtl" ? "&larr;" : "&rarr;"}</a>
</td></tr></table>
</td></tr>
<tr><td class="m-pad" style="padding:18px 36px 0 36px;font-family:${police};text-align:${debut};">
<p class="m-t3" style="margin:0;font-size:12px;line-height:1.5;color:${p.texte3};">${echapper(m["courriel.notif.lienSecours"])}</p>
<p style="margin:4px 0 0 0;font-size:12px;line-height:1.5;word-break:break-all;" dir="ltr"><a class="m-t2" href="${echapper(c.action.url)}" style="font-family:${POLICE_MONO};color:${p.texte2};text-decoration:underline;">${echapper(c.action.url)}</a></p>
</td></tr>`
    : "";

  const note = c.noteHtml
    ? `<tr><td class="m-pad" style="padding:22px 36px 0 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="m-t3 m-filet" style="border-top:1px solid ${p.filet};padding-top:18px;font-family:${police};font-size:14px;line-height:1.6;color:${p.texte3};text-align:${debut};">${c.noteHtml}</td>
</tr></table>
</td></tr>`
    : "";

  const signature = c.signature
    ? `<tr><td class="m-pad" style="padding:24px 36px 0 36px;text-align:${debut};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="m-initiale" width="30" height="30" align="center" style="width:30px;height:30px;border-radius:999px;background:${p.faitFond};">${repere(base, 14, 0.9)}</td>
<td class="m-t2" style="padding:0 10px;font-family:${police};font-size:14px;color:${p.texte2};">${echapper(m["courriel.cadre.signature"])}</td>
</tr></table>
</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="${c.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${echapper(c.titre)}</title>
${feuille(c.etiquette.signal)}
</head>
<body class="m-fond" style="margin:0;padding:0;background:${p.fond};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${p.fond};">${echapper(c.apercu)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-fond" style="background:${p.fond};">
<tr><td class="m-gouttiere" align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:600px;">

<tr><td style="padding:0 4px 18px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="text-align:${debut};vertical-align:middle;">${repere(base, 30)}</td>
<td style="text-align:${fin};vertical-align:middle;" align="${fin}">${pastille}</td>
</tr></table>
</td></tr>

<tr><td class="m-carte" style="background:${p.carte};border:1px solid ${p.filet};border-radius:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="m-pad" style="padding:36px 36px 0 36px;font-family:${police};text-align:${debut};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;font-size:0;line-height:0;"><span class="m-point" style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${signal};"></span></td>
<td class="m-signal" style="padding:0 8px;font-family:${dir === "rtl" ? police : POLICE_MONO};font-size:12px;font-weight:600;letter-spacing:${dir === "rtl" ? "0" : "0.16em"};text-transform:uppercase;color:${signal};">${echapper(c.etiquette.texte)}</td>
</tr></table>
<h1 class="m-titre m-tx" style="margin:16px 0 0 0;font-size:30px;line-height:1.18;font-weight:600;letter-spacing:${dir === "rtl" ? "0" : "-0.02em"};color:${p.texte};">${echapper(c.titre)}</h1>
${c.paragraphesHtml.map((h) => `<p class="m-t2" style="margin:16px 0 0 0;font-size:16px;line-height:1.6;color:${p.texte2};">${h}</p>`).join("\n")}
</td></tr>
${donnees}
${bouton}
${note}
${signature}
<tr><td style="height:34px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>

<tr><td class="m-pad" style="padding:26px 6px 0 6px;font-family:${police};text-align:${debut};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;">${repere(base, 16, 0.6)}</td>
<td class="m-t3" style="padding:0 10px;font-family:${POLICE_MONO};font-size:11px;letter-spacing:0.14em;color:${p.texte3};" dir="ltr">MALICA OFFICE &middot; ALGORIA FACTORY &middot; TUNIS</td>
</tr></table>
<p class="m-t3" style="margin:10px 0 0 0;font-size:12px;line-height:1.6;color:${p.texte3};">${echapper(c.raison)} <a class="m-t2" href="${echapper(reglages)}" style="color:${p.texte2};text-decoration:underline;">${echapper(m["courriel.cadre.reglerAlertes"])}</a></p>
<p class="m-t3" style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:${p.texte3};">${echapper(m["courriel.cadre.devise"])}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

  return html;
}
