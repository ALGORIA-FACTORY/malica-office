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

export interface InvitationCourriel {
  cabinet: string;
  pme: string;
  lien: string;
  expireLe: Date;
  /** Les textes du courriel (`notif.libelles_courriel`), en français : la langue de l'invité n'est pas connue. */
  libelles: Libelles;
  /**
   * À qui l'invitation s'adresse : le dirigeant que sa comptabilité invite
   * (par défaut), ou la comptabilité que la société invite (7.1). Le texte
   * d'un comptable ne lui parle pas comme à un dirigeant.
   */
  pour?: "dirigeant" | "comptabilite";
}

/** La langue des invitations : celle de l'invité n'est pas encore connue. */
export const LANGUE_DES_INVITATIONS = "fr";

function dateLisible(d: Date): string {
  return new Intl.DateTimeFormat(LANGUE_DES_INVITATIONS, {
    day: "numeric",
    month: "long",
    year: "numeric",
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
  const pour = i.pour === "comptabilite" ? "comptabilite" : "dirigeant";
  const t = (cle: string) => libelle(l, `invitation.${pour}.${cle}`);
  const jetons = { cabinet: i.cabinet, pme: i.pme };
  const jusquau = dateLisible(i.expireLe);
  const demandeur = pour === "comptabilite" ? i.pme : i.cabinet;
  const raison = remplir(libelle(l, "invitation.raison"), { demandeur });
  const corps = remplir(t("corps"), jetons);
  const note = remplir(libelle(l, "invitation.note"), { date: jusquau });

  const texte = [
    libelle(l, "cadre.bonjour"),
    "",
    corps,
    "",
    t("suite"),
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
    apercu: remplir(t("apercu"), jetons),
    organisation: i.pme,
    etiquette: {
      texte: libelle(l, pour === "comptabilite" ? "etiquette.mandat" : "etiquette.invitation"),
      signal: "attend",
    },
    titre: t("titre"),
    paragraphesHtml: [remplir(echapper(t("corps")), jetons, gras), echapper(t("suite"))],
    donnees:
      pour === "comptabilite"
        ? [{ libelle: libelle(l, "donnee.societe"), valeur: i.pme }]
        : [
            { libelle: libelle(l, "donnee.societe"), valeur: i.pme },
            { libelle: libelle(l, "donnee.comptabilite"), valeur: i.cabinet },
          ],
    action: { libelle: t("bouton"), url: i.lien },
    noteHtml: remplir(echapper(libelle(l, "invitation.note")), { date: jusquau }, gras),
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
