/**
 * La facture de Malica Office, prête à dessiner — chaque texte dans la langue du lecteur.
 *
 * ================================================================= POURQUOI
 *
 * Le PDF (`capabilities/facture-pdf.ts`) ne décide de rien : il pose des textes à leur place.
 * Ce module prépare ces textes depuis ce que la base a rendu (`factureDetail`) : les libellés
 * du dictionnaire, les montants et les dates mis en forme, le montant en toutes lettres par le
 * Socle, avec les noms de la devise lus en base (R4). Aucun chiffre n'est inventé : le seul
 * calcul est le « Total TTC hors timbre », somme exacte (Socle) du HT et de la TVA que la
 * facture porte.
 *
 * Une facture sans émetteur au jour de son émission ne s'imprime pas : on le dit, on ne met
 * pas un émetteur de repli (R4).
 */
import type { MessageKey } from "@/i18n";
import { jourOuInstant, montant, quantite } from "@/lib/lisible";
import type { LangueDesLettres } from "@malica/socle/montant-ecrit-en-lettres";
import { ecrireLeMontantEnLettres } from "@malica/socle/montant-ecrit-en-lettres";
import type { EtatDeFacture, FactureDetaillee } from "@malica/socle/ports/repositories";
import { enUnitesExactes, sommeDecimale } from "@malica/socle/somme-decimale";

type Traduire = (cle: MessageKey, valeurs?: Record<string, string | number>) => string;

/** Le signal du point devant le numéro : la couleur fonctionnelle de l'état de la facture. */
export type SignalDeFacture = "succes" | "erreur" | "alerte" | "neutre";

export interface LigneImprimable {
  libelle: string;
  quantite: string;
  prixUnitaire: string;
  montant: string;
}

export interface FactureImprimable {
  numero: string;
  signal: SignalDeFacture;
  marque: string;
  surtitre: string;
  titre: string;
  net: { libelle: string; montant: string; devise: string };
  /** DATE, ÉCHÉANCE, RÉF., DEVISE : un libellé, une valeur. */
  meta: { libelle: string; valeur: string }[];
  de: { titre: string; nom: string; lignes: string[] };
  a: { titre: string; nom: string; lignes: string[] };
  colonnes: { designation: string; quantite: string; prixUnitaire: string; montant: string };
  lignes: LigneImprimable[];
  totaux: { libelle: string; valeur: string; fort?: boolean }[];
  /** « Arrêtée la présente facture à la somme de : … » ; nul si la devise n'a pas ses noms. */
  arretee: string | null;
  objet: { titre: string; texte: string };
  conditions: { titre: string; lignes: string[] };
  banque: { titre: string; lignes: { libelle: string; valeur: string }[] } | null;
  pied: { gauche: string; droite: string };
  /** Le nom du fichier remis. */
  fichier: string;
  /** Un aperçu de la tour, jamais une facture : le filigrane le dit. */
  specimen: string | null;
}

const SIGNAL: Record<EtatDeFacture, SignalDeFacture> = {
  payee: "succes",
  en_retard: "erreur",
  irrecouvrable: "erreur",
  a_echoir: "alerte",
  partielle: "alerte",
  annulee: "neutre",
};

/** « 0.190000 » → « 19 », « 0.070000 » → « 7 », « 0.185000 » → « 18.5 » : la chaîne, sans flottant. */
export function pourcentDuTaux(taux: string): string {
  const unites = enUnitesExactes(taux, 6);
  const entier = unites / 10_000n;
  const reste = (unites % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return reste ? `${entier}.${reste}` : `${entier}`;
}

function langueDesLettres(locale: string): LangueDesLettres {
  if (locale.startsWith("ar")) return "ar";
  if (locale.startsWith("en")) return "en";
  return "fr";
}

/** Un identifiant (« 1234567/A/M/000 ») isolé de gauche à droite dans une phrase arabe. */
const isole = (v: string): string => `⁦${v}⁩`;

const nonVides = (xs: readonly (string | null | undefined)[]): string[] =>
  xs.map((x) => (x ?? "").trim()).filter((x) => x.length > 0);

/** La facture prête à dessiner ; lève `facture.pdf.sans_emetteur` sans émetteur. */
export function factureImprimable(
  d: FactureDetaillee,
  t: Traduire,
  locale: string,
  specimen = false,
): FactureImprimable {
  const e = d.entete.emetteur;
  if (!e) throw new Error("facture.pdf.sans_emetteur");
  const exposant = d.entete.exposant ?? 3;
  // Une date se dessine de gauche à droite : sans les marques de direction qu'`Intl` pose en
  // arabe, que le canevas déplacerait (« 232026/11/ »).
  const jour = (iso: string) =>
    jourOuInstant(iso, locale, { day: "2-digit", month: "2-digit", year: "numeric" }).replace(
      /[‎‏؜]/g,
      "",
    );
  const somme = (v: string) => montant(v, locale);

  const noms = d.entete.lettres?.[langueDesLettres(locale)];
  let lettres: string | null = null;
  if (noms) {
    try {
      lettres = ecrireLeMontantEnLettres(d.montant_ttc, exposant, langueDesLettres(locale), noms);
    } catch {
      lettres = null;
    }
  }

  const banque = d.entete.banque;
  const ligneBanque = (libelle: MessageKey, valeur: string | null) =>
    valeur ? { libelle: t(libelle), valeur } : null;

  return {
    numero: d.numero,
    signal: d.etat ? SIGNAL[d.etat] : "neutre",
    marque: t("facture.pdf.marque"),
    surtitre: t("facture.pdf.surtitre"),
    titre: t("facture.pdf.titre"),
    net: { libelle: t("facture.pdf.net"), montant: somme(d.montant_ttc), devise: d.devise },
    meta: [
      { libelle: t("facture.pdf.date"), valeur: jour(d.emise_le) },
      { libelle: t("facture.pdf.echeance"), valeur: jour(d.echeance_le) },
      { libelle: t("facture.pdf.ref"), valeur: d.reference_abonne ?? "—" },
      { libelle: t("facture.pdf.devise"), valeur: d.devise },
    ],
    de: {
      titre: t("facture.pdf.de"),
      nom: e.nom,
      lignes: [
        ...nonVides((e.adresse ?? "").split("\n")),
        ...(e.matricule ? [t("facture.pdf.mf", { mf: isole(e.matricule) })] : []),
        ...(e.rne ? [t("facture.pdf.rne", { rne: isole(e.rne) })] : []),
      ],
    },
    a: {
      titre: t("facture.pdf.a"),
      nom: d.client.nom,
      lignes: [
        ...(d.client.destinataire && d.client.destinataire !== d.client.nom
          ? [t("facture.pdf.attention", { nom: d.client.destinataire })]
          : []),
        ...nonVides((d.client.adresse ?? "").split("\n")),
        ...(d.client.matricule ? [t("facture.pdf.mf", { mf: isole(d.client.matricule) })] : []),
      ],
    },
    colonnes: {
      designation: t("facture.pdf.designation"),
      quantite: t("facture.pdf.qte"),
      prixUnitaire: t("facture.pdf.pu"),
      montant: t("facture.pdf.montantHt"),
    },
    lignes: d.lignes.map((l) => ({
      libelle: l.libelle,
      quantite: quantite(l.quantite, locale),
      prixUnitaire: somme(l.prix_unitaire),
      montant: somme(l.montant_ht),
    })),
    totaux: [
      { libelle: t("facture.pdf.totalHt"), valeur: somme(d.montant_ht) },
      {
        libelle: t("facture.pdf.tva", { taux: montant(pourcentDuTaux(d.taux_tva), locale) }),
        valeur: somme(d.montant_tva),
      },
      {
        libelle: t("facture.pdf.totalTtc"),
        valeur: somme(sommeDecimale([d.montant_ht, d.montant_tva], exposant)),
      },
      { libelle: t("facture.pdf.timbre"), valeur: somme(d.timbre) },
      {
        libelle: t("facture.pdf.netAPayer", { devise: d.devise }),
        valeur: somme(d.montant_ttc),
        fort: true,
      },
    ],
    arretee: lettres ? t("facture.pdf.arretee", { lettres }) : null,
    objet: {
      titre: t("facture.pdf.objet"),
      texte: t("facture.pdf.objet.texte", {
        offre: d.offre_libelle ?? d.offre_code ?? "",
        du: jour(d.couvre_du),
        // `couvre_au` est exclu : le dernier jour couvert est la veille.
        au: jour(veille(d.couvre_au)),
      }),
    },
    conditions: {
      titre: t("facture.pdf.conditions"),
      lignes: [
        ...nonVides((d.entete.conditions_paiement ?? "").split("\n")),
        t("facture.pdf.conditions.echeance", { date: jour(d.echeance_le) }),
      ],
    },
    banque: banque
      ? {
          titre: t("facture.pdf.banque"),
          lignes: [
            ligneBanque("facture.pdf.banque.titulaire", banque.titulaire),
            ligneBanque("facture.pdf.banque.banque", banque.banque),
            ligneBanque("facture.pdf.banque.agence", banque.agence),
            ligneBanque("facture.pdf.banque.rib", banque.rib),
            ligneBanque("facture.pdf.banque.iban", banque.iban),
            ligneBanque("facture.pdf.banque.bic", banque.bic),
            ligneBanque("facture.pdf.banque.devise", banque.devise),
          ].filter((l): l is { libelle: string; valeur: string } => l !== null),
        }
      : null,
    pied: {
      gauche: nonVides([
        e.nom,
        e.matricule ? t("facture.pdf.mf", { mf: isole(e.matricule) }) : null,
        e.site_web,
      ]).join(" · "),
      droite: t("facture.pdf.signature"),
    },
    fichier: `${d.numero}.pdf`,
    specimen: specimen ? t("facture.pdf.specimen") : null,
  };
}

/** La veille d'une date du Socle (« 2026-12-20 » → « 2026-12-19 »), en UTC. */
function veille(iso: string): string {
  const jour = new Date(`${iso}T00:00:00Z`);
  jour.setUTCDate(jour.getUTCDate() - 1);
  return jour.toISOString().slice(0, 10);
}
