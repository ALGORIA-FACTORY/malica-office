/**
 * Les courriels du compte qui portent un lien secret : rendre l'accès à un
 * compte dont le mot de passe est perdu (`reinitialisation`), confirmer
 * l'adresse d'un compte (`confirmation`, audit du 23 novembre 2026).
 *
 * Le cadre commun (`cadre.ts`, maquette E03 du 13 novembre 2026), une version
 * texte qui dit la même chose. Le lien porte le secret dans le FRAGMENT
 * (`/reinitialiser#<secret>`, `/confirmer-adresse#<secret>`) : il n'est jamais
 * envoyé à un serveur, ni dans un journal d'accès, ni dans un en-tête Referer.
 * Les textes viennent de la base (`notif.libelles_courriel`), par famille.
 */

import { LOCALES, type Locale } from "@malica/socle/messages";

import { envoyerParBrevo, type ConfigurationCourriel } from "./brevo.ts";
import { cadreDeCourriel } from "./cadre.ts";
import { echapper } from "./charte.ts";
import { libelle, type Libelles } from "./libelles.ts";

/** L'heure de Tunis, lisible dans la langue : « 16 nov. 2026 · 11:42 » ou « 12:42 ». */
function heure(d: Date, avecJour: boolean, locale: Locale): string {
  const f = new Intl.DateTimeFormat(locale, {
    ...(avecJour ? { day: "numeric", month: "short", year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
    timeZone: "Africa/Tunis",
  }).formatToParts(d);
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const hm = `${v("hour")}:${v("minute")}`;
  return avecJour ? `${v("day")} ${v("month")} ${v("year")} · ${hm}` : hm;
}

/** Les familles de courriel à lien, et le chemin de la page qui reçoit le secret. */
const FAMILLES = {
  reinitialisation: "/reinitialiser",
  confirmation: "/confirmer-adresse",
} as const;
type Famille = keyof typeof FAMILLES;

/**
 * `quand` : quand la demande a été faite et jusqu'à quand le lien vaut
 * (maquette E03, « Demandé le » et « Valable jusqu'à »). Absent, le bloc ne s'affiche pas.
 * `libelles` : les textes du courriel dans la langue de la personne.
 */
export function courrielReinitialisation(
  lienBrut: string,
  libelles: Libelles,
  locale: string,
  quand?: { demandeLe: Date; expireLe: Date },
) {
  return courrielALien("reinitialisation", lienBrut, libelles, locale, quand);
}

function courrielALien(
  famille: Famille,
  lienBrut: string,
  libelles: Libelles,
  locale: string,
  quand?: { demandeLe: Date; expireLe: Date },
): {
  sujet: string;
  html: string;
  texte: string;
} {
  if (!/^https?:\/\//i.test(lienBrut)) throw new Error(`lien de ${famille} invalide`);
  const loc: Locale = (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "fr";
  const l = libelles;
  const t = (cle: string) => libelle(l, `${famille}.${cle}`);

  const texte = [
    libelle(l, "cadre.bonjour"),
    "",
    t("corps"),
    "",
    t("bouton"),
    lienBrut,
    "",
    t("note"),
    "",
    libelle(l, "cadre.signatureTexte"),
  ].join("\n");

  const html = cadreDeCourriel({
    locale: loc,
    libelles: l,
    // Le repère et le lien des réglages partent de l'adresse publique, celle du lien.
    urlPublique: new URL(lienBrut).origin,
    apercu: t("apercu"),
    etiquette: { texte: libelle(l, "etiquette.securite"), signal: "info" },
    titre: t("titre"),
    paragraphesHtml: [echapper(t("corps"))],
    donnees: quand
      ? [
          {
            libelle: libelle(l, "donnee.demandeLe"),
            valeur: heure(quand.demandeLe, true, loc),
            mono: true,
          },
          {
            libelle: libelle(l, "donnee.valableJusqua"),
            // Le jour aussi, dès que le lien vaut au-delà du jour de la demande.
            valeur: heure(
              quand.expireLe,
              quand.expireLe.getTime() - quand.demandeLe.getTime() > 12 * 60 * 60 * 1000,
              loc,
            ),
            mono: true,
          },
        ]
      : [],
    action: { libelle: t("bouton"), url: lienBrut },
    noteHtml: echapper(t("note")),
    raison: t("raison"),
  });

  return { sujet: t("sujet"), html, texte };
}

/** Envoie le lien de réinitialisation si Brevo est configuré. Ne lève jamais. */
export function envoyerReinitialisation(
  i: { email: string; secret: string; expireLe?: Date; locale: string; libelles: Libelles },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch = fetch,
) {
  return envoyerUnLien("reinitialisation", i, config, fetchImpl);
}

/** Envoie le lien de confirmation de l'adresse si Brevo est configuré. Ne lève jamais. */
export function envoyerConfirmationAdresse(
  i: { email: string; secret: string; expireLe?: Date; locale: string; libelles: Libelles },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch = fetch,
) {
  return envoyerUnLien("confirmation", i, config, fetchImpl);
}

/** Envoie le lien si Brevo est configuré. Ne lève jamais : la réponse de l'API ne doit rien trahir. */
async function envoyerUnLien(
  famille: Famille,
  i: { email: string; secret: string; expireLe?: Date; locale: string; libelles: Libelles },
  config: ConfigurationCourriel | null,
  fetchImpl: typeof fetch,
): Promise<"envoye" | "non_configure" | "echec"> {
  if (!config) {
    console.warn(`[${famille}] courriel non configuré : aucun lien envoyé`);
    return "non_configure";
  }
  try {
    const c = courrielALien(
      famille,
      `${config.urlPublique}${FAMILLES[famille]}#${i.secret}`,
      i.libelles,
      i.locale,
      i.expireLe ? { demandeLe: new Date(), expireLe: i.expireLe } : undefined,
    );
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
    console.error(`[${famille}] courriel non envoyé : ${(e as Error).message}`);
    return "echec";
  }
}
