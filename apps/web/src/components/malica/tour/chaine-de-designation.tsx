import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { MaillonDeLaDesignation } from "@malica/socle/ports/repositories";

import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/**
 * La chaîne de désignation (décision du dirigeant, 8 novembre 2026).
 *
 * Claude désigne (rang 1) ; DeepSeek prend la main en cas de panne ou de budget
 * épuisé (rang 2) ; les deux budgets épuisés, aucun modèle n'est appelé et la
 * pièce est lue par le moteur Sudoku seul. Ici, la tour voit chaque maillon —
 * modèle, dépense de la période, plafond — et en règle un : daté, motivé, en
 * ajout seul. La base refuse un modèle sans tarif et deux fois le même
 * fournisseur ; l'écran relaie le refus.
 */
const MOTIFS: Readonly<Record<string, MessageKey>> = {
  "bascule.technique": "tour.designation.motif.bascule.technique",
  "bascule.budget": "tour.designation.motif.bascule.budget",
  "repli.technique": "tour.designation.motif.repli.technique",
  "repli.budget": "tour.designation.motif.repli.budget",
  "arret.budgets_epuises": "tour.designation.motif.arret.budgets_epuises",
  "arret.chaine_vide": "tour.designation.motif.arret.chaine_vide",
};

export function LaChaineDeDesignation() {
  const { t, locale } = useI18n();
  const etat = useQuery({
    queryKey: ["tour-designation"],
    queryFn: () => office().tour.designation(),
  });
  const quand = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  return (
    <div className={CARTE} data-chaine-de-designation>
      <h2 className={TITRE}>{t("tour.designation")}</h2>
      <p className={TEXTE}>{t("tour.designation.aide")}</p>
      {etat.data?.mois ? (
        <p className="text-[13px] font-semibold" data-sans-ia>
          {t("tour.designation.sansIa", {
            sansIa: String(etat.data.mois.sans_ia),
            parModele: String(etat.data.mois.par_modele),
          })}
        </p>
      ) : null}
      {(etat.data?.maillons ?? []).map((m) => (
        <UnMaillon key={m.rang} maillon={m} modeles={etat.data?.modeles ?? []} />
      ))}
      <h3 className="pt-2 text-[13px] font-semibold">{t("tour.designation.bascules")}</h3>
      {etat.data && etat.data.bascules.length === 0 ? (
        <p className={TEXTE}>{t("tour.designation.aucuneBascule")}</p>
      ) : (
        <ul className="space-y-1">
          {(etat.data?.bascules ?? []).map((b, i) => {
            const cle = MOTIFS[b.motif];
            return (
              <li key={`${b.le}-${i}`} className={TEXTE}>
                {quand(b.le)} — {b.modele} : {cle ? t(cle) : b.motif}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UnMaillon({
  maillon,
  modeles,
}: {
  maillon: MaillonDeLaDesignation;
  modeles: ReadonlyArray<{ modele: string; role: string; fournisseur: string }>;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const [choix, setChoix] = useState(`${maillon.modele}|${maillon.role}`);
  const [periode, setPeriode] = useState<"jour" | "mois">(maillon.periode);
  const [plafond, setPlafond] = useState(String(maillon.plafond));
  const [motif, setMotif] = useState("");

  useEffect(() => {
    setChoix(`${maillon.modele}|${maillon.role}`);
    setPeriode(maillon.periode);
    setPlafond(String(maillon.plafond));
  }, [maillon]);

  const valide = /^\d+(\.\d{1,4})?$/.test(plafond.trim());
  const [modele = "", role = ""] = choix.split("|");
  const regler = useMutation({
    mutationFn: () =>
      office().tour.reglerDesignation(maillon.rang, modele, role, periode, plafond.trim(), motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-designation"] });
    },
    onError: echec,
  });
  const libellePeriode = (p: "jour" | "mois") =>
    t(p === "jour" ? "tour.designation.periode.jour" : "tour.designation.periode.mois");

  return (
    <div className="space-y-2 border-t border-border pt-3" data-maillon={maillon.rang}>
      <p className="text-[13px] font-semibold">
        {t(maillon.rang === 1 ? "tour.designation.rang.1" : "tour.designation.rang.2")} —{" "}
        {maillon.modele}{" "}
        <span className={maillon.epuise ? ALERTE : TEXTE}>
          ({t(maillon.epuise ? "tour.designation.epuise" : "tour.designation.disponible")})
        </span>
      </p>
      <p className={TEXTE}>
        {t("tour.designation.depense", {
          depense: String(Number(maillon.depense).toFixed(4)),
          plafond: String(maillon.plafond),
          periode: libellePeriode(maillon.periode),
        })}
      </p>
      <p className={TEXTE}>
        {t("tour.designation.decide", {
          date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
            new Date(maillon.decide_le),
          ),
          motif: maillon.motif,
        })}
      </p>
      <div className="flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.designation.modele")}
          <select
            value={choix}
            onChange={(e) => setChoix(e.target.value)}
            aria-label={t("tour.designation.modele")}
            className={`${CHAMP} mt-1 w-full`}
          >
            {modeles.map((m) => (
              <option key={`${m.modele}|${m.role}`} value={`${m.modele}|${m.role}`}>
                {m.fournisseur} — {m.modele} ({m.role})
              </option>
            ))}
          </select>
        </label>
        <label className={TEXTE}>
          {t("tour.designation.periode")}
          <select
            value={periode}
            onChange={(e) => setPeriode(e.target.value === "jour" ? "jour" : "mois")}
            aria-label={t("tour.designation.periode")}
            className={`${CHAMP} mt-1 w-full`}
          >
            <option value="jour">{libellePeriode("jour")}</option>
            <option value="mois">{libellePeriode("mois")}</option>
          </select>
        </label>
        <label className={TEXTE}>
          {t("tour.designation.plafond")}
          <input
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            inputMode="decimal"
            aria-label={t("tour.designation.plafond")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!valide ? <p className={ALERTE}>{t("tour.ia.plafond.borne")}</p> : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={regler.isPending || motif.trim() === "" || !valide}
          onClick={() => regler.mutate()}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
