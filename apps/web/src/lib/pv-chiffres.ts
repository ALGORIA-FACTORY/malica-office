import type { MessageKey } from "@/i18n";

/** Les deux espaces nomment les mêmes chiffres et les mêmes sources du PV. */
export const CHIFFRES_PV: Record<string, MessageKey> = {
  ca: "cab.pv.chiffre.ca",
  charges: "cab.pv.chiffre.charges",
  resultat: "cab.pv.chiffre.resultat",
  tvaCollectee: "cab.pv.chiffre.tvaCollectee",
  tvaDeductible: "cab.pv.chiffre.tvaDeductible",
  tva: "cab.pv.chiffre.tva",
  pieces: "cab.pv.chiffre.pieces",
  aSuperviser: "cab.pv.chiffre.aSuperviser",
  retournees: "cab.pv.chiffre.retournees",
  echeances: "cab.pv.chiffre.echeances",
};
export const SOURCES_PV: Record<string, MessageKey> = {
  pnl: "cab.pv.source.pnl",
  tva: "cab.pv.source.tva",
  file: "cab.pv.source.file",
  calendrier: "cab.pv.source.calendrier",
};
