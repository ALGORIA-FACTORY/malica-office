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
import { useMemo } from "react";

import { debutDExercice, finDuMois } from "@malica/socle/exercice";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary } from "@malica/socle/ports/repositories";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { PnlV1 } from "@malica/socle/contracts/pnl.v1";
import type { TvaV1 } from "@malica/socle/contracts/tva.v1";
import { computePnl } from "@malica/socle/engines/pnl/snapshot";
import { computeTva } from "@malica/socle/engines/tva/compute";

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
  const tenantId = client?.tenantId ?? null;
  // Aucune devise de repli (R4) : sans client, rien n'est calculé.
  const devise = client?.currency ?? null;

  const { locale } = useI18n();
  const pack = useQuery({
    queryKey: ["ref-pack", client?.jurisdiction],
    queryFn: () => office().referential.activePack(client!.jurisdiction),
    enabled: client !== null,
  });
  // Ce qu est chaque classe du plan : sans elle, le compte de resultat ne sait
  // pas ce qui est une charge, et le testait sur le premier chiffre du code.
  const classes = useQuery({
    queryKey: ["ref-classes", pack.data?.id],
    queryFn: () => office().referential.classesDeComptes(pack.data!.id),
    enabled: Boolean(pack.data),
    staleTime: 60 * 60 * 1000,
  });
  const fiche = useQuery({
    queryKey: ["fiche", tenantId],
    queryFn: () => office().identity.ficheCourante(tenantId!),
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
  // Les décimales viennent du pack du CLIENT, pas d'une table de devises
  // écrite en TypeScript (R4) : deux dossiers de juridictions différentes
  // n'ont pas la même échelle, et se tromper d'échelle est invisible.
  const params = useQuery({
    queryKey: ["socle-params", pack.data?.id],
    queryFn: () => office().referential.socleParams(pack.data!.id),
    enabled: Boolean(pack.data),
    staleTime: 60 * 60 * 1000,
  });
  const decimales = params.data?.moneyDecimals ?? null;

  const taux = useQuery({
    queryKey: ["tax-rates", pack.data?.id],
    queryFn: () => office().referential.taxRates(pack.data!.id, client!.jurisdiction, locale),
    enabled: Boolean(pack.data) && client !== null,
  });

  const pnl = useMemo<PnlV1 | null>(() => {
    if (!devise || !lignes.data || lignes.data.length === 0 || decimales === null) return null;
    return computePnl({
      period: periode,
      currency: { code: devise, decimals: decimales },
      entries: lignes.data.map((l) => ({
        account_code: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      })),
      classes: classes.data ?? [],
      coa: (plan.data ?? []).map((c) => ({
        account_code: c.code,
        label: c.libelle,
        parent_code: c.parent,
      })),
    });
  }, [lignes.data, plan.data, periode, devise, decimales, classes.data]);

  const tva = useMemo<TvaV1 | null>(() => {
    if (!devise || !extraits.data || !taux.data || extraits.data.length === 0) return null;
    if (decimales === null) return null;
    const dedans = extraits.data
      .map((e) => ({ item_id: e.pieceId, extract: ExtractV1.safeParse(e.extract) }))
      .filter((e) => e.extract.success)
      .map((e) => ({ item_id: e.item_id, extract: (e.extract as { data: ExtractV1 }).data }));
    if (dedans.length === 0) return null;
    return computeTva({
      period: periode,
      currency: { code: devise, decimals: decimales },
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
  }, [extraits.data, taux.data, periode, devise, decimales]);

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
