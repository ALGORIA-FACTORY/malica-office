/**
 * Le courriel qui invite le contact d'une PME à rejoindre son espace.
 *
 * Fonction pure : des noms, un lien, une date — un sujet, un HTML, un texte.
 * Le HTML est celui du cadre commun (`cadre.ts`, maquettes E06 et E07 du
 * 13 novembre 2026). La seule image est le repère rG, servi par l'appli
 * elle-même ; bloquée, son nom la remplace. La version texte dit la même
 * chose, pour les messageries qui n'affichent pas le HTML et pour les filtres
 * qui s'en méfient. Tout ce que le cabinet a saisi est échappé.
 */

import { MESSAGES } from "@malica/socle/messages";

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { cadreDeCourriel, type LigneDeDonnees } from "./cadre.ts";
import { echapper } from "./charte.ts";

export interface InvitationCourriel {
  cabinet: string;
  pme: string;
  lien: string;
  expireLe: Date;
  /**
   * À qui l'invitation s'adresse : le dirigeant que sa comptabilité invite
   * (par défaut), ou la comptabilité que la société invite (7.1). Le texte
   * d'un comptable ne lui parle pas comme à un dirigeant.
   */
  pour?: "dirigeant" | "comptabilite";
}

/** Les phrases qui changent selon le destinataire ; le reste du courriel est commun. */
function phrases(i: InvitationCourriel, cabinet: string, pme: string) {
  if (i.pour === "comptabilite")
    return {
      sujet: `${i.pme} vous invite à tenir sa comptabilité sur Malica`,
      titre: "Une société vous confie sa comptabilité.",
      corpsTexte: `${i.pme} vous invite à tenir sa comptabilité sur Malica Office.`,
      corpsHtml: `<strong style="font-weight:600;">${pme}</strong> vous invite à tenir sa comptabilité sur Malica Office.`,
      suite:
        "Créez votre accès ou connectez-vous, choisissez votre comptabilité ou créez-la : le mandat devient actif dès que vous acceptez.",
      bouton: "Voir l'invitation",
      demandeurTexte: i.pme,
      apercuTexte: `${i.pme} vous invite à tenir sa comptabilité.`,
      etiquette: MESSAGES.fr["courriel.etiquette.mandat"],
      organisation: i.pme,
      donnees: [{ libelle: "Société", valeur: i.pme }] as LigneDeDonnees[],
    };
  return {
    sujet: `${i.cabinet} vous ouvre votre espace Malica`,
    titre: "Votre espace est prêt.",
    corpsTexte: `${i.cabinet} a ouvert le dossier de ${i.pme} sur Malica Office, et vous invite à le rejoindre.`,
    corpsHtml: `<strong style="font-weight:600;">${cabinet}</strong> a ouvert le dossier de <strong style="font-weight:600;">${pme}</strong> sur Malica Office, et vous invite à le rejoindre.`,
    suite:
      "Photographiez vos factures : Malica les lit, les classe, et les transmet à votre comptabilité.",
    bouton: "Rejoindre mon espace",
    demandeurTexte: i.cabinet,
    apercuTexte: `${i.cabinet} a ouvert le dossier de ${i.pme}. Votre espace vous attend.`,
    etiquette: MESSAGES.fr["courriel.etiquette.invitation"],
    organisation: i.pme,
    donnees: [
      { libelle: "Société", valeur: i.pme },
      { libelle: "Comptabilité", valeur: i.cabinet },
    ] as LigneDeDonnees[],
  };
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
  const jusquau = dateLisible(i.expireLe);
  const p = phrases(i, cabinet, pme);

  const sujet = p.sujet;

  const texte = [
    `Bonjour,`,
    ``,
    p.corpsTexte,
    ``,
    p.suite,
    ``,
    `${p.bouton} :`,
    i.lien,
    ``,
    `Ce lien est personnel. Il vaut jusqu'au ${jusquau}, une seule fois, avec l'adresse à laquelle ce courriel vous parvient.`,
    ``,
    `Si vous n'attendiez pas cette invitation, ignorez ce message : rien ne se passera.`,
    ``,
    `— Malica Office`,
  ].join("\n");

  const html = cadreDeCourriel({
    locale: "fr",
    // Le repère et le lien des réglages partent de l'adresse publique, celle du lien.
    urlPublique: new URL(i.lien).origin,
    apercu: p.apercuTexte,
    organisation: p.organisation,
    etiquette: { texte: p.etiquette, signal: "attend" },
    titre: p.titre,
    paragraphesHtml: [p.corpsHtml, echapper(p.suite)],
    donnees: p.donnees,
    action: { libelle: p.bouton, url: i.lien },
    noteHtml: `Lien personnel, valable jusqu'au <strong style="font-weight:600;">${jusquau}</strong>, une seule fois, avec l'adresse à laquelle ce message vous parvient. Si vous n'attendiez pas cette invitation, ignorez ce message&nbsp;: rien ne se passera.`,
    raison: `Envoyé à la demande de ${p.demandeurTexte}.`,
  });

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
  i: {
    cabinet: string;
    pme: string;
    email: string;
    jeton: string;
    expireLe: Date;
    pour?: "dirigeant" | "comptabilite";
  },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ courriel: StatutCourriel; lien: string | null }> {
  if (!config) return { courriel: "non_configure", lien: null };
  const lien = `${config.urlPublique}/invitation#${i.jeton}`;
  try {
    const c = courrielInvitation({
      cabinet: i.cabinet,
      pme: i.pme,
      lien,
      expireLe: i.expireLe,
      pour: i.pour ?? "dirigeant",
    });
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
