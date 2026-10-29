/**
 * Le mot et la couleur d'un statut, côté écran (« Malica sans blocage », §2).
 *
 * Le statut se dérive au Socle (`statut-d-envoi.ts`), le même pour l'API et
 * pour les deux rives ; ici, seulement sa phrase dans la langue de la personne
 * et sa teinte dans la feuille de style du cabinet. Un statut sans phrase ne
 * compilerait pas : les tables sont totales.
 */
import type { StatutCabinet, StatutPme, TonDuStatut } from "@malica/socle/statut-d-envoi";

import type { Tone } from "@/components/malica/office-ui";
import type { MessageKey } from "@/i18n";

/** Le mot court, pour une pastille de liste. */
export const MOT_PME: Readonly<Record<StatutPme, MessageKey>> = {
  mon_espace: "statut.pme.mon_espace",
  a_envoyer: "statut.pme.a_envoyer",
  gardee: "statut.pme.gardee",
  envoyee: "statut.pme.envoyee",
  vue: "statut.pme.vue",
  retour: "statut.pme.retour",
  prise_en_charge: "statut.pme.prise_en_charge",
};

/** Le mot qui nomme l'autre, quand on le connaît : « Vue par CABINET D’ESSAI ». */
export const MOT_PME_QUI: Readonly<Partial<Record<StatutPme, MessageKey>>> = {
  envoyee: "statut.pme.envoyee.qui",
  vue: "statut.pme.vue.qui",
  retour: "statut.pme.retour.qui",
};

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
