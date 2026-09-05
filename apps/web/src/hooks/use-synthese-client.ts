/**
 * La synthèse d'un dossier client, vue du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * Le dossier d'un client affiche son compte de résultat en cumul d'exercice,
 * sa TVA du mois, ses pièces. Ces chiffres ne sont pas calculés par l'écran :
 * ils sortent des moteurs du Socle — `computePnl`, `computeTva` — nourris
 * par ce que l'API rend pour CE client (lignes de période, extraits
 * comptabilisés, taux du pack). Le crochet PME fait la même chose pour son
 * propre dossier ; celui-ci le fait pour un client désigné.
 *
 * Le début d'exercice vient de la fiche fiscale du client (sa date de
 * clôture). Sans fiche, l'année civile — et l'écran le dit.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";

import { debutDExercice, finDuMois } from "@regalica/socle/exercice";
import { ficheCourante } from "@/lib/fiche.functions";
import { office } from "@/verticals/regalica-office/composition";
import type { ClientSummary } from "@regalica/socle/ports/repositories";
import { ExtractV1 } from "@regalica/socle/contracts/extract.v1";
import type { PnlV1 } from "@regalica/socle/contracts/pnl.v1";
import type { TvaV1 } from "@regalica/socle/contracts/tva.v1";
import { computePnl } from "@regalica/socle/engines/pnl/snapshot";
import { computeTva } from "@regalica/socle/engines/tva/compute";
import { currencyDecimals } from "@regalica/socle/use-cases/propose-ecriture";

export interface SyntheseClient {
  pack: { id: string; version: string; ratified: boolean } | null;
  debutExercice: string;
  clotureConnue: boolean;
  pnl: PnlV1 | null;
  tva: TvaV1 | null;
  chargement: boolean;
  /** La première lecture qui a échoué, ou rien : l'écran la dit au lieu d'afficher un vide. */
  erreur: unknown;
}

export function useSyntheseClient(client: ClientSummary | null, periode: string): SyntheseClient {
  const lireFiche = useServerFn(ficheCourante);
  const tenantId = client?.tenantId ?? null;
  // Aucune devise de repli (R4) : sans client, rien n'est calculé.
  const devise = client?.currency ?? null;

  const pack = useQuery({
    queryKey: ["ref-pack", client?.jurisdiction],
    queryFn: () => office().referential.activePack(client!.jurisdiction),
    enabled: client !== null,
  });
  const fiche = useQuery({
    queryKey: ["fiche", tenantId],
    queryFn: () => lireFiche({ data: { tenantId: tenantId! } }),
    enabled: tenantId !== null,
  });
  const debutExercice = debutDExercice(fiche.data?.clotureExercice ?? null, periode);
  const fin = finDuMois(periode);

  const lignes = useQuery({
    queryKey: ["synthese-lignes", tenantId, debutExercice, fin],
    queryFn: () => office().office.periodeLignes(tenantId!, debutExercice, fin),
    enabled: tenantId !== null && fiche.isFetched,
  });
  const plan = useQuery({
    queryKey: ["plan-resultat", tenantId],
    queryFn: () => office().parametrage.plan(tenantId!, [6, 7]),
    enabled: tenantId !== null,
  });
  const extraits = useQuery({
    queryKey: ["synthese-extraits", tenantId, periode],
    queryFn: () => office().office.bookedExtracts(tenantId!, `${periode}-01`, fin),
    enabled: tenantId !== null,
  });
  const taux = useQuery({
    queryKey: ["tax-rates", pack.data?.id],
    queryFn: () => office().referential.taxRates(pack.data!.id, client!.jurisdiction),
    enabled: Boolean(pack.data) && client !== null,
  });

  const pnl = useMemo<PnlV1 | null>(() => {
    if (!devise || !lignes.data || lignes.data.length === 0) return null;
    return computePnl({
      period: periode,
      currency: { code: devise, decimals: currencyDecimals(devise) },
      entries: lignes.data.map((l) => ({
        account_code: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      })),
      coa: (plan.data ?? []).map((c) => ({
        account_code: c.code,
        label: c.libelle,
        parent_code: c.parent,
      })),
    });
  }, [lignes.data, plan.data, periode, devise]);

  const tva = useMemo<TvaV1 | null>(() => {
    if (!devise || !extraits.data || !taux.data || extraits.data.length === 0) return null;
    const dedans = extraits.data
      .map((e) => ({ item_id: e.pieceId, extract: ExtractV1.safeParse(e.extract) }))
      .filter((e) => e.extract.success)
      .map((e) => ({ item_id: e.item_id, extract: (e.extract as { data: ExtractV1 }).data }));
    if (dedans.length === 0) return null;
    return computeTva({
      period: periode,
      currency: { code: devise, decimals: currencyDecimals(devise) },
      tax_rates: taux.data.map((r) => ({
        code: r.code,
        label: r.label,
        rate: r.rate,
        valid_from: r.validFrom,
        valid_to: r.validTo,
        jurisdiction: r.jurisdiction,
      })),
      achats: dedans.filter((e) => e.extract.document_kind !== "facture_vente"),
      ventes: dedans.filter((e) => e.extract.document_kind === "facture_vente"),
    });
  }, [extraits.data, taux.data, periode, devise]);

  const erreur = [pack, fiche, lignes, plan, extraits, taux].find((q) => q.isError)?.error ?? null;

  return {
    pack: pack.data
      ? { id: pack.data.id, version: pack.data.version, ratified: pack.data.ratified }
      : null,
    debutExercice,
    clotureConnue: Boolean(fiche.data?.clotureExercice),
    pnl,
    tva,
    // Une lecture en échec n'est plus « en cours » : l'écran montre l'erreur, pas le chargement.
    chargement: erreur === null && (lignes.isPending || extraits.isPending),
    erreur,
  };
}
