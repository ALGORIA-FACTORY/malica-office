/**
 * La carte « Facturation automatique » de la tour — ouvrir ou couper l'émission.
 *
 * Écran réservé aux opérateurs d'ALGORIA (la tour). Pour chaque périmètre, cabinets
 * puis PME, l'opérateur voit si l'émission automatique est ouverte ou coupée, qui l'a
 * décidé et pourquoi, règle la fenêtre de rattrapage en mois, et lit ce que le dernier
 * passage a émis, trouvé déjà émis, jugé sans rien à facturer, ou laissé en erreur.
 * Ouvrir ou couper exige un motif, tracé avec la décision. Les données viennent de
 * `office().tour` : la base décide, et refuse à qui n'est pas opérateur (R3). L'écran
 * ne calcule aucune facture.
 */
import type {
  EtatDuPerimetreDeFacturation,
  PerimetreDeFacturation,
} from "@malica/socle/ports/repositories";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const ENTIER = /^\d+$/;

/** Ce que chaque périmètre dit de lui-même : son titre, son aide, son rattrapage. */
const PERIMETRES: ReadonlyArray<{
  code: PerimetreDeFacturation;
  titre: MessageKey;
  aide: MessageKey;
  rattrapage: MessageKey;
  rattrapageAide: MessageKey;
}> = [
  {
    code: "cabinets",
    titre: "tour.facturation.cabinets",
    aide: "tour.facturation.cabinets.aide",
    rattrapage: "tour.facturation.cabinets.rattrapage",
    rattrapageAide: "tour.facturation.cabinets.rattrapage.aide",
  },
  {
    code: "pme",
    titre: "tour.facturation.pme",
    aide: "tour.facturation.pme.aide",
    rattrapage: "tour.facturation.pme.rattrapage",
    rattrapageAide: "tour.facturation.pme.rattrapage.aide",
  },
];

/**
 * L'émission automatique des factures (décisions du 4 novembre 2026) : deux
 * périmètres indépendants. Les cabinets reçoivent chaque mois, à terme échu,
 * leur facture consolidée ; les PME paient d'avance, à leur date
 * anniversaire, et une montée ou une place de plus part le jour même sur une
 * facture complémentaire. La tour ouvre ou coupe chacun, motif à l'appui,
 * règle sa fenêtre de rattrapage, et voit ce que son dernier passage a fait.
 * La base décide de tout le reste.
 */
export function LaFacturationAutomatique() {
  const { t } = useI18n();
  const etat = useQuery({
    queryKey: ["tour-facturation-auto"],
    queryFn: () => office().tour.reglageFacturationAuto(),
  });

  return (
    <div className={CARTE} data-facturation-auto>
      <h2 className={TITRE}>{t("tour.facturation")}</h2>
      <p className={TEXTE}>{t("tour.facturation.aide")}</p>
      {etat.isPending ? <p className={TEXTE}>{t("common.loading")}</p> : null}
      {PERIMETRES.map((p) => (
        <UnPerimetre
          key={p.code}
          perimetre={p}
          etat={etat.data?.[p.code] ?? null}
          charge={etat.isSuccess}
        />
      ))}
    </div>
  );
}

function UnPerimetre({
  perimetre,
  etat,
  charge,
}: {
  perimetre: (typeof PERIMETRES)[number];
  etat: EtatDuPerimetreDeFacturation | null;
  charge: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const [rattrapage, setRattrapage] = useState("");
  const [motif, setMotif] = useState("");

  const r = etat?.reglage ?? null;
  const dernier = etat?.dernier ?? null;

  useEffect(() => {
    if (r) setRattrapage(String(r.rattrapage_mois));
  }, [r]);

  const valide = ENTIER.test(rattrapage.trim()) && Number(rattrapage) >= 1;
  const pret = charge && valide && motif.trim() !== "";

  const regler = useMutation({
    mutationFn: (actif: boolean) =>
      office().tour.reglerFacturationAuto(perimetre.code, actif, Number(rattrapage), motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-facturation-auto"] });
    },
    onError: echec,
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  const qui = r?.decide_par_nom ?? r?.decide_par_email ?? null;
  const compteurs: Array<{ cle: MessageKey; n: number; couleur: string }> = dernier
    ? [
        { cle: "tour.facturation.compteur.emises", n: dernier.emises, couleur: "" },
        { cle: "tour.facturation.compteur.deja", n: dernier.deja_emises, couleur: "" },
        { cle: "tour.facturation.compteur.rien", n: dernier.rien_a_facturer, couleur: "" },
        {
          cle: "tour.facturation.compteur.erreurs",
          n: dernier.erreurs,
          couleur: dernier.erreurs > 0 ? "text-signal-stop" : "",
        },
      ]
    : [];

  return (
    <section className="mt-4 border-t border-border pt-4" data-perimetre={perimetre.code}>
      <h3 className={TITRE}>{t(perimetre.titre)}</h3>
      <p className={TEXTE}>{t(perimetre.aide)}</p>
      {r ? (
        <>
          <p className={`${TEXTE} ${r.actif ? "text-signal-ok" : ""}`} data-etat>
            {t(r.actif ? "tour.facturation.etat.ouverte" : "tour.facturation.etat.coupee", {
              date: date(r.decide_le),
            })}
          </p>
          <p className={TEXTE} data-par>
            {qui ? t("tour.facturation.par", { qui }) : t("tour.facturation.parLaLivraison")}
          </p>
          <p className={TEXTE} data-motif>
            {t("tour.facturation.motif", { motif: r.motif })}
          </p>
        </>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t(perimetre.rattrapage)}
          <input
            value={rattrapage}
            onChange={(e) => setRattrapage(e.target.value)}
            inputMode="numeric"
            aria-label={t(perimetre.rattrapage)}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        <p className={TEXTE}>{t(perimetre.rattrapageAide)}</p>
        {!valide && charge ? <p className={ALERTE}>{t("tour.facturation.invalide")}</p> : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          // Dans une colonne, `flex-1` du champ commun l'écrasait à 18 px (recette du 5 novembre).
          className={`${CHAMP} w-full flex-none`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-basculer
            className={BOUTON}
            disabled={regler.isPending || !pret}
            onClick={() => regler.mutate(!r?.actif)}
          >
            {t(r?.actif ? "tour.facturation.couper" : "tour.facturation.ouvrir")}
          </button>
          {r?.actif ? (
            <button
              type="button"
              className={BOUTON}
              disabled={regler.isPending || !pret}
              onClick={() => regler.mutate(true)}
            >
              {t("tour.enregistrer")}
            </button>
          ) : null}
        </div>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}

      <h4 className={`${TITRE} mt-4`}>
        {dernier
          ? t("tour.facturation.dernier", { date: date(dernier.passee_le) })
          : t("tour.facturation.dernier.aucun")}
      </h4>
      {dernier ? (
        <>
          <ul className="grid gap-1 sm:grid-cols-4" data-compteurs>
            {compteurs.map((c) => (
              <li key={c.cle} className={TEXTE} data-compteur={c.cle}>
                {t(c.cle)} · <span className={`num ${c.couleur}`}>{c.n}</span>
              </li>
            ))}
          </ul>
          {dernier.detail_erreurs.length > 0 ? (
            <ul className="grid gap-1">
              {dernier.detail_erreurs.map((e) => (
                <li
                  key={`${e.licence ?? e.cabinet ?? ""}-${e.periode}`}
                  className={`${TEXTE} text-signal-stop`}
                  data-erreur
                >
                  <span className="num">{e.periode}</span> · <span className="num">{e.cle}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
