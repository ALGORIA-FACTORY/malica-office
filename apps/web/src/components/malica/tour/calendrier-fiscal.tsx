import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnChiffres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, OU, TEXTE, TITRE, useRetour } from "./commun";

/** Le nom d'un jour ISO (1 = lundi), dans la langue du lecteur. Le 1er janvier 2024 est un lundi. */
function nomDuJour(isodow: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, isodow)),
  );
}

/**
 * Le calendrier fiscal d'une juridiction (20 octobre 2026) : les jours fériés
 * et les reports qui valent pour tous. La date légale vient du pack et ne se
 * règle pas ici ; une échéance qui tombe un jour non ouvrable passe au
 * premier jour ouvrable, et un report publié ici s'applique à tous les
 * dossiers de la juridiction — sauf report du cabinet, qui l'emporte.
 */
export function LeCalendrierFiscal() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const juridictions = useQuery({
    queryKey: ["ref-juridictions"],
    queryFn: () => office().referential.juridictions(),
  });
  const [juridiction, setJuridiction] = useState("");
  useEffect(() => {
    if (!juridiction && juridictions.data?.[0]) setJuridiction(juridictions.data[0].jurisdiction);
  }, [juridiction, juridictions.data]);
  const calendrier = useQuery({
    queryKey: ["tour-calendrier", juridiction],
    queryFn: () => office().tour.calendrier(juridiction),
    enabled: juridiction !== "",
  });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ["tour-calendrier", juridiction] });

  // Un jour férié : daté, ou revenant chaque année au même jour.
  const [le, setLe] = useState("");
  const [recurrent, setRecurrent] = useState(false);
  const [libelle, setLibelle] = useState("");
  const [sourceFerie, setSourceFerie] = useState("");
  const poserFerie = useMutation({
    mutationFn: () =>
      office().tour.poserJourFerie({
        juridiction,
        mois: recurrent ? Number(le.slice(5, 7)) : null,
        jour: recurrent ? Number(le.slice(8, 10)) : null,
        le: recurrent ? null : le,
        libelle: libelle.trim(),
        source: sourceFerie.trim(),
      }),
    onSuccess: async () => {
      setRetour(null);
      setLe("");
      setLibelle("");
      setSourceFerie("");
      await rafraichir();
    },
    onError: echec,
  });

  // Un report publié pour toute la juridiction.
  const [code, setCode] = useState("");
  const [periode, setPeriode] = useState("");
  const [date, setDate] = useState("");
  const [motif, setMotif] = useState("");
  const [source, setSource] = useState("");
  const publier = useMutation({
    mutationFn: () =>
      office().tour.publierReport({
        juridiction,
        code,
        periode: periode.trim(),
        nouvelleDate: date,
        motif: motif.trim(),
        source: source.trim(),
      }),
    onSuccess: async () => {
      setRetour(null);
      setPeriode("");
      setDate("");
      setMotif("");
      setSource("");
      await rafraichir();
    },
    onError: echec,
  });

  // Retirer se motive : une ligne ne s'efface pas, elle se clôt avec sa raison.
  const [motifRetrait, setMotifRetrait] = useState("");
  const retirerFerie = useMutation({
    mutationFn: (id: string) => office().tour.retirerJourFerie(id, motifRetrait.trim()),
    onSuccess: rafraichir,
    onError: echec,
  });
  const retirerReport = useMutation({
    mutationFn: (id: string) => office().tour.retirerReportPublie(id, motifRetrait.trim()),
    onSuccess: rafraichir,
    onError: echec,
  });

  const c = calendrier.data;
  const fixe = (mois: number, jour: number) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, mois - 1, jour)),
    );

  return (
    <div className={CARTE} data-tour-calendrier>
      <h2 className={TITRE}>{t("tour.cal.titre")}</h2>
      <p className={TEXTE}>{t("tour.cal.lede")}</p>
      <select
        value={juridiction}
        onChange={(e) => setJuridiction(e.target.value)}
        aria-label={t("tour.cal.titre")}
        className={CHAMP}
      >
        {(juridictions.data ?? []).map((j) => (
          <option key={j.jurisdiction} value={j.jurisdiction}>
            {j.jurisdiction}
          </option>
        ))}
      </select>

      {calendrier.isError ? (
        <p className={ALERTE}>{texteDeLErreur(calendrier.error, OU, t("common.error"))}</p>
      ) : null}
      {c ? (
        <>
          <p className={TEXTE}>
            {c.regle
              ? `${t("tour.cal.regle", {
                  jours: c.regle.joursRepos.map((j) => nomDuJour(j, locale)).join(", "),
                })} · ${t(c.regle.reportJourOuvrable ? "tour.cal.regle.report" : "tour.cal.regle.sansReport")} · ${c.regle.source}`
              : t("tour.cal.regle.absente")}
          </p>

          <input
            value={motifRetrait}
            onChange={(e) => setMotifRetrait(e.target.value)}
            placeholder={t("common.motif")}
            aria-label={t("common.motif")}
            className={CHAMP}
          />

          <p className={TEXTE}>
            <b>{t("tour.cal.feries")}</b>
          </p>
          {c.joursFeries.length === 0 ? (
            <p className={TEXTE}>{t("tour.cal.ferie.vide")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {c.joursFeries.map((f) => (
                <li key={f.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className={TEXTE}>
                    <b className="text-foreground">
                      {f.le
                        ? dateEnChiffres(f.le, locale)
                        : `${fixe(f.mois!, f.jour!)} · ${t("tour.cal.ferie.chaqueAnnee")}`}
                    </b>{" "}
                    {f.libelle}
                  </span>
                  <button
                    type="button"
                    className="text-[12px] underline disabled:opacity-40"
                    disabled={motifRetrait.trim() === "" || retirerFerie.isPending}
                    onClick={() => retirerFerie.mutate(f.id)}
                  >
                    {t("common.retirer")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="date"
              value={le}
              onChange={(e) => setLe(e.target.value)}
              aria-label={t("common.date")}
              className={CHAMP}
            />
            <input
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              placeholder={t("tour.cal.ferie.libelle")}
              aria-label={t("tour.cal.ferie.libelle")}
              className={CHAMP}
            />
            <input
              value={sourceFerie}
              onChange={(e) => setSourceFerie(e.target.value)}
              placeholder={t("common.source")}
              aria-label={t("common.source")}
              className={CHAMP}
            />
            <label className={TEXTE}>
              <input
                type="checkbox"
                checked={recurrent}
                onChange={(e) => setRecurrent(e.target.checked)}
              />{" "}
              {t("tour.cal.ferie.recurrent")}
            </label>
          </div>
          <button
            type="button"
            className={BOUTON}
            disabled={
              poserFerie.isPending ||
              le === "" ||
              libelle.trim() === "" ||
              sourceFerie.trim() === ""
            }
            onClick={() => poserFerie.mutate()}
          >
            {t("tour.cal.ferie.poser")}
          </button>

          <p className={TEXTE}>
            <b>{t("tour.cal.reports")}</b>
          </p>
          {c.reports.length === 0 ? (
            <p className={TEXTE}>{t("cab.settings.cal.reports.vide")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {c.reports.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className={TEXTE}>
                    <b className="text-foreground">{r.libelle ?? r.code}</b> {r.periode} →{" "}
                    {dateEnChiffres(r.nouvelleDate, locale)} · {r.motif} · {r.source}
                  </span>
                  <button
                    type="button"
                    className="text-[12px] underline disabled:opacity-40"
                    disabled={motifRetrait.trim() === "" || retirerReport.isPending}
                    onClick={() => retirerReport.mutate(r.id)}
                  >
                    {t("common.retirer")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={t("cab.settings.cal.reports.obligation")}
              className={CHAMP}
            >
              <option value="" />
              {c.obligations.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.libelle}
                </option>
              ))}
            </select>
            <input
              value={periode}
              onChange={(e) => setPeriode(e.target.value)}
              placeholder={t("cab.settings.cal.reports.periode.aide")}
              aria-label={t("common.periode")}
              className={CHAMP}
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("cab.settings.cal.reports.date")}
              className={CHAMP}
            />
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder={t("common.motif")}
              aria-label={t("common.motif")}
              className={CHAMP}
            />
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t("common.source")}
              aria-label={t("common.source")}
              className={CHAMP}
            />
          </div>
          <button
            type="button"
            className={BOUTON}
            disabled={
              publier.isPending ||
              code === "" ||
              periode.trim() === "" ||
              date === "" ||
              motif.trim() === "" ||
              source.trim() === ""
            }
            onClick={() => publier.mutate()}
          >
            {t("tour.cal.report.publier")}
          </button>
        </>
      ) : null}
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
