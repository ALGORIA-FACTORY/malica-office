/**
 * Ce que les sections de la tour partagent : le dessin d'une carte de réglage
 * et la façon de dire un retour de la base.
 *
 * La tour est un poste de travail d'ALGORIA (décidé le 19 octobre 2026). Chaque
 * section relaie une fonction de la base qui REFUSE à qui n'est pas opérateur
 * (R3) : l'écran montre ce que la base rend, transmet le geste, et dit le refus.
 * Seuls les secrets du compte marchand restent sur le serveur : la tour dit
 * s'ils sont posés, jamais ce qu'ils valent.
 */
import { useState } from "react";

import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const OU = "components/malica/tour";
export const CHAMP = "h-[38px] min-w-0 flex-1 border border-border bg-background px-2 text-[13px]";
export const CARTE = "space-y-2 border border-border bg-card p-5";
export const TITRE = "text-[15px] font-semibold";
export const TEXTE = "text-[13px] leading-[1.5] text-muted-foreground";
export const ALERTE = "text-[12.5px] text-signal-warn";
export const BOUTON =
  "h-[38px] bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-40";

/** Le retour d'un geste : la phrase de la base, ou son refus dit dans la langue. */
export function useRetour() {
  const { t } = useI18n();
  const [retour, setRetour] = useState<string | null>(null);
  const echec = (e: unknown) => setRetour(texteDeLErreur(e, OU, t("common.error")));
  return { retour, setRetour, echec };
}
