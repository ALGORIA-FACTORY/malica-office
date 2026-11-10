/**
 * La feuille de choix — UNE mécanique pour choisir un élément parmi beaucoup.
 *
 * Née dans le sélecteur de société de l'en-tête (planche 2, 7 novembre 2026),
 * elle sert aussi aux sièges d'un dossier (10 novembre 2026) : même feuille
 * qui monte du bas sur le téléphone, même panneau ancré sur l'ordinateur,
 * même champ de recherche qui prend le focus, même « Tous » en tête, mêmes
 * groupes, même ligne. Ce qui diffère — quoi chercher, comment grouper, le
 * geste secondaire d'une ligne — est passé par celui qui l'ouvre.
 *
 * Échap ferme, le bouton Retour d'Android aussi ; le focus reste dans la
 * feuille (`useSuperposition`). Rendue dans un portail à la racine de la
 * surface PME : la barre du bas et l'en-tête forment chacun leur empilement,
 * et la feuille passerait dessous.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useSuperposition } from "@/hooks/use-superposition";
import { initialesDe } from "@/lib/mes-societes";

/** Une ligne de la feuille : ce qu'on peut choisir. */
export interface ElementDeChoix {
  id: string;
  nom: string;
  /** Sous le nom : un matricule, une société, un total… */
  sous?: string | null | undefined;
  /** Ce que porte la pastille ; les initiales du nom par défaut. */
  initiales?: string;
  /** Le ton de l'anneau de la pastille, dans le vocabulaire de `TON_PME` : `am` attend, `ok` pris en charge. */
  ton?: "ok" | "am" | "neutre" | undefined;
  /** À droite : « Ouverte », « 1 attend »… */
  mention?: string | null | undefined;
}

/** Un groupe de lignes, avec ou sans titre. */
export interface GroupeDeChoix {
  titre?: string;
  elements: readonly ElementDeChoix[];
}

export function FeuilleDeChoix({
  ouverte,
  fermer,
  ancre,
  titre,
  placeholder,
  aucun,
  tout,
  courant,
  groupes,
  chercher,
  choisir,
  secondaire,
}: {
  ouverte: boolean;
  fermer: () => void;
  /** Sur l'ordinateur, le panneau s'ancre sous ce rectangle. */
  ancre: DOMRect | null;
  titre: string;
  placeholder: string;
  /** Quand la recherche ne trouve rien. */
  aucun: string;
  /** La ligne « Tous », en tête. */
  tout: { libelle: string; sous: string };
  /** L'élément courant ; `null` : « Tous ». */
  courant: string | null;
  /** Les groupes montrés sans recherche. */
  groupes: readonly GroupeDeChoix[];
  /** Les lignes qui répondent à une recherche (déjà filtrées par l'appelant). */
  chercher: (texte: string) => readonly ElementDeChoix[];
  /** `null` : « Tous ». */
  choisir: (id: string | null) => void;
  /** Un geste de plus par ligne (épingler…), ou rien. */
  secondaire?: (e: ElementDeChoix) => ReactNode;
}) {
  const [cherche, setCherche] = useState("");
  const champ = useRef<HTMLInputElement>(null);
  const feuille = useRef<HTMLDivElement>(null);
  const fermerStable = useCallback(() => fermer(), [fermer]);
  useSuperposition(ouverte, fermerStable, feuille);

  useEffect(() => {
    if (!ouverte) return;
    setCherche("");
    const id = window.setTimeout(() => champ.current?.focus(), 60);
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
    };
    window.addEventListener("keydown", echap);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", echap);
    };
  }, [ouverte, fermer]);

  if (!ouverte) return null;

  const q = cherche.trim();
  const trouves = q ? chercher(q) : [];
  const prendre = (id: string | null) => {
    choisir(id);
    fermer();
  };

  const ligne = (e: ElementDeChoix) => (
    <li key={e.id}>
      <button
        type="button"
        className="so"
        aria-current={e.id === courant || undefined}
        onClick={() => prendre(e.id)}
      >
        <span className="ini" data-ton={e.ton} aria-hidden>
          {e.initiales ?? initialesDe(e.nom)}
        </span>
        <span className="bd">
          <b>{e.nom}</b>
          {e.sous ? <span>{e.sous}</span> : null}
        </span>
        {e.mention ? <em data-ton={e.ton}>{e.mention}</em> : null}
      </button>
      {secondaire ? secondaire(e) : null}
    </li>
  );

  return createPortal(
    <div className="selsoc">
      <div className="voile" aria-hidden onClick={fermer} />
      <div
        ref={feuille}
        className="feuille"
        style={
          {
            "--haut": `${ancre ? ancre.bottom + 8 : 72}px`,
            "--gauche": `${ancre ? ancre.left : 16}px`,
          } as React.CSSProperties
        }
        role="dialog"
        aria-modal="true"
        aria-label={titre}
      >
        <span className="poignee" aria-hidden />
        <h2>{titre}</h2>
        <label className="cherche">
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={champ}
            type="search"
            value={cherche}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setCherche(e.target.value)}
          />
        </label>
        <div className="defile">
          {q ? (
            trouves.length > 0 ? (
              <ul>{trouves.slice(0, 50).map(ligne)}</ul>
            ) : (
              <p className="rien">{aucun}</p>
            )
          ) : (
            <>
              <button
                type="button"
                className="so toutes"
                aria-current={courant === null || undefined}
                onClick={() => prendre(null)}
              >
                <span className="ini" aria-hidden>
                  ∑
                </span>
                <span className="bd">
                  <b>{tout.libelle}</b>
                  <span>{tout.sous}</span>
                </span>
              </button>
              {groupes
                .filter((g) => g.elements.length > 0)
                .map((g, i) => (
                  <div key={g.titre ?? i}>
                    {g.titre ? <p className="grp">{g.titre}</p> : null}
                    <ul>{g.elements.map(ligne)}</ul>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.querySelector('[data-surface="pme"]') ?? document.body,
  );
}
