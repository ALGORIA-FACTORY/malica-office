import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { saisieDecimale } from "@malica/socle/saisie-decimale";
import { office } from "@/verticals/malica-office/composition";
import type {
  GrilleProposee,
  LigneDeRecharge,
  LigneDOffre,
} from "@malica/socle/ports/repositories";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/** Les colonnes d'une offre qu'on règle, dans l'ordre de lecture, et leur libellé. */
const CHAMPS_OFFRE: Array<[string, MessageKey, "nombre" | "nombre_vide" | "case"]> = [
  ["prix_mensuel_ht", "tour.champ.prix_mensuel_ht", "nombre"],
  ["lectures_par_organisation", "tour.champ.lectures_par_organisation", "nombre"],
  ["sieges_inclus", "tour.champ.sieges_inclus", "nombre"],
  ["sieges_max", "tour.champ.sieges_max", "nombre_vide"],
  ["prix_siege_sup", "tour.champ.prix_siege_sup", "nombre"],
  ["lectures_par_siege_sup", "tour.champ.lectures_par_siege_sup", "nombre"],
  ["organisations_incluses", "tour.champ.organisations_incluses", "nombre"],
  ["organisations_max", "tour.champ.organisations_max", "nombre_vide"],
  ["prix_organisation_sup", "tour.champ.prix_organisation_sup", "nombre"],
  ["recharges_permises", "tour.champ.recharges_permises", "case"],
];
const CHAMPS_RECHARGE: Array<[string, MessageKey]> = [
  ["prix_ht", "tour.champ.prix_ht"],
  ["lectures", "tour.champ.lectures"],
  ["validite_mois", "tour.champ.validite_mois"],
];

/** Les trous que la base nomme, et leur phrase. */
const TROUS: Record<string, MessageKey> = {
  date_passee: "tour.trou.date_passee",
  offres_absentes: "tour.trou.offres_absentes",
  offre_manquante: "tour.trou.offre_manquante",
  rang_double: "tour.trou.rang_double",
  offre_incomplete: "tour.trou.offre_incomplete",
  places_incoherentes: "tour.trou.places_incoherentes",
  prix_non_croissant: "tour.trou.prix_non_croissant",
  lectures_non_croissantes: "tour.trou.lectures_non_croissantes",
  personnes_decroissantes: "tour.trou.personnes_decroissantes",
  monter_coute_plus_a_la_lecture: "tour.trou.monter_coute_plus_a_la_lecture",
  recharge_incomplete: "tour.trou.recharge_incomplete",
  recharge_brule_l_offre_suivante: "tour.trou.recharge_brule_l_offre_suivante",
  paliers_non_croissants: "tour.trou.paliers_non_croissants",
  gros_palier_moins_avantageux: "tour.trou.gros_palier_moins_avantageux",
};

/** Demain, au format de la base : une grille ne se publie jamais pour hier. */
function demain(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function LaGrille() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const enVigueur = useQuery({
    queryKey: ["tour-grille"],
    queryFn: () => office().tour.grilleEnVigueur(),
  });
  const [grille, setGrille] = useState<GrilleProposee | null>(null);
  const [date, setDate] = useState(demain());
  const [motif, setMotif] = useState("");
  const [trous, setTrous] = useState<Array<{ code: string; detail: string }> | null>(null);

  useEffect(() => {
    if (enVigueur.data && !grille) setGrille(structuredClone(enVigueur.data));
  }, [enVigueur.data, grille]);

  const verifier = useMutation({
    mutationFn: () => office().tour.trousDeLaGrille(date, grille!.offres, grille!.recharges),
    onSuccess: (r) => {
      setTrous(r);
      setRetour(r.length === 0 ? t("tour.grille.sansTrou") : null);
    },
    onError: echec,
  });
  const publier = useMutation({
    mutationFn: () => office().tour.publierGrille(date, grille!.offres, grille!.recharges, motif),
    onSuccess: async () => {
      setTrous(null);
      setRetour(t("tour.grille.publiee", { date }));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-grille"] });
    },
    onError: echec,
  });

  if (!grille) return null;

  const changerOffre = (i: number, cle: string, valeur: string | boolean | null) => {
    const g = structuredClone(grille);
    (g.offres[i] as LigneDOffre)[cle] = valeur;
    setGrille(g);
    setTrous(null);
  };
  const changerRecharge = (i: number, cle: string, valeur: string) => {
    const g = structuredClone(grille);
    (g.recharges[i] as LigneDeRecharge)[cle] = valeur;
    setGrille(g);
    setTrous(null);
  };

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.grille")}</h2>
      <label className={`${TEXTE} block`}>
        {t("tour.grille.date")}{" "}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={CHAMP}
        />
      </label>

      <p className={TEXTE}>
        <b>{t("tour.grille.offres")}</b> — {t("tour.grille.vide")}
      </p>
      {grille.offres.map((o, i) => (
        <fieldset key={o.code} className="mt-2" data-offre={o.code}>
          <legend>
            <b>{String(o["libelle"] ?? o.code)}</b>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {CHAMPS_OFFRE.map(([cle, libelle, forme]) =>
              forme === "case" ? (
                <label key={cle} className={TEXTE}>
                  <input
                    type="checkbox"
                    checked={Boolean(o[cle])}
                    onChange={(e) => changerOffre(i, cle, e.target.checked)}
                  />{" "}
                  {t(libelle)}
                </label>
              ) : (
                <label key={cle} className={`${TEXTE} flex flex-col gap-1`}>
                  {t(libelle)}
                  <input
                    inputMode="decimal"
                    value={o[cle] === null || o[cle] === undefined ? "" : String(o[cle])}
                    onChange={(e) =>
                      changerOffre(
                        i,
                        cle,
                        forme === "nombre_vide" && e.target.value.trim() === ""
                          ? null
                          : (saisieDecimale(e.target.value) ?? e.target.value),
                      )
                    }
                    className={CHAMP}
                  />
                </label>
              ),
            )}
          </div>
        </fieldset>
      ))}

      <p className={TEXTE}>
        <b>{t("tour.grille.recharges")}</b>
      </p>
      {grille.recharges.map((r, i) => (
        <fieldset key={r.code} className="mt-2" data-recharge={r.code}>
          <legend>
            <b>{String(r["libelle"] ?? r.code)}</b>
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {CHAMPS_RECHARGE.map(([cle, libelle]) => (
              <label key={cle} className={`${TEXTE} flex flex-col gap-1`}>
                {t(libelle)}
                <input
                  inputMode="decimal"
                  value={r[cle] === null || r[cle] === undefined ? "" : String(r[cle])}
                  onChange={(e) =>
                    changerRecharge(i, cle, saisieDecimale(e.target.value) ?? e.target.value)
                  }
                  className={CHAMP}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className={BOUTON}
          disabled={verifier.isPending}
          onClick={() => verifier.mutate()}
        >
          {t("tour.grille.verifier")}
        </button>
        {(trous ?? []).map((x, k) => (
          <p key={`${x.code}-${k}`} className={ALERTE}>
            {TROUS[x.code] ? t(TROUS[x.code]!, { detail: x.detail }) : `${x.code} ${x.detail}`}
          </p>
        ))}
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
          disabled={publier.isPending || motif.trim() === "" || trous === null || trous.length > 0}
          onClick={() => publier.mutate()}
        >
          {t("tour.grille.publier")}
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
