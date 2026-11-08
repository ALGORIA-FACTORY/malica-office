/**
 * L'hydratation — celle de Start, plus une attente : le dictionnaire.
 *
 * Le français n'est plus dans le paquet initial (`i18n/dictionnaires.ts`). Le
 * serveur a rendu la page en français ; le premier rendu du client doit dire
 * la même chose, mot pour mot, sinon React jette le rendu du serveur. On
 * attend donc le dictionnaire de ce premier rendu AVANT d'hydrater — la page
 * est déjà peinte par le serveur, rien ne clignote : seule l'interactivité
 * attend ces quelques kilo-octets.
 *
 * Dans la coque, rien n'est rendu côté serveur : le premier rendu est déjà
 * dans la langue rangée (`I18nProvider`), et c'est elle qu'on attend. Sur le
 * site, la langue rangée part en parallèle : elle remplacera le français dès
 * l'hydratation faite.
 *
 * Pas d'`await` au niveau du module : Rolldown découpe autrement un graphe qui
 * en contient un, et l'accueil préchargeait alors 45 fichiers au lieu de 3
 * (mesuré le 7 novembre 2026).
 */
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { localeRangee } from "@/i18n";
import { chargerLaLangue, chargerLesEspaces } from "@/i18n/dictionnaires";

export function hydrater(): Promise<void> {
  const rangee = localeRangee();
  const premiere = CIBLE_COQUE ? rangee : "fr";
  // Un échec (hors ligne) n'empêche pas l'hydratation : le fournisseur de
  // traductions réessaie et garde l'écran lisible (`i18n/index.tsx`).
  if (rangee !== premiere) void chargerLaLangue(rangee).catch(() => undefined);
  // La coque n'ouvre que l'espace PME : ses paquets partent tout de suite, en
  // même temps que la base, au lieu d'attendre la garde de `_authenticated`.
  if (CIBLE_COQUE) void chargerLesEspaces(rangee).catch(() => undefined);
  return chargerLaLangue(premiere)
    .catch(() => undefined)
    .then(() =>
      startTransition(() => {
        hydrateRoot(
          document,
          <StrictMode>
            <StartClient />
          </StrictMode>,
        );
      }),
    );
}
