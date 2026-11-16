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

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { cadreDeCourriel } from "./cadre.ts";
import { echapper } from "./charte.ts";
import { libelle, remplir, type Libelles } from "./libelles.ts";

/** Ce que la base sait de la société invitée et de qui invite (`notif.carte_d_invitation`). */
export interface CarteDInvitation {
  matricule: string | null;
  offre: string | null;
  /** Qui paie l'abonnement aujourd'hui, s'il est connu. */
  payeur: "comptabilite" | "societe" | null;
  /** Le nom de la personne qui invite. */
  invitant: string | null;
  /** La comptabilité que l'adresse invitée tient déjà sur Malica, s'il y en a une. */
  comptabiliteInvitee: string | null;
}

export interface InvitationCourriel {
  cabinet: string;
  pme: string;
  lien: string;
  expireLe: Date;
  /** Les textes du courriel (`notif.libelles_courriel`), en français : la langue de l'invité n'est pas connue. */
  libelles: Libelles;
  carte?: CarteDInvitation | null;
  /**
   * À qui l'invitation s'adresse : le dirigeant que sa comptabilité invite
   * (par défaut), ou la comptabilité que la société invite (7.1). Le texte
   * d'un comptable ne lui parle pas comme à un dirigeant.
   */
  pour?: "dirigeant" | "comptabilite";
}

/** La langue des invitations : celle de l'invité n'est pas encore connue. */
export const LANGUE_DES_INVITATIONS = "fr";

function dateLisible(d: Date, avecAnnee: boolean): string {
  return new Intl.DateTimeFormat(LANGUE_DES_INVITATIONS, {
    day: "numeric",
    month: "long",
    ...(avecAnnee ? { year: "numeric" } : {}),
    timeZone: "Africa/Tunis",
  }).format(d);
}

const gras = (v: string) => `<strong style="font-weight:600;">${echapper(v)}</strong>`;

export function courrielInvitation(i: InvitationCourriel): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (!/^https?:\/\//i.test(i.lien)) throw new Error("lien d'invitation invalide");

  const l = i.libelles;
  const carte = i.carte ?? null;
  const pourLaComptabilite = i.pour === "comptabilite";
  const t = (cle: string) =>
    libelle(l, `invitation.${pourLaComptabilite ? "comptabilite" : "dirigeant"}.${cle}`);
  const invitant = carte?.invitant ?? null;
  const jetons = {
    cabinet: i.cabinet,
    pme: i.pme,
    date: dateLisible(i.expireLe, true),
    ...(invitant ? { invitant } : {}),
  };
  const corpsCle = pourLaComptabilite && !invitant ? "corpsSansInvitant" : "corps";
  // La société paie : on le dit à la comptabilité, qui n'aura rien à régler.
  const societePaie = carte?.payeur === "societe";
  const complement = pourLaComptabilite && societePaie ? t("chargeSociete") : null;

  const offre = carte?.offre
    ? carte.payeur
      ? `${carte.offre} · ${libelle(
          l,
          carte.payeur === "comptabilite"
            ? "offre.chargeComptabilite"
            : `offre.chargeSociete.${pourLaComptabilite ? "comptabilite" : "dirigeant"}`,
        )}`
      : carte.offre
    : null;
  const donnees = pourLaComptabilite
    ? [
        ...(invitant ? [{ libelle: libelle(l, "donnee.dirigeant"), valeur: invitant }] : []),
        ...(offre ? [{ libelle: libelle(l, "donnee.offre"), valeur: offre }] : []),
        { libelle: libelle(l, "donnee.mandat"), valeur: libelle(l, "mandat.actifDesAccord") },
      ]
    : [
        { libelle: libelle(l, "donnee.comptabilite"), valeur: i.cabinet },
        ...(offre ? [{ libelle: libelle(l, "donnee.offre"), valeur: offre }] : []),
      ];

  const corps = remplir(t(corpsCle), jetons);
  const note = remplir(t("note"), jetons);
  const demandeur = pourLaComptabilite ? i.pme : i.cabinet;
  const raison = remplir(libelle(l, "invitation.raison"), { demandeur });
  const apercu = pourLaComptabilite
    ? t(societePaie ? "apercuSansFrais" : "apercu")
    : remplir(t("apercu"), { ...jetons, date: dateLisible(i.expireLe, false) });

  const texte = [
    libelle(l, "cadre.bonjour"),
    "",
    [corps, complement].filter(Boolean).join(" "),
    "",
    ...donnees.map((d) => `${d.libelle} : ${d.valeur}`),
    "",
    t("bouton"),
    i.lien,
    "",
    note,
    "",
    libelle(l, "cadre.signatureTexte"),
  ].join("\n");

  const html = cadreDeCourriel({
    locale: LANGUE_DES_INVITATIONS,
    libelles: l,
    // Le repère et le lien des réglages partent de l'adresse publique, celle du lien.
    urlPublique: new URL(i.lien).origin,
    apercu,
    // La pastille : la société du dirigeant ; pour la comptabilité, la sienne si elle en tient une.
    organisation: pourLaComptabilite ? (carte?.comptabiliteInvitee ?? null) : i.pme,
    etiquette: {
      texte: libelle(l, pourLaComptabilite ? "etiquette.demandeMandat" : "etiquette.invitation"),
      // E06 en vert (l'espace est prêt), E07 en ambre (le mandat attend un accord).
      signal: pourLaComptabilite ? "attend" : "fait",
    },
    titre: t("titre"),
    paragraphesHtml: [
      remplir(echapper(t(corpsCle)), jetons, gras) + (complement ? ` ${echapper(complement)}` : ""),
    ],
    entite: { nom: i.pme, matricule: carte?.matricule ?? null },
    donnees,
    action: { libelle: t("bouton"), url: i.lien },
    noteHtml: remplir(echapper(t("note")), jetons, gras),
    raison,
  });

  return { sujet: remplir(t("sujet"), jetons), html, texte };
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
    libelles: Libelles;
    carte?: CarteDInvitation | null;
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
      libelles: i.libelles,
      carte: i.carte ?? null,
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
