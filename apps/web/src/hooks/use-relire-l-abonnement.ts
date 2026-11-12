/**
 * Relire la page Abonnement — une seule liste des lectures qu'un geste sur
 * l'abonnement rend caduques, pour tous les gestes (recette du 11 novembre
 * 2026, 1.3). Les lectures que le cache de l'appareil garde
 * (`lib/cache-de-l-appareil`) s'y réécrivent d'elles-mêmes à la relecture.
 *
 * Ce module ne nomme ni prix ni paiement : la coque l'embarque (la cloche).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

const CLES = [
  ["mon-forfait"],
  ["forfait-sieges"],
  ["forfait-organisations"],
  ["mes-offres"],
  ["mes-recharges"],
  ["recharge-automatique"],
  ["mes-paiements"],
  ["mon-annuel"],
  // Le prix d'une place ou d'une société suit l'offre (`usePrixEnPlus`).
  ["prix-en-plus"],
  // Qui paie : la comptabilité qui propose, couvre, monte, descend ou arrête.
  ["abonnements-pour-moi"],
  ["descente-pour-moi"],
  ["mon-report"],
  ["mes-factures"],
];

export function useRelireLAbonnement() {
  const qc = useQueryClient();
  return useCallback(async () => {
    for (const queryKey of CLES) await qc.invalidateQueries({ queryKey });
  }, [qc]);
}

/**
 * Ce que la comptabilité fait ailleurs — monter, arrêter, proposer une
 * descente — arrive par la cloche (`acces.*`), relue chaque minute. Une alerte
 * d'abonnement plus récente que la dernière vue relit la page Abonnement : le
 * dirigeant ne voit pas une offre que la comptabilité a déjà changée. La
 * première lecture ne relit rien.
 */
export function useAbonnementSuitLesAlertes(
  alertes: readonly { kind: string; createdAt: string }[] | undefined,
) {
  const relire = useRelireLAbonnement();
  const [vue, setVue] = useState<string | null>(null);
  const derniere = (alertes ?? [])
    .filter((n) => n.kind.startsWith("acces."))
    .reduce<string>((r, n) => (n.createdAt > r ? n.createdAt : r), "");
  useEffect(() => {
    if (alertes === undefined || derniere === vue) return;
    if (vue !== null) void relire();
    setVue(derniere);
  }, [alertes, derniere, vue, relire]);
}
