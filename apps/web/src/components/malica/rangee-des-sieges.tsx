/**
 * La rangée des sièges d'un dossier — un choix, pas une liste (10 novembre 2026).
 *
 * Les cartes « Sièges » grandissaient avec l'organisation et poussaient les
 * mois hors de l'écran. À leur place : une rangée de pastilles empilées, haute
 * comme une seule carte, qui s'ouvre en feuille (`FeuilleDeChoix`, la même que
 * le sélecteur de société) pour chercher et choisir. Un siège choisi reste
 * seul devant, les autres repliés derrière lui ; la croix revient à tous.
 *
 * Les sièges montrés sont ceux des pièces de ce que l'en-tête montre : une
 * société, ou toutes (chaque siège dit alors sa société). « Tous les sièges »
 * ne va jamais plus loin que l'en-tête.
 *
 * L'anneau d'une pastille est fonctionnel : Amber, une pièce de ce siège
 * attend la personne ; Evergreen, tout est pris en charge (tons `am` et `ok` de `TON_PME`). La pastille porte les initiales ; la photo de profil du compte
 * (`identity.profiles.photo_version`, `usePhotosDeProfil`), quand il en a une,
 * prend leur place — ici et dans la feuille.
 */
import { useRef, useState } from "react";

import { FeuilleDeChoix, type ElementDeChoix } from "@/components/malica/feuille-de-choix";
import { useI18n } from "@/i18n";
import { attendLaPersonne } from "@/lib/lecture";
import { initialesDe, plier } from "@/lib/mes-societes";
import type { PieceLue } from "@malica/socle/ports/repositories";

/** Un siège, tel que le dossier le connaît : la personne et ses pièces. */
export interface Siege {
  id: string;
  nom: string;
  pieces: readonly PieceLue[];
  /** La société, quand l'en-tête les montre toutes. */
  societe?: string | null;
  /** La photo du compte (adresse `blob:`), quand il en a une. */
  photo?: string | null;
}

/**
 * Combien de pastilles la rangée montre avant « +n ». Une mesure de dessin,
 * pas un réglage métier : six pastilles de 36 px qui se chevauchent tiennent
 * dans la rangée à 360 px de large, la plus étroite des cibles.
 */
const PASTILLES_VISIBLES = 5;

function tonDuSiege(pieces: readonly PieceLue[]): ElementDeChoix["ton"] {
  // Un siège n'est ici que par ses pièces : l'anneau dit si l'une attend.
  return pieces.some(attendLaPersonne) ? "am" : "ok";
}

export function RangeeDesSieges({
  sieges,
  choisi,
  choisir,
}: {
  sieges: readonly Siege[];
  /** `null` : tous. */
  choisi: string | null;
  choisir: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [ouverte, setOuverte] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const [ancre, setAncre] = useState<DOMRect | null>(null);

  // Ceux qui attendent la personne d'abord, puis par nombre de pièces.
  const tries = [...sieges].sort((a, b) => {
    const aa = a.pieces.filter(attendLaPersonne).length;
    const bb = b.pieces.filter(attendLaPersonne).length;
    return bb - aa || b.pieces.length - a.pieces.length || a.nom.localeCompare(b.nom);
  });
  const courant = tries.find((s) => s.id === choisi) ?? null;

  const element = (s: Siege): ElementDeChoix => {
    const attend = s.pieces.filter(attendLaPersonne).length;
    return {
      id: s.id,
      nom: s.nom,
      sous: [s.societe, t("pme.home.dossier.pieces", { count: s.pieces.length })]
        .filter(Boolean)
        .join(" · "),
      ton: tonDuSiege(s.pieces),
      photo: s.photo ?? null,
      mention: attend > 0 ? t("pme.sieges.attend", { count: attend }) : null,
    };
  };
  const chercher = (texte: string) => {
    const q = plier(texte);
    return tries
      .filter((s) => plier(s.nom).includes(q) || plier(s.societe ?? "").includes(q))
      .map(element);
  };

  const pastille = (s: Siege, grande = false) => (
    <span
      key={s.id}
      className="past"
      data-ton={tonDuSiege(s.pieces)}
      data-grande={grande || undefined}
      aria-hidden
    >
      {s.photo ? <img src={s.photo} alt="" /> : initialesDe(s.nom)}
    </span>
  );

  const ouvrir = () => {
    setAncre(bouton.current?.getBoundingClientRect() ?? null);
    setOuverte(true);
  };

  return (
    <div className="sieges">
      <div className="sec">
        <h2>{courant ? t("pme.sieges.un") : t("pme.dossier.sieges")}</h2>
        <span>{courant ? `1 / ${sieges.length}` : sieges.length}</span>
      </div>
      {courant ? (
        <div className="rangee" data-choisi>
          <button
            ref={bouton}
            type="button"
            className="pile"
            aria-haspopup="dialog"
            aria-expanded={ouverte}
            aria-label={t("pme.sieges.changer")}
            onClick={ouvrir}
          >
            {pastille(courant, true)}
            {tries.length > 1 ? <span className="past repli" aria-hidden /> : null}
            {tries.length > 2 ? <span className="past repli petit" aria-hidden /> : null}
          </button>
          <span className="bd">
            <b>{courant.nom}</b>
            <span>{element(courant).sous}</span>
          </span>
          <button
            type="button"
            className="x"
            aria-label={t("pme.sieges.tous")}
            onClick={() => choisir(null)}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          ref={bouton}
          type="button"
          className="rangee pile"
          aria-haspopup="dialog"
          aria-expanded={ouverte}
          aria-label={t("pme.sieges.choisirParmi", { count: sieges.length })}
          onClick={ouvrir}
        >
          {tries.slice(0, PASTILLES_VISIBLES).map((s) => pastille(s))}
          {tries.length > PASTILLES_VISIBLES ? (
            <span className="past plus" aria-hidden>
              +{tries.length - PASTILLES_VISIBLES}
            </span>
          ) : null}
          <span className="esp" aria-hidden />
          <svg viewBox="0 0 24 24" className="g chev" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
      <FeuilleDeChoix
        ouverte={ouverte}
        fermer={() => setOuverte(false)}
        ancre={ancre}
        titre={t("pme.sieges.changer")}
        placeholder={t("pme.sieges.chercher")}
        aucun={t("pme.sieges.aucun")}
        tout={{
          libelle: t("pme.sieges.tous"),
          sous: t("pme.sieges.vueDEnsemble", { count: sieges.length }),
        }}
        courant={choisi}
        groupes={[{ titre: t("pme.sieges.enAttenteDAbord"), elements: tries.map(element) }]}
        chercher={chercher}
        choisir={choisir}
      />
    </div>
  );
}
