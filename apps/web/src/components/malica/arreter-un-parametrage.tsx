/**
 * Arrêter un paramétrage du dossier (R10) : le geste commun à la déclaration
 * de TVA (#145) et à la règle de change (revue de #148).
 *
 * Malica livre un défaut ; le cabinet, et lui seul, choisit chaque valeur —
 * pour ce dossier, ou pour tout le cabinet — et l'arrête. Arrêter sans rien
 * changer, c'est CONFIRMER : la valeur n'est plus « à confirmer » sur aucun
 * écran. La base vérifie qui décide ; l'écran ne fait que proposer.
 *
 * Chaque choix dit d'où il vient : le défaut de Malica, le cabinet, ou ce
 * dossier (« un défaut se dit »). Deux boutons côte à côte, 48 px, même
 * largeur : le principal (ce dossier) plein, le secondaire (tout le cabinet)
 * en contour. Une valeur sans liste (un nombre de jours) se saisit.
 */
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { OrigineDuParametrage } from "@malica/socle/ports/repositories";

import { Aide, type ParagrapheDAide } from "@/components/malica/aide";
import { ConfirmationSurPlace } from "@/components/malica/envoye";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";

const OU = "components/malica/arreter-un-parametrage";

const ORIGINE: Record<OrigineDuParametrage, MessageKey> = {
  pack: "tva.affectation.origine.pack",
  cabinet: "tva.affectation.origine.cabinet",
  dossier: "tva.affectation.origine.dossier",
};

/** Une valeur à arrêter : sa clé, son nom, sa valeur résolue et d'où elle vient. */
export interface ValeurAArreter {
  cle: string;
  libelle: string;
  valeur: string;
  origine: OrigineDuParametrage;
  /** Ce que le référentiel connaît ; nul : un nombre, saisi. */
  options: ReadonlyArray<{ code: string; label: string }> | null;
  /** Ce que l'écran doit dire de plus sur cette valeur (« pas encore appliqué »). */
  note?: string | null;
}

type Portee = "dossier" | "cabinet";

export function ArreterUnParametrage({
  titre,
  aide,
  aConfirmer = null,
  valeurs,
  arretee,
  arreter: enregistrer,
  portees = ["dossier", "cabinet"],
  invalider,
  contexte,
}: {
  titre: string;
  aide: ParagrapheDAide[];
  /** La puce « à confirmer » à côté du titre, quand un défaut n'est pas arrêté. */
  aConfirmer?: string | null;
  valeurs: readonly ValeurAArreter[];
  arretee: { titre: string; detail: string };
  /** L'appel : la portée, et la valeur choisie de chaque clé ("" : aucune). */
  arreter: (portee: Portee, choix: Record<string, string>) => Promise<unknown>;
  /** Les portées offertes, la principale d'abord : sans dossier, le cabinet seul. */
  portees?: readonly Portee[];
  /** Ce qui se relit après l'enregistrement. */
  invalider: QueryKey;
  /**
   * Ce qui, en changeant, rend les boutons (revue Codex de #145) : le
   * composant reste monté d'un mois, d'un dossier, d'un choix à l'autre.
   */
  contexte: readonly unknown[];
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [choix, setChoix] = useState<Record<string, string>>({});
  const choisie = (v: ValeurAArreter) => choix[v.cle] ?? v.valeur;

  const mutation = useMutation({
    mutationFn: (portee: Portee) =>
      enregistrer(portee, Object.fromEntries(valeurs.map((v) => [v.cle, choisie(v)]))),
    onSuccess: async () => {
      setChoix({});
      await qc.invalidateQueries({ queryKey: invalider });
    },
  });

  const { reset } = mutation;
  const cleDuContexte = JSON.stringify(contexte);
  useEffect(() => {
    reset();
    setChoix({});
  }, [cleDuContexte, reset]);

  const choisir = (cle: string, valeur: string) => {
    setChoix({ ...choix, [cle]: valeur });
    reset();
  };
  const champ =
    "min-h-[48px] w-full min-w-0 max-w-full truncate border border-border bg-card px-3 text-[13px]";
  const bouton = "min-h-[48px] flex-1 basis-0 px-4 text-[13px] font-semibold disabled:opacity-40";

  return (
    <div className="mt-4 min-w-0 border-t border-border pt-3">
      <p className="flex flex-wrap items-center gap-1 text-[12px] font-semibold">
        {titre}
        <Aide titre={titre} paragraphes={aide} />
        {aConfirmer ? (
          <span className="ms-1 inline-flex items-center gap-1 border border-signal-warn px-1.5 py-0.5 text-[10.5px] font-semibold text-signal-warn">
            {aConfirmer}
          </span>
        ) : null}
      </p>
      <ul className="mt-2 space-y-3">
        {valeurs.map((v) => (
          <li key={v.cle}>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[12px]">{v.libelle}</span>
              {v.options ? (
                <select
                  value={choisie(v)}
                  onChange={(e) => choisir(v.cle, e.target.value)}
                  // Une option longue (en arabe surtout) ne doit pas élargir la colonne.
                  className={champ}
                >
                  {v.options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={choisie(v)}
                  onChange={(e) => choisir(v.cle, e.target.value)}
                  className={`num text-end ${champ}`}
                />
              )}
              <span className="num text-[11px] text-muted-foreground">{t(ORIGINE[v.origine])}</span>
              {v.note ? <span className="text-[11px] text-signal-info">{v.note}</span> : null}
            </label>
          </li>
        ))}
      </ul>
      {mutation.isSuccess ? (
        <ConfirmationSurPlace titre={arretee.titre} detail={arretee.detail} />
      ) : (
        <div className="mt-3 flex gap-2">
          {portees.map((portee, i) => (
            <button
              key={portee}
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(portee)}
              className={`${bouton} border border-foreground ${
                i === 0 ? "bg-foreground text-background" : "bg-transparent text-foreground"
              }`}
            >
              {t(
                portee === "dossier"
                  ? "tva.affectation.pourLeDossier"
                  : "tva.affectation.pourLeCabinet",
              )}
            </button>
          ))}
        </div>
      )}
      {mutation.isError ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
          {texteDeLErreur(mutation.error, OU, t("common.error"))}
        </p>
      ) : null}
    </div>
  );
}
