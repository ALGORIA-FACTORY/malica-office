import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const CLE = ["tour-relecture-ciblee"];
const ENTIER = /^\d{1,2}$/;

/**
 * La relecture ciblée par Claude (décision du dirigeant, 8 novembre 2026) : active ou non,
 * le modèle (tarifé en base, R8), les cases relues au plus et par appel. La base refuse un
 * modèle sans tarif ; la dernière décision vaut, et la précédente reste lisible.
 */
export function LeReglageDeLaRelectureCiblee() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.relectureCibleeEtat() });
  const [s, setS] = useState<{
    actif: boolean;
    modele: string;
    casesMax: string;
    lot: string;
  } | null>(null);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = etat.data?.reglage;
    if (r)
      setS({ actif: r.actif, modele: r.modele, casesMax: String(r.cases_max), lot: String(r.lot) });
  }, [etat.data?.reglage]);

  const regler = useMutation({
    mutationFn: (v: NonNullable<typeof s>) =>
      office().tour.reglerRelectureCiblee(
        { actif: v.actif, modele: v.modele, casesMax: Number(v.casesMax), lot: Number(v.lot) },
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
        <h2 className={TITRE}>{t("tour.relectureCiblee.reglage")}</h2>
      </div>
    );
  }
  const valide =
    ENTIER.test(s.casesMax.trim()) &&
    ENTIER.test(s.lot.trim()) &&
    Number(s.casesMax) >= 1 &&
    Number(s.casesMax) <= 80 &&
    Number(s.lot) >= 1 &&
    Number(s.lot) <= 20;
  const mois = etat.data?.mois;
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.relectureCiblee.reglage")}</h2>
      <p className={TEXTE}>{t("tour.relectureCiblee.reglage.aide")}</p>
      {mois ? (
        <p className={TEXTE}>
          {t("tour.relectureCiblee.mois", {
            relues: String(mois.relues),
            prouvees: String(mois.prouvees),
            cout: String(mois.cout),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          <input
            type="checkbox"
            checked={s.actif}
            onChange={(e) => setS({ ...s, actif: e.target.checked })}
            className="me-2"
          />
          {t("tour.relectureCiblee.actif")}
        </label>
        <label className={TEXTE}>
          {t("tour.relectureCiblee.modele")}
          <select
            value={s.modele}
            onChange={(e) => setS({ ...s, modele: e.target.value })}
            aria-label={t("tour.relectureCiblee.modele")}
            className={`${CHAMP} mt-1 w-full`}
          >
            {[...new Set([s.modele, ...(etat.data?.modeles ?? [])])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["casesMax", t("tour.relectureCiblee.casesMax")],
            ["lot", t("tour.relectureCiblee.lot")],
          ] as const
        ).map(([cle, libelle]) => (
          <label className={TEXTE} key={cle}>
            {libelle}
            <input
              value={s[cle]}
              onChange={(e) => setS({ ...s, [cle]: e.target.value })}
              inputMode="numeric"
              aria-label={libelle}
              className={`${CHAMP} mt-1 w-full`}
            />
          </label>
        ))}
        {!valide ? <p className={ALERTE}>{t("tour.relectureCiblee.borne")}</p> : null}
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

/** La consigne de la relecture ciblée : en base, versionnée (R10) — publier crée une version. */
export function LaConsigneDeLaRelecture() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: CLE, queryFn: () => office().tour.relectureCibleeEtat() });
  const enVigueur = etat.data?.consignes[0] ?? null;
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState("");
  useEffect(() => {
    if (enVigueur) setTexte(enVigueur.texte);
  }, [enVigueur]);
  const publier = useMutation({
    mutationFn: () => office().tour.publierConsigneDeRelecture(texte, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });
  const assezLongue = texte.trim().length >= 200;
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.relectureCiblee.consigne")}</h2>
      <p className={TEXTE}>{t("tour.relectureCiblee.consigne.aide")}</p>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={14}
        aria-label={t("tour.relectureCiblee.consigne")}
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

/**
 * Les valeurs lues sans preuve qu'on affiche sûres (décision du dirigeant, 8 novembre
 * 2026) : un champ par ligne, cochable, réversible, motivé. La base ne propose ni ne
 * permet jamais un montant.
 */
export function LesValeursSures() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const cle = ["tour-valeurs-sures"];
  const etat = useQuery({ queryKey: cle, queryFn: () => office().tour.valeursSuresEtat() });
  const [motif, setMotif] = useState("");
  const regler = useMutation({
    mutationFn: (v: { champ: string; sure: boolean }) =>
      office().tour.reglerValeursSures(v.champ, v.sure, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      await qc.invalidateQueries({ queryKey: cle });
    },
    onError: echec,
  });
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.valeursSures.titre")}</h2>
      <p className={TEXTE}>{t("tour.valeursSures.aide")}</p>
      <input
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        placeholder={t("common.motif")}
        aria-label={t("common.motif")}
        className={`${CHAMP} mt-2`}
      />
      <ul className="mt-2 flex max-h-[360px] flex-col gap-1 overflow-y-auto">
        {(etat.data ?? []).map((c) => (
          <li key={c.champ} className={TEXTE}>
            <label>
              <input
                type="checkbox"
                checked={c.sure}
                disabled={regler.isPending || motif.trim() === ""}
                onChange={(e) => regler.mutate({ champ: c.champ, sure: e.target.checked })}
                className="me-2"
              />
              <bdi className="font-mono">{c.champ}</bdi>
            </label>
          </li>
        ))}
      </ul>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
