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

import type { EtatDeLAssistant, ReglageDeLAssistant } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";
import { ENTIER, LaConsigne, LeReglageDesModeles, type Messages } from "./consigne-et-modeles";

const MESSAGES: Messages<"tour.assistant"> = {
  consigne: "tour.assistant.consigne",
  "consigne.aide": "tour.assistant.consigne.aide",
  "consigne.enVigueur": "tour.assistant.consigne.enVigueur",
  "consigne.borne": "tour.assistant.consigne.borne",
  publier: "tour.assistant.publier",
  reglage: "tour.assistant.reglage",
  "reglage.aide": "tour.assistant.reglage.aide",
  mois: "tour.assistant.mois",
  modeleCourant: "tour.assistant.modeleCourant",
  modeleDifficile: "tour.assistant.modeleDifficile",
  longueurDifficile: "tour.assistant.longueurDifficile",
  motsDifficiles: "tour.assistant.motsDifficiles",
  borne: "tour.assistant.borne",
};

const ECRAN = {
  messages: MESSAGES,
  cle: ["tour-assistant"],
  lire: () => office().tour.assistantEtat(),
} as const;

/**
 * La consigne de « Parler à Malica » — le prompt système de l'assistant. Elle
 * vit en base, versionnée (R10) : publier en crée une version nouvelle, datée
 * et motivée ; la précédente reste au registre.
 */
export function LaConsigneDeLAssistant() {
  return (
    <LaConsigne
      {...ECRAN}
      lignes={18}
      publier={(texte, motif) => office().tour.publierConsigneDeLAssistant(texte, motif)}
    />
  );
}

const EFFORTS = ["low", "medium", "high"] as const;
const REFLEXIONS = ["disabled", "between_tools", "adaptive"] as const;

/** Les champs propres à l'assistant, tels que l'écran les saisit (en texte). */
const saisir = (r: NonNullable<EtatDeLAssistant["reglage"]>) => ({
  effortCourant: r.effort_courant,
  effortDifficile: r.effort_difficile,
  reflexionCourant: r.reflexion_courant,
  reflexionDifficile: r.reflexion_difficile,
  iterationsMax: String(r.iterations_max),
  sortieMaxJetons: String(r.sortie_max_jetons),
  toursTransmis: String(r.tours_transmis),
});

/**
 * Le réglage de l'assistant : Haiku par défaut, Sonnet pour les questions
 * difficiles, la règle simple qui les sépare, l'effort et la réflexion de
 * chacun. La base refuse un modèle sans tarif en vigueur (R8) et toute valeur
 * hors de ses bornes.
 */
export function LeReglageDeLAssistant() {
  const { t } = useI18n();
  return (
    <LeReglageDesModeles
      {...ECRAN}
      saisir={saisir}
      valide={(s) =>
        [s.iterationsMax, s.sortieMaxJetons, s.toursTransmis].every((v) => ENTIER.test(v.trim()))
      }
      regler={(commun, v, motif) =>
        office().tour.reglerAssistant(
          {
            ...commun,
            effortCourant: v.effortCourant as ReglageDeLAssistant["effortCourant"],
            effortDifficile: v.effortDifficile as ReglageDeLAssistant["effortDifficile"],
            reflexionCourant: v.reflexionCourant as ReglageDeLAssistant["reflexionCourant"],
            reflexionDifficile: v.reflexionDifficile as ReglageDeLAssistant["reflexionDifficile"],
            iterationsMax: Number(v.iterationsMax),
            sortieMaxJetons: Number(v.sortieMaxJetons),
            toursTransmis: Number(v.toursTransmis),
          },
          motif,
        )
      }
      propres={({ champ, choix }) => (
        <>
          {choix("effortCourant", t("tour.assistant.effortCourant"), EFFORTS)}
          {choix("effortDifficile", t("tour.assistant.effortDifficile"), EFFORTS)}
          {choix("reflexionCourant", t("tour.assistant.reflexionCourant"), REFLEXIONS)}
          {choix("reflexionDifficile", t("tour.assistant.reflexionDifficile"), REFLEXIONS)}
          {champ("iterationsMax", t("tour.assistant.iterationsMax"), "numeric")}
          {champ("sortieMaxJetons", t("tour.assistant.sortieMax"), "numeric")}
          {champ("toursTransmis", t("tour.assistant.toursTransmis"), "numeric")}
        </>
      )}
    />
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
  const etat = useQuery({ queryKey: ECRAN.cle, queryFn: ECRAN.lire });
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
      await qc.invalidateQueries({ queryKey: ECRAN.cle });
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

const CLE_RELECTURE = ["tour-assistant-relecture"];

/**
 * Ce que Malica fait d'une réponse que le cabinet doit relire, et d'un corpus
 * qui ne répond pas. Défaut livré le 11 novembre 2026 : annoncer, marquer.
 */
export function LaRelectureDeLAssistant() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({
    queryKey: CLE_RELECTURE,
    queryFn: () => office().tour.relectureDeLAssistant(),
  });
  const enVigueur = etat.data ?? null;
  const [mode, setMode] = useState<"annoncer" | "retenir">("retenir");
  const [sansTexte, setSansTexte] = useState<"marquer" | "retirer">("retirer");
  const [web, setWeb] = useState<"active" | "coupee">("coupee");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (!enVigueur) return;
    setMode(enVigueur.mode);
    setSansTexte(enVigueur.sans_texte);
    setWeb(enVigueur.web);
  }, [enVigueur]);

  const regler = useMutation({
    mutationFn: () => office().tour.reglerRelectureDeLAssistant(mode, sansTexte, web, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE_RELECTURE });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.assistant.relecture")}</h2>
      <p className={TEXTE}>{t("tour.assistant.relecture.aide")}</p>
      {enVigueur ? (
        <p className={TEXTE}>
          {t("tour.assistant.relecture.enVigueur", {
            date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
              new Date(enVigueur.decide_le),
            ),
            motif: enVigueur.motif,
          })}
        </p>
      ) : (
        <p className={ALERTE}>{t("tour.assistant.relecture.absente")}</p>
      )}
      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.assistant.relecture.mode")}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value === "annoncer" ? "annoncer" : "retenir")}
            aria-label={t("tour.assistant.relecture.mode")}
            className={`${CHAMP} mt-1 w-full`}
          >
            <option value="annoncer">{t("tour.assistant.relecture.annoncer")}</option>
            <option value="retenir">{t("tour.assistant.relecture.retenir")}</option>
          </select>
        </label>
        <label className={TEXTE}>
          {t("tour.assistant.relecture.sansTexte")}
          <select
            value={sansTexte}
            onChange={(e) => setSansTexte(e.target.value === "marquer" ? "marquer" : "retirer")}
            aria-label={t("tour.assistant.relecture.sansTexte")}
            className={`${CHAMP} mt-1 w-full`}
          >
            <option value="marquer">{t("tour.assistant.relecture.marquer")}</option>
            <option value="retirer">{t("tour.assistant.relecture.retirer")}</option>
          </select>
        </label>
        <label className={TEXTE}>
          {t("tour.assistant.relecture.web")}
          <select
            value={web}
            onChange={(e) => setWeb(e.target.value === "active" ? "active" : "coupee")}
            aria-label={t("tour.assistant.relecture.web")}
            className={`${CHAMP} mt-1 w-full`}
          >
            <option value="active">{t("tour.assistant.relecture.web.active")}</option>
            <option value="coupee">{t("tour.assistant.relecture.web.coupee")}</option>
          </select>
        </label>
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
          disabled={regler.isPending || motif.trim() === ""}
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
