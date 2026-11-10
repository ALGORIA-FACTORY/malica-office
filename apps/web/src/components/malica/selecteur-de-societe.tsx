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

import { FeuilleDeChoix, type ElementDeChoix } from "@/components/malica/feuille-de-choix";
import { useI18n } from "@/i18n";
import { noterRecente, plier, recentes as lireRecentes } from "@/lib/mes-societes";

export interface SocieteDuSelecteur {
  id: string;
  name: string;
  matricule?: string | null;
}

const CLE_EPINGLEES = "malica.societes.epinglees";

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

export function SelecteurDeSociete({
  societes,
  ouverte,
  surMesSocietes,
  onOuvrir,
  onToutes,
}: {
  societes: readonly SocieteDuSelecteur[];
  /**
   * La société OUVERTE — celle de l'accueil. Planche 13 (approuvée le
   * 8 novembre 2026) : l'accueil et la bibliothèque ne changent pas ; la
   * bibliothèque garde ses propres filtres, et l'en-tête nomme la société
   * dont l'accueil parle.
   */
  ouverte: string;
  /** Vrai sur l'écran « Mes sociétés » : l'en-tête dit alors « Toutes les sociétés ». */
  surMesSocietes: boolean;
  /** Ouvre la société et son accueil, le même qu'aujourd'hui. */
  onOuvrir: (id: string) => void;
  /** Ouvre l'écran « Mes sociétés ». */
  onToutes: () => void;
}) {
  const { t, locale } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const [epinglees, setEpinglees] = useState<string[]>([]);
  const [recentes, setRecentes] = useState<string[]>([]);
  const vueConsolidee = surMesSocietes;
  const fermer = useCallback(() => setOuvert(false), []);
  const puce = useRef<HTMLButtonElement>(null);
  /** Sur l'ordinateur, la feuille s'ancre sous la puce. */
  const [ancre, setAncre] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setEpinglees(lire(CLE_EPINGLEES));
    setRecentes(lireRecentes());
    setAncre(puce.current?.getBoundingClientRect() ?? null);
  }, [ouvert]);

  const triees = useMemo(
    () => [...societes].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [societes, locale],
  );
  const parId = useMemo(() => new Map(societes.map((s) => [s.id, s])), [societes]);
  const rang = triees.findIndex((s) => s.id === ouverte) + 1;
  const courante = parId.get(ouverte);
  const nom = vueConsolidee ? t("pme.notifs.toutesSocietes") : (courante?.name ?? "");

  /*
   * UN NOM TROP LONG DÉFILE DANS LE BOUTON (dirigeant, 8 novembre 2026).
   *
   * « Si le nom de la société est trop long, il faut qu'il défile dans le
   * bouton. » On mesure ce qui dépasse ; s'il dépasse, le nom glisse jusqu'à
   * sa fin, s'y arrête, puis revient — et recommence. Sous « mouvement
   * réduit », il ne bouge pas et se coupe en « … » (règle globale).
   */
  const cadre = useRef<HTMLSpanElement>(null);
  const texte = useRef<HTMLElement>(null);
  const [depasse, setDepasse] = useState(0);
  useEffect(() => {
    const mesurer = () => {
      const c = cadre.current;
      const x = texte.current;
      setDepasse(c && x ? Math.max(0, Math.ceil(x.scrollWidth - c.clientWidth)) : 0);
    };
    mesurer();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(mesurer);
    if (cadre.current) obs.observe(cadre.current);
    return () => obs.disconnect();
  }, [nom]);

  const chercher = (texte: string) => {
    const q = plier(texte);
    return triees
      .filter((x) => plier(x.name).includes(q) || plier(x.matricule ?? "").includes(q))
      .map(element);
  };
  const deListe = (ids: string[]) =>
    ids.map((id) => parId.get(id)).filter((x): x is SocieteDuSelecteur => !!x);

  /** Une société, telle que la feuille la montre. */
  const element = (x: SocieteDuSelecteur): ElementDeChoix => ({
    id: x.id,
    nom: x.name,
    sous: x.matricule,
    mention: x.id === ouverte && !vueConsolidee ? t("pme.societes.ouverte") : null,
  });

  const epingler = (id: string) => {
    const e = lire(CLE_EPINGLEES);
    const suivantes = e.includes(id) ? e.filter((x) => x !== id) : [id, ...e];
    ecrire(CLE_EPINGLEES, suivantes);
    setEpinglees(suivantes);
  };
  const epingle = (e: ElementDeChoix) => {
    const epinglee = epinglees.includes(e.id);
    return (
      <button
        type="button"
        className="ep"
        aria-pressed={epinglee}
        aria-label={epinglee ? t("pme.societes.desepingler") : t("pme.societes.epingler")}
        onClick={() => epingler(e.id)}
      >
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
        </svg>
      </button>
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
        <span
          ref={cadre}
          className="nom"
          data-defile={depasse > 0 || undefined}
          style={
            {
              "--decal": `-${depasse}px`,
              "--duree": `${Math.max(6, 4 + depasse / 18)}s`,
            } as React.CSSProperties
          }
        >
          <b ref={texte}>{nom}</b>
        </span>
        <span className="rg">{vueConsolidee ? societes.length : `${rang}/${societes.length}`}</span>
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <FeuilleDeChoix
        ouverte={ouvert}
        fermer={fermer}
        ancre={ancre}
        titre={t("pme.societes.changer")}
        placeholder={t("pme.societes.chercher")}
        aucun={t("pme.societes.aucune")}
        tout={{
          libelle: t("pme.notifs.toutesSocietes"),
          sous: t("pme.societes.ouvreMesSocietes", { count: societes.length }),
        }}
        courant={vueConsolidee ? null : ouverte}
        groupes={[
          { titre: t("pme.societes.epinglees"), elements: deListe(epinglees).map(element) },
          { titre: t("pme.societes.recentes"), elements: recentesHorsEpinglees.map(element) },
          { titre: t("pme.societes.toutesAZ"), elements: triees.map(element) },
        ]}
        chercher={chercher}
        choisir={(id) => {
          if (id === null) onToutes();
          else {
            noterRecente(id);
            onOuvrir(id);
          }
        }}
        secondaire={epingle}
      />
    </div>
  );
}
