/**
 * Les réglages du conseil cité — la consigne et le choix des modèles (écran de la tour).
 *
 * Écran de l'opérateur ALGORIA, deux cartes : la consigne que Claude reçoit avant les
 * passages du corpus, versionnée en base (publier crée une version datée et motivée, la
 * précédente reste lisible), et le réglage des modèles avec la règle simple qui sépare les
 * questions courantes des difficiles. La base refuse un modèle sans tarif en vigueur (R8)
 * et toute valeur hors bornes. La consigne suit la règle R10 (versionnée en base).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const CLE = ["tour-conseil-cite"];

/**
 * La consigne du conseil cité — le prompt système que Claude reçoit avant les
 * passages du corpus. Elle vit en base, versionnée (R10) : publier en crée une
 * version nouvelle, datée et motivée ; la précédente reste lisible.
 */
export function LaConsigneDuConseil() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.conseilCiteEtat() });
  const enVigueur = etat.data?.consignes[0] ?? null;
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (enVigueur) setTexte(enVigueur.texte);
  }, [enVigueur]);

  const publier = useMutation({
    mutationFn: () => office().tour.publierConsigneDuConseil(texte, motif),
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
      <h2 className={TITRE}>{t("tour.conseilCite.consigne")}</h2>
      <p className={TEXTE}>{t("tour.conseilCite.consigne.aide")}</p>
      {enVigueur ? (
        <p className={TEXTE}>
          {t("tour.conseilCite.consigne.enVigueur", {
            date: date(enVigueur.decide_le),
            versions: String(etat.data?.consignes.length ?? 0),
          })}
        </p>
      ) : null}
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={16}
        aria-label={t("tour.conseilCite.consigne")}
        className="w-full border border-border bg-background p-2 font-mono text-[12.5px] leading-[1.5]"
      />
      {!assezLongue ? <p className={ALERTE}>{t("tour.conseilCite.consigne.borne")}</p> : null}
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
          {t("tour.conseilCite.publier")}
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
  corpusDistinctsDifficile: string;
  passagesMax: string;
  distanceMax: string;
  distanceMaxMots: string;
  sortieMaxJetons: string;
}

const ENTIER = /^\d{1,5}$/;
const DISTANCE = /^[01](\.\d{1,4})?$/;

/**
 * Le réglage du conseil cité : Haiku par défaut, Sonnet pour les questions
 * difficiles, et la règle simple qui les sépare. La base refuse un modèle
 * sans tarif en vigueur (R8).
 */
export function LeReglageDuConseil() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.conseilCiteEtat() });
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
      corpusDistinctsDifficile: String(r.corpus_distincts_difficile),
      passagesMax: String(r.passages_max),
      distanceMax: String(r.distance_max),
      distanceMaxMots: String(r.distance_max_mots),
      sortieMaxJetons: String(r.sortie_max_jetons),
    });
  }, [etat.data?.reglage]);

  const regler = useMutation({
    mutationFn: (v: Saisie) =>
      office().tour.reglerConseilCite(
        {
          modeleCourant: v.modeleCourant,
          modeleDifficile: v.modeleDifficile,
          longueurDifficile: Number(v.longueurDifficile),
          motsDifficiles: v.motsDifficiles
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
          corpusDistinctsDifficile: Number(v.corpusDistinctsDifficile),
          passagesMax: Number(v.passagesMax),
          distanceMax: v.distanceMax.trim(),
          distanceMaxMots: v.distanceMaxMots.trim(),
          sortieMaxJetons: Number(v.sortieMaxJetons),
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
        <h2 className={TITRE}>{t("tour.conseilCite.reglage")}</h2>
      </div>
    );
  }

  const valide =
    [s.longueurDifficile, s.corpusDistinctsDifficile, s.passagesMax, s.sortieMaxJetons].every((v) =>
      ENTIER.test(v.trim()),
    ) &&
    DISTANCE.test(s.distanceMax.trim()) &&
    DISTANCE.test(s.distanceMaxMots.trim());
  const modeles = etat.data?.modeles ?? [];
  const champ = (cle: keyof Saisie, libelle: string, mode: "numeric" | "decimal" | "text") => (
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
  const choix = (cle: "modeleCourant" | "modeleDifficile", libelle: string) => (
    <label className={TEXTE} key={cle}>
      {libelle}
      <select
        value={s[cle]}
        onChange={(e) => setS({ ...s, [cle]: e.target.value })}
        aria-label={libelle}
        className={`${CHAMP} mt-1 w-full`}
      >
        {[...new Set([s[cle], ...modeles])].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.conseilCite.reglage")}</h2>
      <p className={TEXTE}>{t("tour.conseilCite.reglage.aide")}</p>
      {etat.data?.mois ? (
        <p className={TEXTE}>
          {t("tour.conseilCite.mois", {
            appels: String(etat.data.mois.appels),
            cout: String(etat.data.mois.cout),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {choix("modeleCourant", t("tour.conseilCite.modeleCourant"))}
        {choix("modeleDifficile", t("tour.conseilCite.modeleDifficile"))}
        {champ("longueurDifficile", t("tour.conseilCite.longueurDifficile"), "numeric")}
        {champ("motsDifficiles", t("tour.conseilCite.motsDifficiles"), "text")}
        {champ("corpusDistinctsDifficile", t("tour.conseilCite.corpusDistincts"), "numeric")}
        {champ("passagesMax", t("tour.conseilCite.passagesMax"), "numeric")}
        {champ("distanceMax", t("tour.conseilCite.distanceMax"), "decimal")}
        {champ("distanceMaxMots", t("tour.conseilCite.distanceMaxMots"), "decimal")}
        {champ("sortieMaxJetons", t("tour.conseilCite.sortieMax"), "numeric")}
        {!valide ? <p className={ALERTE}>{t("tour.conseilCite.borne")}</p> : null}
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
