/**
 * Le courriel qui invite le contact d'une PME à rejoindre son espace.
 *
 * Fonction pure : des noms, un lien, une date — un sujet, un HTML, un texte.
 * Le HTML suit les contraintes des messageries, pas celles d'un navigateur :
 * tableaux, styles en ligne, aucune feuille ni image distante (bloquées par
 * défaut chez beaucoup), 600 px de large, lisible sans ses couleurs. La
 * version texte dit la même chose, pour les messageries qui n'affichent pas le
 * HTML et pour les filtres qui s'en méfient.
 *
 * L'identité est celle de l'application : l'encre et le papier, le souci en
 * accent, Inter quand la messagerie la connaît. Tout ce que le cabinet a
 * saisi est échappé.
 */

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { ENCRE, FILET, GRIS, PAPIER, POLICE, SOUCI, SOUCI_SUR_ENCRE, echapper } from "./charte.ts";

export interface InvitationCourriel {
  cabinet: string;
  pme: string;
  lien: string;
  expireLe: Date;
}

function dateLisible(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Tunis",
  }).format(d);
}

export function courrielInvitation(i: InvitationCourriel): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (!/^https?:\/\//i.test(i.lien)) throw new Error("lien d'invitation invalide");

  const cabinet = echapper(i.cabinet);
  const pme = echapper(i.pme);
  const lien = echapper(i.lien);
  const jusquau = dateLisible(i.expireLe);

  const sujet = `${i.cabinet} vous ouvre votre espace Malica`;

  const texte = [
    `Bonjour,`,
    ``,
    `${i.cabinet} a ouvert le dossier de ${i.pme} sur Malica Office, et vous invite à le rejoindre.`,
    ``,
    `Photographiez vos factures : Malica les lit, les classe, et les transmet à votre cabinet.`,
    ``,
    `Rejoindre mon espace :`,
    i.lien,
    ``,
    `Ce lien est personnel. Il vaut jusqu'au ${jusquau}, une seule fois, avec l'adresse à laquelle ce courriel vous parvient.`,
    ``,
    `Si vous n'attendiez pas cette invitation, ignorez ce message : rien ne se passera.`,
    ``,
    `— Malica Office`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${echapper(sujet)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPIER};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPIER};">${cabinet} a ouvert le dossier de ${pme}. Votre espace vous attend.</div>
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
<p style="margin:0 0 14px 0;font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${SOUCI};">Invitation</p>
<h1 style="margin:0;font-size:30px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${ENCRE};">Votre espace est prêt.</h1>
<p style="margin:20px 0 0 0;font-size:17px;line-height:1.6;color:${ENCRE};"><strong style="font-weight:600;">${cabinet}</strong> a ouvert le dossier de <strong style="font-weight:600;">${pme}</strong> sur Malica Office, et vous invite à le rejoindre.</p>
<p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;color:${GRIS};">Photographiez vos factures : Malica les lit, les classe, et les transmet à votre cabinet.</p>
</td></tr>

<tr><td style="padding:32px 40px 8px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${ENCRE};">
<a href="${lien}" style="display:inline-block;padding:16px 30px;font-family:${POLICE};font-size:15px;font-weight:600;letter-spacing:0.02em;color:${PAPIER};text-decoration:none;">Rejoindre mon espace&nbsp;&nbsp;&rarr;</a>
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
Ce lien est personnel. Il vaut jusqu'au <strong style="color:${ENCRE};font-weight:600;">${jusquau}</strong>, une seule fois, avec l'adresse à laquelle ce courriel vous parvient.<br>
Si vous n'attendiez pas cette invitation, ignorez ce message&nbsp;: rien ne se passera.
</td>
</tr></table>
</td></tr>

</table>
<p style="margin:20px 0 0 0;font-family:${POLICE};font-size:11px;letter-spacing:0.08em;color:${GRIS};">MALICA OFFICE &middot; envoyé à la demande de ${cabinet}</p>
</td></tr>
</table>
</body>
</html>
`;

  return { sujet, html, texte };
}

export type StatutCourriel = "envoye" | "non_configure" | "echec";

/**
 * Envoie l'invitation si Brevo est configuré. Ne lève jamais : l'invitation
 * existe déjà en base, et un courriel refusé ne doit pas la défaire — le lien
 * reste à transmettre par le cabinet, et la réponse dit ce qui s'est passé.
 * `lien` est l'adresse absolue quand l'adresse publique est connue ; sinon
 * l'écran la compose depuis sa propre origine.
 *
 * Le jeton est dans le FRAGMENT (`/invitation#<jeton>`) : un fragment n'est
 * jamais envoyé à un serveur — ni au journal d'accès du relais, ni dans un
 * en-tête Referer.
 */
export async function envoyerInvitation(
  i: { cabinet: string; pme: string; email: string; jeton: string; expireLe: Date },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ courriel: StatutCourriel; lien: string | null }> {
  if (!config) return { courriel: "non_configure", lien: null };
  const lien = `${config.urlPublique}/invitation#${i.jeton}`;
  try {
    const c = courrielInvitation({ cabinet: i.cabinet, pme: i.pme, lien, expireLe: i.expireLe });
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
    return { courriel: "envoye", lien };
  } catch (e) {
    console.error(`[invitation] courriel non envoyé : ${(e as Error).message}`);
    return { courriel: "echec", lien };
  }
}
