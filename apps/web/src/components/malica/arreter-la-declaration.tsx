/**
 * Arrêter la déclaration de TVA d'un dossier (R10 ; revue Codex de #145).
 *
 * Les lignes de la déclaration sont un défaut livré par Malica. Le cabinet,
 * et lui seul, choisit pour chaque sens et chaque nature la ligne qui la
 * reçoit — pour ce dossier, ou pour tout le cabinet — et l'arrête. Arrêter
 * sans rien changer, c'est CONFIRMER : la ligne n'est plus « à confirmer »
 * sur aucun écran. La base vérifie qui décide (`app.tva_affecter`) ; l'écran
 * ne fait que proposer.
 *
 * Chaque choix dit d'où il vient : le défaut de Malica, le cabinet, ou ce
 * dossier (« un défaut se dit »). Deux boutons côte à côte, 48 px, même
 * largeur : le principal (ce dossier) plein, le secondaire (tout le cabinet)
 * en contour.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { SensDeTva } from "@malica/socle/contracts/tva.v1";
import type { DeclarationTva } from "@malica/socle/ports/repositories";

import { Aide } from "@/components/malica/aide";
import { ConfirmationSurPlace } from "@/components/malica/envoye";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/arreter-la-declaration";

const SENS: Record<SensDeTva, MessageKey> = {
  collectee: "pme.tva.col.collectee",
  deductible: "pme.tva.col.deductible",
};

const ORIGINE: Record<DeclarationTva["affectations"][number]["origine"], MessageKey> = {
  pack: "tva.affectation.origine.pack",
  cabinet: "tva.affectation.origine.cabinet",
  dossier: "tva.affectation.origine.dossier",
};

export function ArreterLaDeclaration({
  cabinetId,
  dossierId,
  packId,
  periode,
  declaration,
}: {
  cabinetId: string;
  dossierId: string;
  packId: string;
  /** Le mois affiché : la décision vaut à partir de sa déclaration. */
  periode: string;
  declaration: DeclarationTva;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const cle = (a: { sens: string; nature: string }) => `${a.sens}|${a.nature}`;
  const [choix, setChoix] = useState<Record<string, string>>({});
  const ligneChoisie = (a: DeclarationTva["affectations"][number]) =>
    choix[cle(a)] ?? a.ligne ?? "";
  const nomDeLaNature = (code: string) =>
    declaration.natures.find((n) => n.code === code)?.label ?? code;

  const arreter = useMutation({
    mutationFn: (portee: "dossier" | "cabinet") =>
      office().parametrage.arreterDeclarationTva({
        cabinetId,
        portee,
        porteeId: portee === "dossier" ? dossierId : cabinetId,
        packId,
        depuis: `${periode}-01`,
        affectations: declaration.affectations.map((a) => ({
          sens: a.sens,
          nature: a.nature,
          ligne: ligneChoisie(a) || null,
        })),
      }),
    onSuccess: async () => {
      setChoix({});
      await qc.invalidateQueries({ queryKey: ["declaration-tva"] });
    },
  });

  /*
   * La confirmation remplace les boutons le temps du geste, pas plus (revue
   * Codex de #145) : le composant reste monté d'un mois, d'un dossier et d'un
   * choix à l'autre. Un autre mois, un autre dossier ou un nouveau choix
   * rendent les boutons.
   */
  const { reset } = arreter;
  useEffect(() => {
    reset();
    setChoix({});
  }, [cabinetId, dossierId, periode, reset]);

  const bouton = "min-h-[48px] flex-1 basis-0 px-4 text-[13px] font-semibold disabled:opacity-40";

  return (
    <div className="mt-4 min-w-0 border-t border-border pt-3">
      <p className="flex items-center gap-1 text-[12px] font-semibold">
        {t("tva.affectation.titre")}
        <Aide
          titre={t("tva.affectation.titre")}
          paragraphes={[
            { texte: t("tva.affectation.aide") },
            { texte: t("tva.affectation.aide.portee") },
          ]}
        />
      </p>
      <ul className="mt-2 space-y-3">
        {declaration.affectations.map((a) => (
          <li key={cle(a)}>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[12px]">
                {t(SENS[a.sens])} · {nomDeLaNature(a.nature)}
              </span>
              <select
                value={ligneChoisie(a)}
                onChange={(e) => {
                  setChoix({ ...choix, [cle(a)]: e.target.value });
                  reset();
                }}
                // Une option longue (en arabe surtout) ne doit pas élargir la colonne.
                className="min-h-[48px] w-full min-w-0 max-w-full truncate border border-border bg-card px-3 text-[13px]"
              >
                {declaration.lignes
                  .filter((l) => l.sens === a.sens)
                  .map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
              </select>
              <span className="num text-[11px] text-muted-foreground">{t(ORIGINE[a.origine])}</span>
            </label>
          </li>
        ))}
      </ul>
      {arreter.isSuccess ? (
        <ConfirmationSurPlace
          titre={t("tva.affectation.arretee")}
          detail={t("tva.affectation.arretee.detail")}
        />
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={arreter.isPending}
            onClick={() => arreter.mutate("dossier")}
            className={`${bouton} border border-foreground bg-foreground text-background`}
          >
            {t("tva.affectation.pourLeDossier")}
          </button>
          <button
            type="button"
            disabled={arreter.isPending}
            onClick={() => arreter.mutate("cabinet")}
            className={`${bouton} border border-foreground bg-transparent text-foreground`}
          >
            {t("tva.affectation.pourLeCabinet")}
          </button>
        </div>
      )}
      {arreter.isError ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
          {texteDeLErreur(arreter.error, OU, t("common.error"))}
        </p>
      ) : null}
    </div>
  );
}
