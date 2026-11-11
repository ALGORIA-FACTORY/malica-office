/**
 * Les réglages de l'assistant « Parler à Malica » — consigne, modèles et plafond (tour).
 *
 * Écran de l'opérateur ALGORIA, trois cartes : la consigne (le prompt système, versionné en
 * base : publier crée une version datée et motivée, la précédente reste au registre), le
 * réglage des modèles (courant, difficile, la règle qui les sépare, effort et réflexion), et
 * le plafond de dépense propre à l'assistant. Rien n'est durci ici : les valeurs vivent en
 * base (R10), qui refuse un modèle sans tarif en vigueur (R8) et toute valeur hors bornes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ReglageDeLAssistant } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const CLE = ["tour-assistant"];

/**
 * La consigne de « Parler à Malica » — le prompt système de l'assistant. Elle
 * vit en base, versionnée (R10) : publier en crée une version nouvelle, datée
 * et motivée ; la précédente reste au registre.
 */
export function LaConsigneDeLAssistant() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.assistantEtat() });
  const enVigueur = etat.data?.consignes[0] ?? null;
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (enVigueur) setTexte(enVigueur.texte);
  }, [enVigueur]);

  const publier = useMutation({
    mutationFn: () => office().tour.publierConsigneDeLAssistant(texte, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
      new Date(iso),
    );
  const assezLongue = texte.trim().length >= 200;

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.assistant.consigne")}</h2>
      <p className={TEXTE}>{t("tour.assistant.consigne.aide")}</p>
      {enVigueur ? (
        <p className={TEXTE}>
          {t("tour.assistant.consigne.enVigueur", {
            date: date(enVigueur.decide_le),
            versions: String(etat.data?.consignes.length ?? 0),
          })}
        </p>
      ) : null}
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={18}
        aria-label={t("tour.assistant.consigne")}
        className="w-full border border-border bg-background p-2 font-mono text-[12.5px] leading-[1.5]"
      />
      {!assezLongue ? <p className={ALERTE}>{t("tour.assistant.consigne.borne")}</p> : null}
      <div className="flex flex-col gap-2">
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
          disabled={
            publier.isPending ||
            motif.trim() === "" ||
            !assezLongue ||
            texte.trim() === enVigueur?.texte.trim()
          }
          onClick={() => publier.mutate()}
        >
          {t("tour.assistant.publier")}
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

/** Les champs du réglage, tels que l'écran les saisit (en texte). */
interface Saisie {
  modeleCourant: string;
  modeleDifficile: string;
  longueurDifficile: string;
  motsDifficiles: string;
  effortCourant: string;
  effortDifficile: string;
  reflexionCourant: string;
  reflexionDifficile: string;
  iterationsMax: string;
  sortieMaxJetons: string;
  toursTransmis: string;
}

const ENTIER = /^\d{1,5}$/;
const EFFORTS = ["low", "medium", "high"] as const;
const REFLEXIONS = ["disabled", "between_tools", "adaptive"] as const;

/**
 * Le réglage de l'assistant : Haiku par défaut, Sonnet pour les questions
 * difficiles, la règle simple qui les sépare, l'effort et la réflexion de
 * chacun. La base refuse un modèle sans tarif en vigueur (R8) et toute valeur
 * hors de ses bornes.
 */
export function LeReglageDeLAssistant() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.assistantEtat() });
  const [s, setS] = useState<Saisie | null>(null);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = etat.data?.reglage;
    if (!r) return;
    setS({
      modeleCourant: r.modele_courant,
      modeleDifficile: r.modele_difficile,
      longueurDifficile: String(r.longueur_difficile),
      motsDifficiles: r.mots_difficiles.join(", "),
      effortCourant: r.effort_courant,
      effortDifficile: r.effort_difficile,
      reflexionCourant: r.reflexion_courant,
      reflexionDifficile: r.reflexion_difficile,
      iterationsMax: String(r.iterations_max),
      sortieMaxJetons: String(r.sortie_max_jetons),
      toursTransmis: String(r.tours_transmis),
    });
  }, [etat.data?.reglage]);

  const regler = useMutation({
    mutationFn: (v: Saisie) =>
      office().tour.reglerAssistant(
        {
          modeleCourant: v.modeleCourant,
          modeleDifficile: v.modeleDifficile,
          longueurDifficile: Number(v.longueurDifficile),
          motsDifficiles: v.motsDifficiles
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
          effortCourant: v.effortCourant as ReglageDeLAssistant["effortCourant"],
          effortDifficile: v.effortDifficile as ReglageDeLAssistant["effortDifficile"],
          reflexionCourant: v.reflexionCourant as ReglageDeLAssistant["reflexionCourant"],
          reflexionDifficile: v.reflexionDifficile as ReglageDeLAssistant["reflexionDifficile"],
          iterationsMax: Number(v.iterationsMax),
          sortieMaxJetons: Number(v.sortieMaxJetons),
          toursTransmis: Number(v.toursTransmis),
        },
        motif,
      ),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });

  if (!s) {
    return (
      <div className={CARTE}>
        <h2 className={TITRE}>{t("tour.assistant.reglage")}</h2>
      </div>
    );
  }

  const valide = [s.longueurDifficile, s.iterationsMax, s.sortieMaxJetons, s.toursTransmis].every(
    (v) => ENTIER.test(v.trim()),
  );
  const modeles = etat.data?.modeles ?? [];
  const champ = (cle: keyof Saisie, libelle: string, mode: "numeric" | "text") => (
    <label className={TEXTE} key={cle}>
      {libelle}
      <input
        value={s[cle]}
        onChange={(e) => setS({ ...s, [cle]: e.target.value })}
        inputMode={mode}
        aria-label={libelle}
        className={`${CHAMP} mt-1 w-full`}
      />
    </label>
  );
  const choix = (cle: keyof Saisie, libelle: string, valeurs: readonly string[]) => (
    <label className={TEXTE} key={cle}>
      {libelle}
      <select
        value={s[cle]}
        onChange={(e) => setS({ ...s, [cle]: e.target.value })}
        aria-label={libelle}
        className={`${CHAMP} mt-1 w-full`}
      >
        {[...new Set([s[cle], ...valeurs])].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.assistant.reglage")}</h2>
      <p className={TEXTE}>{t("tour.assistant.reglage.aide")}</p>
      {etat.data?.mois ? (
        <p className={TEXTE}>
          {t("tour.assistant.mois", {
            appels: String(etat.data.mois.appels),
            cout: String(etat.data.mois.cout),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {choix("modeleCourant", t("tour.assistant.modeleCourant"), modeles)}
        {choix("modeleDifficile", t("tour.assistant.modeleDifficile"), modeles)}
        {champ("longueurDifficile", t("tour.assistant.longueurDifficile"), "numeric")}
        {champ("motsDifficiles", t("tour.assistant.motsDifficiles"), "text")}
        {choix("effortCourant", t("tour.assistant.effortCourant"), EFFORTS)}
        {choix("effortDifficile", t("tour.assistant.effortDifficile"), EFFORTS)}
        {choix("reflexionCourant", t("tour.assistant.reflexionCourant"), REFLEXIONS)}
        {choix("reflexionDifficile", t("tour.assistant.reflexionDifficile"), REFLEXIONS)}
        {champ("iterationsMax", t("tour.assistant.iterationsMax"), "numeric")}
        {champ("sortieMaxJetons", t("tour.assistant.sortieMax"), "numeric")}
        {champ("toursTransmis", t("tour.assistant.toursTransmis"), "numeric")}
        {!valide ? <p className={ALERTE}>{t("tour.assistant.borne")}</p> : null}
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
          onClick={() => regler.mutate(s)}
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

/**
 * Le plafond PROPRE de l'assistant — décision du dirigeant du 8 novembre
 * 2026 : 150 $ par mois, livré par migration (R10). La lecture des pièces
 * garde ainsi au moins 350 $ des 500 $ de Claude. Au-delà, l'assistant passe
 * au repli DeepSeek de la chaîne, puis s'arrête si DeepSeek est épuisé ; la
 * lecture des pièces n'en est pas touchée.
 */
export function LePlafondDeLAssistant() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.assistantEtat() });
  const enVigueur = etat.data?.plafond ?? null;
  const [plafond, setPlafond] = useState("");
  const [periode, setPeriode] = useState<"jour" | "mois">("mois");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (!enVigueur) return;
    setPlafond(String(enVigueur.plafond));
    setPeriode(enVigueur.periode);
  }, [enVigueur]);

  const valide = /^\d+(\.\d{1,2})?$/.test(plafond.trim());
  const regler = useMutation({
    mutationFn: () => office().tour.reglerPlafondDeLAssistant(plafond.trim(), periode, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.assistant.plafond")}</h2>
      <p className={TEXTE}>{t("tour.assistant.plafond.aide")}</p>
      {enVigueur ? (
        <p className={TEXTE}>
          {t(
            enVigueur.periode === "jour"
              ? "tour.assistant.plafond.etatJour"
              : "tour.assistant.plafond.etatMois",
            {
              depense: String(Math.round(Number(enVigueur.depense) * 100) / 100),
              plafond: String(enVigueur.plafond),
              date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                new Date(enVigueur.decide_le),
              ),
            },
          )}
        </p>
      ) : null}
      {enVigueur?.epuise ? <p className={ALERTE}>{t("tour.assistant.plafond.atteint")}</p> : null}
      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.assistant.plafond.montant")}
          <input
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            inputMode="decimal"
            aria-label={t("tour.assistant.plafond.montant")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        <label className={TEXTE}>
          {t("tour.assistant.plafond.periode")}
          <select
            value={periode}
            onChange={(e) => setPeriode(e.target.value === "jour" ? "jour" : "mois")}
            aria-label={t("tour.assistant.plafond.periode")}
            className={`${CHAMP} mt-1 w-full`}
          >
            <option value="mois">{t("tour.assistant.plafond.parMois")}</option>
            <option value="jour">{t("tour.assistant.plafond.parJour")}</option>
          </select>
        </label>
        {!valide ? <p className={ALERTE}>{t("tour.assistant.plafond.borne")}</p> : null}
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
