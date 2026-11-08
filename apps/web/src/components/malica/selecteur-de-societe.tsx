/**
 * Le sélecteur de société de l'en-tête — planche 2, approuvée le 7 novembre 2026.
 *
 * « Avec 113 sociétés, l'en-tête doit aussi dire dans quelle société on est. »
 * L'en-tête porte la société ouverte et sa place (« 1/113 ») ; la toucher
 * ouvre le sélecteur :
 *
 *   [ Nom ou matricule…            ]
 *   ∑  Toutes les sociétés           vue consolidée · 113
 *   ÉPINGLÉES   celles qu'on a épinglées (l'épingle de chaque ligne)
 *   RÉCENTES    les cinq dernières ouvertes
 *   TOUTES      de A à Z
 *
 * Sur le téléphone, une feuille qui monte du bas ; sur l'ordinateur, un
 * panneau sous la puce. Échap ferme ; le champ prend le focus à l'ouverture.
 *
 * Choisir une société l'OUVRE (le dossier courant) et la montre dans la
 * bibliothèque, les dossiers et les échéances. « Toutes » garde le dossier
 * ouvert et montre la vue consolidée.
 *
 * Épinglées et récentes sont des commodités de CET appareil (stockage du
 * navigateur, lu à l'abri d'une exception) : perdues, rien ne casse.
 *
 * Rien de commercial : la ligne d'une société dit son matricule, jamais son
 * offre ni son prix (coque Android, décisions des 20 et 22 octobre 2026).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";

export interface SocieteDuSelecteur {
  id: string;
  name: string;
  matricule?: string | null;
}

const CLE_EPINGLEES = "malica.societes.epinglees";
const CLE_RECENTES = "malica.societes.recentes";
const RECENTES_MAX = 5;

function lire(cle: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(cle) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function ecrire(cle: string, ids: string[]) {
  try {
    window.localStorage.setItem(cle, JSON.stringify(ids));
  } catch {
    /* stockage plein ou refusé : la commodité se perd, rien d'autre */
  }
}

/** Sans accents ni casse : « societe » trouve « Société ». */
function plier(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function initialesDe(nom: string) {
  const mots = nom
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((mots[0]?.[0] ?? "") + (mots[1]?.[0] ?? "")).toLocaleUpperCase() || "·";
}

export function SelecteurDeSociete({
  societes,
  affichee,
  onOuvrir,
  onToutes,
}: {
  societes: readonly SocieteDuSelecteur[];
  /**
   * La société que les écrans MONTRENT (`pme.societeAffichee`), `null` =
   * toutes. C'est elle que l'en-tête nomme : les cartes de la bibliothèque
   * et le filtre des échéances la changent aussi, et l'en-tête ne doit jamais
   * nommer une société pendant que l'écran en montre une autre (revue de #272).
   */
  affichee: string | null;
  onOuvrir: (id: string) => void;
  onToutes: () => void;
}) {
  const { t, locale } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const [cherche, setCherche] = useState("");
  const [epinglees, setEpinglees] = useState<string[]>([]);
  const [recentes, setRecentes] = useState<string[]>([]);
  const vueConsolidee = affichee === null;
  const champ = useRef<HTMLInputElement>(null);
  const feuille = useRef<HTMLDivElement>(null);
  const fermer = useCallback(() => setOuvert(false), []);
  // La pile des superpositions : le bouton Retour d'Android ferme la feuille
  // au lieu de quitter l'écran, et le focus y reste piégé (revue de #272).
  useSuperposition(ouvert, fermer, feuille);
  const puce = useRef<HTMLButtonElement>(null);
  /** Sur l'ordinateur, le panneau s'ancre sous la puce. */
  const [ancre, setAncre] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setEpinglees(lire(CLE_EPINGLEES));
    setRecentes(lire(CLE_RECENTES));
    setCherche("");
    const r = puce.current?.getBoundingClientRect();
    setAncre(r ? { top: r.bottom + 8, left: r.left } : null);
    const id = window.setTimeout(() => champ.current?.focus(), 60);
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(false);
    };
    window.addEventListener("keydown", echap);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const triees = useMemo(
    () => [...societes].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [societes, locale],
  );
  const parId = useMemo(() => new Map(societes.map((s) => [s.id, s])), [societes]);
  const rang = triees.findIndex((s) => s.id === affichee) + 1;
  const courante = affichee ? parId.get(affichee) : undefined;

  const q = plier(cherche.trim());
  const trouvees = q
    ? triees.filter((s) => plier(s.name).includes(q) || plier(s.matricule ?? "").includes(q))
    : [];
  const deListe = (ids: string[]) =>
    ids.map((id) => parId.get(id)).filter((s): s is SocieteDuSelecteur => !!s);

  const choisir = (id: string) => {
    const r = [id, ...lire(CLE_RECENTES).filter((x) => x !== id)].slice(0, RECENTES_MAX);
    ecrire(CLE_RECENTES, r);
    onOuvrir(id);
    setOuvert(false);
  };
  const epingler = (id: string) => {
    const e = lire(CLE_EPINGLEES);
    const suivantes = e.includes(id) ? e.filter((x) => x !== id) : [id, ...e];
    ecrire(CLE_EPINGLEES, suivantes);
    setEpinglees(suivantes);
  };

  const ligne = (s: SocieteDuSelecteur) => {
    const ici = s.id === affichee;
    const epinglee = epinglees.includes(s.id);
    return (
      <li key={s.id}>
        <button
          type="button"
          className="so"
          aria-current={ici || undefined}
          onClick={() => choisir(s.id)}
        >
          <span className="ini" aria-hidden>
            {initialesDe(s.name)}
          </span>
          <span className="bd">
            <b>{s.name}</b>
            {s.matricule ? <span>{s.matricule}</span> : null}
          </span>
          {ici ? <em>{t("pme.societes.ouverte")}</em> : null}
        </button>
        <button
          type="button"
          className="ep"
          aria-pressed={epinglee}
          aria-label={epinglee ? t("pme.societes.desepingler") : t("pme.societes.epingler")}
          onClick={() => epingler(s.id)}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
          </svg>
        </button>
      </li>
    );
  };

  const recentesHorsEpinglees = deListe(recentes.filter((id) => !epinglees.includes(id)));

  return (
    <div className="selsoc">
      <button
        ref={puce}
        type="button"
        className="puce"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
      >
        <b>{vueConsolidee ? t("pme.notifs.toutesSocietes") : (courante?.name ?? "")}</b>
        <span className="rg">{vueConsolidee ? societes.length : `${rang}/${societes.length}`}</span>
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {/*
       * Dans un portail, à la racine de la surface PME : la barre du bas et
       * l'en-tête forment chacun leur propre empilement, et la feuille passait
       * sous la barre du bas.
       */}
      {ouvert
        ? createPortal(
            <div className="selsoc">
              <div className="voile" aria-hidden onClick={() => setOuvert(false)} />
              <div
                ref={feuille}
                className="feuille"
                style={
                  {
                    "--haut": `${ancre?.top ?? 72}px`,
                    "--gauche": `${ancre?.left ?? 16}px`,
                  } as React.CSSProperties
                }
                role="dialog"
                aria-modal="true"
                aria-label={t("pme.societes.changer")}
              >
                <span className="poignee" aria-hidden />
                <h2>{t("pme.societes.changer")}</h2>
                <label className="cherche">
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={champ}
                    type="search"
                    value={cherche}
                    placeholder={t("pme.societes.chercher")}
                    aria-label={t("pme.societes.chercher")}
                    onChange={(e) => setCherche(e.target.value)}
                  />
                </label>
                <div className="defile">
                  {q ? (
                    trouvees.length > 0 ? (
                      <ul>{trouvees.slice(0, 50).map(ligne)}</ul>
                    ) : (
                      <p className="rien">{t("pme.societes.aucune")}</p>
                    )
                  ) : (
                    <>
                      <button
                        type="button"
                        className="so toutes"
                        aria-current={vueConsolidee || undefined}
                        onClick={() => {
                          onToutes();
                          setOuvert(false);
                        }}
                      >
                        <span className="ini" aria-hidden>
                          ∑
                        </span>
                        <span className="bd">
                          <b>{t("pme.notifs.toutesSocietes")}</b>
                          <span>{t("pme.societes.consolidee", { count: societes.length })}</span>
                        </span>
                      </button>
                      {epinglees.length > 0 ? (
                        <>
                          <p className="grp">{t("pme.societes.epinglees")}</p>
                          <ul>{deListe(epinglees).map(ligne)}</ul>
                        </>
                      ) : null}
                      {recentesHorsEpinglees.length > 0 ? (
                        <>
                          <p className="grp">{t("pme.societes.recentes")}</p>
                          <ul>{recentesHorsEpinglees.map(ligne)}</ul>
                        </>
                      ) : null}
                      <p className="grp">{t("pme.societes.toutesAZ")}</p>
                      <ul>{triees.map(ligne)}</ul>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.querySelector('[data-surface="pme"]') ?? document.body,
          )
        : null}
    </div>
  );
}
