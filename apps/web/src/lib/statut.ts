/**
 * Le mot et la couleur d'un statut, côté écran (« Malica sans blocage », §2).
 *
 * Le statut se dérive au Socle (`statut-d-envoi.ts`), le même pour l'API et
 * pour les deux rives ; ici, seulement sa phrase dans la langue de la personne
 * et sa teinte dans la feuille de style du cabinet. Un statut sans phrase ne
 * compilerait pas : les tables sont totales.
 */
import type {
  StatutCabinet,
  StatutDuCircuit,
  StatutPme,
  TonDuStatut,
} from "@malica/socle/statut-d-envoi";

import type { Tone } from "@/components/malica/office-ui";
import type { MessageKey } from "@/i18n";

/** Le mot court, pour une pastille de liste. */
export const MOT_PME: Readonly<Record<StatutPme, MessageKey>> = {
  mon_espace: "statut.pme.mon_espace",
  a_envoyer: "statut.pme.a_envoyer",
  gardee: "statut.pme.gardee",
  rangee: "statut.pme.rangee",
  envoyee: "statut.pme.envoyee",
  vue: "statut.pme.vue",
  retour: "statut.pme.retour",
  prise_en_charge: "statut.pme.prise_en_charge",
  // Le propriétaire, pour la pièce d'un siège : les mêmes mots que le
  // comptable pour celle du client (« un mot, partout le même »).
  recue: "statut.cab.recue",
  corrigee: "statut.cab.corrigee",
  retournee: "statut.cab.retournee",
};

/** Le mot qui nomme l'autre, quand on le connaît : « Vue par CABINET D’ESSAI ». */
export const MOT_PME_QUI: Readonly<Partial<Record<StatutPme, MessageKey>>> = {
  envoyee: "statut.pme.envoyee.qui",
  vue: "statut.pme.vue.qui",
  retour: "statut.pme.retour.qui",
  retournee: "statut.pme.retournee.qui",
};

/**
 * Le mot d'un statut, l'autre nommé quand on le connaît : « Envoyée au
 * propriétaire », « Vue par Amel », « Retour de CABINET D’ESSAI »,
 * « Retournée à Sami ». Côté comptable, la base ne nomme pas le cabinet à la
 * PME avant qu'il ait ouvert la pièce : l'écran le nomme (`nomDuCabinet`).
 */
export function motDuStatut(
  s: StatutDuCircuit,
  nomDuCabinet: string | null,
  t: (cle: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (s.statut === "envoyee" && s.chez === "proprietaire" && !s.qui)
    return t("statut.pme.envoyee.proprietaire");
  const qui = s.qui ?? (s.chez === "cabinet" ? nomDuCabinet : null);
  const cle = MOT_PME_QUI[s.statut];
  return cle && qui ? t(cle, { qui }) : t(MOT_PME[s.statut]);
}

export const MOT_CABINET: Readonly<Record<StatutCabinet, MessageKey>> = {
  recue: "statut.cab.recue",
  vue: "statut.cab.vue",
  corrigee: "statut.cab.corrigee",
  retournee: "statut.cab.retournee",
  validee: "statut.cab.validee",
  forcee: "statut.cab.forcee",
};

/** La teinte du Socle dans le feu du cabinet : ambre à vous, bleu chez l'autre. */
export const FEU_DU_TON: Readonly<Record<TonDuStatut, Tone>> = {
  ok: "ok",
  am: "warn",
  az: "info",
  neutre: "neutral",
};
