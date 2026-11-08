/**
 * Le menu de la tour, et ce que chaque entrée ouvre (2 novembre 2026).
 *
 * Trois groupes, dans l'ordre où un opérateur s'en sert : les CLIENTS
 * (cabinets, PME et leurs abonnements), la PLATEFORME (ce qui vaut pour tous),
 * la LECTURE (ce que les modèles coûtent et qui relit la nuit). Chaque section
 * de réglage est une carte déplacée de l'ancienne page unique, sans changement
 * de comportement ; seul le compte de service a sa carte propre.
 */
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  CreditCard,
  FileSignature,
  Gauge,
  KeyRound,
  LayoutGrid,
  MoonStar,
  Receipt,
  MessagesSquare,
  Scale,
  Send,
  ShieldCheck,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { MessageKey } from "@/i18n";

import { ReglerLAbonnement } from "./abonnement";
import { LAccesTotal } from "./acces-total";
import { LeCalendrierFiscal } from "./calendrier-fiscal";
import { LaConsigneDeLAssistant, LeReglageDeLAssistant } from "./assistant";
import { LaChaineDeDesignation } from "./chaine-de-designation";
import { LaConsigneDuConseil, LeReglageDuConseil } from "./conseil-cite";
import { DesignerLEmetteur } from "./emetteur";
import { LaFacturationAutomatique } from "./facturation-automatique";
import { LaGrille } from "./grille";
import { LesLicences } from "./licences";
import { ReglerLePaiement } from "./paiement";
import { LaPasseDeNuit, LeCompteDeService } from "./passe-de-nuit";
import { ReglerLePlafondIa } from "./plafond-des-modeles";
import { ReglerLesRelances } from "./relances";

/** Une section de réglage : son libellé de menu, son icône, ses cartes. */
interface Section {
  libelle: MessageKey;
  icone: LucideIcon;
  cartes: readonly ComponentType[];
}

/** Les sections de réglage, par leur segment d'adresse (`/tour/$section`). */
export const SECTIONS = {
  grille: { libelle: "tour.menu.grille", icone: LayoutGrid, cartes: [LaGrille, ReglerLAbonnement] },
  paiement: { libelle: "tour.menu.paiement", icone: CreditCard, cartes: [ReglerLePaiement] },
  emetteur: { libelle: "tour.menu.emetteur", icone: FileSignature, cartes: [DesignerLEmetteur] },
  facturation: {
    libelle: "tour.menu.facturation",
    icone: Receipt,
    cartes: [LaFacturationAutomatique],
  },
  relances: { libelle: "tour.menu.relances", icone: Send, cartes: [ReglerLesRelances] },
  calendrier: {
    libelle: "tour.menu.calendrier",
    icone: CalendarDays,
    cartes: [LeCalendrierFiscal],
  },
  licences: { libelle: "tour.menu.licences", icone: BadgeCheck, cartes: [LesLicences] },
  acces: { libelle: "tour.menu.acces", icone: ShieldCheck, cartes: [LAccesTotal] },
  nuit: { libelle: "tour.menu.nuit", icone: MoonStar, cartes: [LaPasseDeNuit] },
  modeles: {
    libelle: "tour.menu.modeles",
    icone: Gauge,
    cartes: [LaChaineDeDesignation, ReglerLePlafondIa],
  },
  conseil: {
    libelle: "tour.menu.conseil",
    icone: Scale,
    cartes: [LaConsigneDuConseil, LeReglageDuConseil],
  },
  assistant: {
    libelle: "tour.menu.assistant",
    icone: MessagesSquare,
    cartes: [LaConsigneDeLAssistant, LeReglageDeLAssistant],
  },
  compte: { libelle: "tour.menu.compte", icone: KeyRound, cartes: [LeCompteDeService] },
} as const satisfies Record<string, Section>;

export type CleDeSection = keyof typeof SECTIONS;

export function estUneSection(s: string): s is CleDeSection {
  return Object.hasOwn(SECTIONS, s);
}

/** Une entrée du menu : une adresse de la tour, son libellé, son icône. */
export interface EntreeDuMenu {
  cle: string;
  libelle: MessageKey;
  icone: LucideIcon;
  /** L'adresse, et le segment de section quand c'en est une. */
  to: "/tour/cabinets" | "/tour/pme" | "/tour/$section";
  section?: CleDeSection;
}

const deSection = (section: CleDeSection): EntreeDuMenu => ({
  cle: section,
  libelle: SECTIONS[section].libelle,
  icone: SECTIONS[section].icone,
  to: "/tour/$section",
  section,
});

/** Les trois groupes du menu, dans l'ordre de lecture. */
export const MENU: ReadonlyArray<{ cle: string; libelle: MessageKey; entrees: EntreeDuMenu[] }> = [
  {
    cle: "clients",
    libelle: "tour.menu.clients",
    entrees: [
      { cle: "cabinets", libelle: "tour.menu.cabinets", icone: Building2, to: "/tour/cabinets" },
      { cle: "pme", libelle: "tour.menu.pme", icone: Store, to: "/tour/pme" },
    ],
  },
  {
    cle: "plateforme",
    libelle: "tour.menu.plateforme",
    entrees: (
      [
        "grille",
        "paiement",
        "emetteur",
        "facturation",
        "relances",
        "calendrier",
        "licences",
        "acces",
      ] as const
    ).map(deSection),
  },
  {
    cle: "lecture",
    libelle: "tour.menu.lecture",
    entrees: (["nuit", "modeles", "conseil", "assistant", "compte"] as const).map(deSection),
  },
];

/** L'entrée du menu qui porte cette adresse : la plus longue qui la préfixe. */
export function entreeActive(path: string): { groupe: MessageKey; entree: EntreeDuMenu } | null {
  for (const g of MENU) {
    for (const e of g.entrees) {
      const adresse = e.section ? `/tour/${e.section}` : e.to;
      if (path === adresse || path.startsWith(`${adresse}/`)) {
        return { groupe: g.libelle, entree: e };
      }
    }
  }
  return null;
}
