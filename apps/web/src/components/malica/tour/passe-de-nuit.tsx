import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { PassageDeNuit } from "@malica/socle/ports/repositories";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/** Une décimale positive : les plafonds en dollars et la part du mensuel. */
const DECIMALE = /^\d+(\.\d{1,4})?$/;
const ENTIER = /^\d+$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Les raisons d'arrêt d'un passage, leur phrase et leur couleur fonctionnelle. */
const RAISONS: Record<PassageDeNuit["raison"], { cle: MessageKey; couleur: string }> = {
  termine: { cle: "tour.nuit.raison.termine", couleur: "text-signal-ok" },
  en_cours: { cle: "tour.nuit.raison.en_cours", couleur: "text-signal-info" },
  cede: { cle: "tour.nuit.raison.cede", couleur: "text-signal-info" },
  coupe: { cle: "tour.nuit.raison.coupe", couleur: "text-signal-warn" },
  fenetre_close: { cle: "tour.nuit.raison.fenetre_close", couleur: "text-muted-foreground" },
  plafond: { cle: "tour.nuit.raison.plafond", couleur: "text-signal-warn" },
  interrompu: { cle: "tour.nuit.raison.interrompu", couleur: "text-signal-stop" },
};

/** « 01:00:00 » → « 01:00 » : la base garde les secondes, l'écran ne les règle pas. */
const hhmm = (heure: string | undefined) => (heure ?? "").slice(0, 5);

/**
 * La passe de nuit (décisions du 2 novembre 2026) : les relectures partent la
 * nuit, à l'heure locale de chaque dossier, sous le relecteur de nuit, et
 * ALGORIA les paie. La tour l'ouvre ou la coupe, règle sa fenêtre et ses
 * plafonds, révoque le relecteur sans déploiement, et voit ce qu'elle a fait.
 * Les échecs se lisent ici, jamais chez le client.
 */
export function LaPasseDeNuit() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-nuit", locale],
    queryFn: () => office().tour.reglageRelectureNuit(locale),
  });
  const bilan = useQuery({
    queryKey: ["tour-nuit-bilan"],
    queryFn: () => office().tour.relecturesDeNuit(),
  });
  const [actif, setActif] = useState(false);
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [plateforme, setPlateforme] = useState("");
  const [dossier, setDossier] = useState("");
  const [max, setMax] = useState("");
  const [part, setPart] = useState("");
  const [alerte, setAlerte] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = reglage.data?.reglage;
    if (!r) return;
    setActif(r.actif);
    setDebut(hhmm(r.fenetre_debut));
    setFin(hhmm(r.fenetre_fin));
    setPlateforme(String(r.plafond_usd_24h_plateforme));
    setDossier(String(r.plafond_usd_24h_dossier));
    setMax(String(r.relectures_max_24h_dossier));
    setPart(String(r.part_max_plafond_mensuel));
    setAlerte(String(r.alerte_retard_nuits));
  }, [reglage.data]);

  const valide =
    HEURE.test(debut) &&
    HEURE.test(fin) &&
    debut !== fin &&
    DECIMALE.test(plateforme.trim()) &&
    DECIMALE.test(dossier.trim()) &&
    ENTIER.test(max.trim()) &&
    DECIMALE.test(part.trim()) &&
    Number(part) <= 1 &&
    ENTIER.test(alerte.trim()) &&
    Number(alerte) >= 1;

  const apres = async () => {
    setRetour(t("tour.fait"));
    setMotif("");
    await qc.invalidateQueries({ queryKey: ["tour-nuit"] });
    await qc.invalidateQueries({ queryKey: ["tour-nuit-bilan"] });
  };
  const regler = useMutation({
    mutationFn: () =>
      office().tour.reglerRelectureNuit(
        {
          actif,
          fenetreDebut: debut,
          fenetreFin: fin,
          plafondUsd24hPlateforme: plateforme.trim(),
          plafondUsd24hDossier: dossier.trim(),
          relecturesMax24hDossier: Number(max),
          partMaxPlafondMensuel: part.trim(),
          alerteRetardNuits: Number(alerte),
        },
        motif,
      ),
    onSuccess: apres,
    onError: echec,
  });
  const compte = reglage.data?.compte ?? null;

  const r = reglage.data?.reglage;
  const date = (iso: string, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: style,
      timeStyle: style === "short" ? "short" : undefined,
    }).format(new Date(iso));
  const etat = !r
    ? null
    : r.actif
      ? t("tour.nuit.etat.active", {
          debut: hhmm(r.fenetre_debut),
          fin: hhmm(r.fenetre_fin),
          date: date(r.decide_le),
        })
      : t("tour.nuit.etat.coupee");

  const champ = (
    cle: MessageKey,
    valeur: string,
    poser: (v: string) => void,
    mode: "decimal" | "numeric" = "decimal",
  ) => (
    <label className={TEXTE}>
      {t(cle)}
      <input
        value={valeur}
        onChange={(e) => poser(e.target.value)}
        inputMode={mode}
        aria-label={t(cle)}
        className={`${CHAMP} mt-1 w-full`}
      />
    </label>
  );

  return (
    <div className={CARTE} data-passe-de-nuit>
      <h2 className={TITRE}>{t("tour.nuit")}</h2>
      <p className={TEXTE}>{t("tour.nuit.aide")}</p>
      {etat ? (
        <p className={`${TEXTE} ${r?.actif ? "text-signal-ok" : ""}`} data-etat>
          {etat}
        </p>
      ) : null}
      {compte ? (
        <p className={`${TEXTE} ${compte.actif ? "" : "text-signal-stop"}`} data-compte>
          {t(compte.actif ? "tour.nuit.compte.actif" : "tour.nuit.compte.revoque", {
            libelle: compte.libelle,
          })}
        </p>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className={`${TEXTE} flex items-center gap-2 sm:col-span-2`}>
          <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
          {t("tour.nuit.actif")}
        </label>
        <label className={TEXTE}>
          {t("tour.nuit.debut")}
          <input
            type="time"
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            aria-label={t("tour.nuit.debut")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        <label className={TEXTE}>
          {t("tour.nuit.fin")}
          <input
            type="time"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            aria-label={t("tour.nuit.fin")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {champ("tour.nuit.plafondPlateforme", plateforme, setPlateforme)}
        {champ("tour.nuit.plafondDossier", dossier, setDossier)}
        {champ("tour.nuit.max", max, setMax, "numeric")}
        {champ("tour.nuit.part", part, setPart)}
        {champ("tour.nuit.alerte", alerte, setAlerte, "numeric")}
      </div>
      {!valide && reglage.isSuccess ? <p className={ALERTE}>{t("tour.nuit.invalide")}</p> : null}
      <div className="mt-2 flex flex-col gap-2">
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BOUTON}
            disabled={regler.isPending || motif.trim() === "" || !valide}
            onClick={() => regler.mutate()}
          >
            {t("tour.enregistrer")}
          </button>
        </div>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}

      <h3 className={`${TITRE} mt-4`}>{t("tour.nuit.passages")}</h3>
      {(bilan.data?.passages ?? []).length === 0 ? (
        <p className={TEXTE}>{t("tour.nuit.passages.vide")}</p>
      ) : (
        <ul className="grid gap-1">
          {(bilan.data?.passages ?? []).map((p) => (
            <li key={p.id} className={TEXTE} data-passage={p.raison}>
              <span className="num">{date(p.ouvert_le, "short")}</span>
              {" · "}
              <span className={RAISONS[p.raison].couleur}>{t(RAISONS[p.raison].cle)}</span>
              {p.ferme_le ? (
                <>
                  {" · "}
                  {t("tour.nuit.compteurs", {
                    retenues: p.compteurs.retenues ?? 0,
                    ecartees: p.compteurs.ecartees ?? 0,
                    abstentions: p.compteurs.abstentions ?? 0,
                    pannes: p.compteurs.pannes ?? 0,
                  })}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3 className={`${TITRE} mt-4`}>{t("tour.nuit.tableau")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-[12.5px]">
          <thead className="text-muted-foreground">
            <tr>
              {(
                [
                  "tour.nuit.col.jour",
                  "tour.nuit.col.dossier",
                  "tour.nuit.col.retenues",
                  "tour.nuit.col.ecartees",
                  "tour.nuit.col.abstentions",
                  "tour.nuit.col.pannes",
                  "tour.nuit.col.attente",
                  "tour.nuit.col.cout",
                ] as const
              ).map((cle) => (
                <th key={cle} className="px-2 py-1 text-start font-medium">
                  {t(cle)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(bilan.data?.lignes ?? []).map((l) => {
              const abstentions = Object.values(l.abstentions).reduce((a, n) => a + n, 0);
              return (
                <tr
                  key={`${l.tenant_id}-${l.jour ?? ""}`}
                  className="border-t border-border"
                  data-ligne
                >
                  <td className="num px-2 py-1">{l.jour ?? t("tour.nuit.sansFuseau")}</td>
                  <td className="px-2 py-1">{l.dossier}</td>
                  <td className={`num px-2 py-1 ${l.retenues ? "text-signal-ok" : ""}`}>
                    {l.retenues}
                  </td>
                  <td className="num px-2 py-1">{l.ecartees}</td>
                  <td className="num px-2 py-1">{abstentions}</td>
                  <td
                    className={`num px-2 py-1 ${l.pannes || l.epuisees ? "text-signal-stop" : ""}`}
                  >
                    {l.pannes}
                    {l.epuisees ? ` · ${t("tour.nuit.epuisees", { count: l.epuisees })}` : ""}
                  </td>
                  <td className={`num px-2 py-1 ${l.en_retard ? "text-signal-warn" : ""}`}>
                    {l.en_attente}
                    {l.plus_ancienne_nuits !== null && l.en_attente
                      ? ` · ${t("tour.nuit.nuits", { count: l.plus_ancienne_nuits })}`
                      : ""}
                  </td>
                  <td className={`num px-2 py-1 ${l.sans_cout ? "text-signal-warn" : ""}`}>
                    {l.cout_usd}
                    {l.sans_cout ? ` · ${t("tour.nuit.sansCout", { count: l.sans_cout })}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Le compte de service de la passe de nuit — le relecteur — se révoque ou se
 * rétablit ici, sans déploiement, motivé et en ajout seul. Il a sa section dans
 * la tour (2 novembre 2026) : couper l'identité qui relit n'est pas régler la
 * passe, et le geste ne se confond pas avec « Enregistrer ».
 */
export function LeCompteDeService() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-nuit", locale],
    queryFn: () => office().tour.reglageRelectureNuit(locale),
  });
  const [motif, setMotif] = useState("");
  const compte = reglage.data?.compte ?? null;
  const basculer = useMutation({
    mutationFn: () => office().tour.reglerCompteDeService(compte!.code, !compte!.actif, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-nuit"] });
    },
    onError: echec,
  });

  return (
    <div className={CARTE} data-compte-de-service>
      <h2 className={TITRE}>{t("tour.menu.compte")}</h2>
      {compte ? (
        <>
          <p className={`${TEXTE} ${compte.actif ? "" : "text-signal-stop"}`} data-compte>
            {t(compte.actif ? "tour.nuit.compte.actif" : "tour.nuit.compte.revoque", {
              libelle: compte.libelle,
            })}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder={t("common.motif")}
              aria-label={t("common.motif")}
              className={CHAMP}
            />
            <button
              type="button"
              data-basculer
              className={BOUTON}
              disabled={basculer.isPending || motif.trim() === ""}
              onClick={() => basculer.mutate()}
            >
              {t(compte.actif ? "tour.nuit.revoquer" : "tour.nuit.retablir")}
            </button>
          </div>
        </>
      ) : reglage.isPending ? (
        <p className={TEXTE}>{t("common.loading")}</p>
      ) : (
        <p className={TEXTE}>{t("tour.compte.aucun")}</p>
      )}
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
