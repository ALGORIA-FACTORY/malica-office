/**
 * À qui part « Envoyer », et comment le dire — un seul endroit (revue Codex
 * de #146).
 *
 * Quatre écrans envoient : la fiche, la bibliothèque, Mon espace, la fin de
 * la capture. Chacun nommait la destination à sa façon, et deux nommaient le
 * comptable alors que le siège envoie au propriétaire (lot 4). La destination
 * vient des droits (`destinationDesEnvois`) ; le nom, les phrases de l'écran
 * « Envoyé » et le libellé du geste viennent d'ici. Ce qui reste à envoyer, et
 * le geste lui-même, sont à `use-gestes-du-circuit.ts`, la seule porte.
 */
import { useI18n } from "@/i18n";
import { destinationDesEnvois } from "@malica/socle/circuit";

import type { DestinationDEnvoi } from "@/lib/envoi";

import { useComptabiliteDeLaSociete } from "./use-comptable-interne";
import { useMonAcces } from "./use-mon-acces";

export function useDestinationDeLEnvoi(tenantId: string | null | undefined) {
  const { t } = useI18n();
  const acces = useMonAcces(tenantId);
  // La comptabilité mandatée, ou le comptable interne (7.2) : l'un ou l'autre
  // reçoit ce que le propriétaire transmet.
  const compta = useComptabiliteDeLaSociete(tenantId);
  const cabinet = compta.cabinet;
  const droits = acces.data?.droits ?? [];
  const destination = destinationDesEnvois(droits, compta.aUneComptabilite);
  const quiPour = (d: DestinationDEnvoi) =>
    d === "proprietaire"
      ? t("circuit.proprietaire")
      : (cabinet.data?.name ?? compta.interne?.nom ?? t("pme.coffre.votreComptable"));
  return {
    destination,
    /** Lus : la destination est sûre (droits et mandat). */
    pret: acces.isSuccess && compta.pret,
    quiPour,
    /** Le geste qui envoie un lot. */
    action: (d: DestinationDEnvoi) =>
      d === "proprietaire"
        ? t("circuit.envoyer")
        : t("pme.prive.transmettre", { cabinet: quiPour(d) }),
    /** « Envoyé », en lot : chez qui, depuis quand. */
    quoiDuLot: (d: DestinationDEnvoi, count: number, quand: string) =>
      d === "proprietaire"
        ? t("circuit.lot.chez", { count, quand })
        : t("envoi.lot.chez", { count, qui: quiPour(d), quand }),
    /** « Envoyé », une pièce : ce qui se passe ensuite. */
    suite: (d: DestinationDEnvoi) =>
      d === "proprietaire"
        ? t("envoi.piece.suite.proprietaire")
        : t("envoi.piece.suite", { qui: quiPour(d) }),
    /** La trace que la pièce garde. */
    trace: (d: DestinationDEnvoi, jour: string) =>
      d === "proprietaire"
        ? t("envoi.trace.proprietaire", { jour })
        : t("envoi.trace", { qui: quiPour(d), jour }),
  };
}
