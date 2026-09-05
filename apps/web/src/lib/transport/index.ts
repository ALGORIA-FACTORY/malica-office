/**
 * Le transport de l'application — un seul, monté au premier appel.
 *
 * C'est ici, et nulle part ailleurs, que la coque et le navigateur se
 * séparent : le natif porte un jeton et tient un coffre ; le web n'a que son
 * cookie, et un coffre en mémoire qui ne servira jamais. Les adaptateurs ne
 * connaissent que `transport()`.
 */
import { CIBLE_COQUE, estNatif, versionClient } from "@/capabilities/coque";

import { baseApi } from "./base";
import { signalerLaDeconnexion, signalerMiseAJourRequise } from "./etat";
import { coffreDuStockageLocal, coffreMemoire } from "./jetons";
import { creerTransport, type Transport } from "./transport";

let instance: Transport | null = null;

export function transport(): Transport {
  if (!instance) {
    instance = creerTransport({
      base: baseApi(),
      natif: estNatif(),
      // Le coffre n'entre dans le paquet que pour la coque : dans un site web,
      // un jeton de trente jours dans le stockage de la page serait une faute.
      coffre: CIBLE_COQUE ? coffreDuStockageLocal() : coffreMemoire(),
      versionClient: versionClient(),
      surDeconnexion: signalerLaDeconnexion,
      surMiseAJourRequise: signalerMiseAJourRequise,
    });
  }
  return instance;
}
