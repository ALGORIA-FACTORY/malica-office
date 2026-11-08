/**
 * La cloche de l'en-tête — planche 12, approuvée le 7 novembre 2026.
 *
 * « Les notifications viennent à l'entête normalement, il y a une cloche »
 * (recette du 7 novembre). Elle vit dans la barre d'application, donc sur
 * TOUS les écrans PME, et compte ce qui n'est pas lu dans TOUTES les sociétés
 * de la personne — un seul appel (`collab.notifications` prend une liste).
 *
 * =================================================================== CE QU'ELLE FAIT
 *
 *   au repos, non lu    une aura qui respire, un léger tintement toutes les 5 s
 *   une arrivée         elle se balance, le battant frappe, trois ondes, huit
 *                       éclats, la pastille surgit avec le chiffre ; l'île
 *                       (téléphone) ou la carte (ordinateur) dit ce qui arrive
 *   tout lu             la pastille implose, une coche paraît puis s'efface
 *
 * Toucher la cloche ouvre l'écran des notifications (planche 2).
 *
 * Aucun de ces mouvements sous `prefers-reduced-motion` : la feuille les
 * retire, le chiffre et l'île restent.
 *
 * La première lecture n'est pas une arrivée : ouvrir l'application avec
 * douze notifications ne fait pas sonner la cloche douze fois, ni une.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cleDuGenre, detailDe } from "@/lib/libelle-de-notification";

export interface DerniereNotification {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ClocheProps {
  /** Le nombre d'alertes à traiter, toutes sociétés ; `null` tant qu'on ne sait pas. */
  nonLues: number | null;
  /** La plus récente des non lues : ce que l'île annonce quand elle arrive. */
  derniere: DerniereNotification | null;
}

const DUREE_SONNERIE_MS = 1300;
const DUREE_ILE_MS = 4100;
const DUREE_COCHE_MS = 2200;
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function ClocheDeLEntete({ nonLues, derniere }: ClocheProps) {
  const { t } = useI18n();
  const precedent = useRef<number | null>(null);
  const [sonne, setSonne] = useState(false);
  const [ile, setIle] = useState<DerniereNotification | null>(null);
  const [vu, setVu] = useState(false);

  // La dernière connue, lue au moment d'une arrivée : l'objet change à chaque
  // rendu, il ne doit pas relancer l'effet (ni couper ses minuteries).
  const derniereRef = useRef(derniere);
  derniereRef.current = derniere;

  /*
   * Une minuterie par effet, remplacée par la suivante et coupée au départ
   * de l'écran seulement : une seconde arrivée pendant la première relance
   * la sonnerie au lieu de la laisser figée.
   */
  const minuteries = useRef<Record<"sonne" | "ile" | "vu", ReturnType<typeof setTimeout> | null>>({
    sonne: null,
    ile: null,
    vu: null,
  });
  const plusTard = (quoi: "sonne" | "ile" | "vu", ms: number, faire: () => void) => {
    const m = minuteries.current;
    if (m[quoi]) clearTimeout(m[quoi]);
    m[quoi] = setTimeout(faire, ms);
  };
  useEffect(() => {
    const m = minuteries.current;
    return () => Object.values(m).forEach((x) => x && clearTimeout(x));
  }, []);

  useEffect(() => {
    const avant = precedent.current;
    precedent.current = nonLues;
    if (nonLues === null || avant === null) return;
    if (nonLues > avant) {
      setVu(false);
      setSonne(true);
      setIle(derniereRef.current);
      plusTard("sonne", DUREE_SONNERIE_MS, () => setSonne(false));
      plusTard("ile", DUREE_ILE_MS, () => setIle(null));
    } else if (nonLues === 0 && avant > 0) {
      setVu(true);
      plusTard("vu", DUREE_COCHE_MS, () => setVu(false));
    }
  }, [nonLues]);

  const n = nonLues ?? 0;
  const etiquette = n > 0 ? t("pme.cloche.nonLues", { count: n }) : t("pme.notifs.title");

  return (
    <>
      <div className="cloche" data-calme={n === 0 || undefined}>
        <span className="aura" aria-hidden />
        <span className="ondes" data-on={sonne || undefined} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="eclats" data-on={sonne || undefined} aria-hidden>
          {ANGLES.map((a) => (
            <i key={a} style={{ "--a": `${a}deg` } as React.CSSProperties} />
          ))}
        </span>
        <Link
          to="/pme/notifications"
          className="cl"
          data-sonne={sonne || undefined}
          aria-label={etiquette}
          onClick={() => setIle(null)}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path className="bat" d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </Link>
        {n > 0 ? (
          <span className="pas" data-pop={sonne || undefined} aria-hidden>
            <b key={n}>{n > 99 ? "99+" : n}</b>
          </span>
        ) : vu ? (
          <span className="vu" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </div>
      {ile ? (
        <Link
          to="/pme/notifications"
          className="ile-notif"
          role="status"
          onClick={() => setIle(null)}
        >
          <span className="pt" aria-hidden>
            {t("pme.cloche.nouvelle")}
          </span>
          <b>{t(cleDuGenre(ile.kind, ile.payload))}</b>
          {detailDe(ile.kind, ile.payload) ? <span>{detailDe(ile.kind, ile.payload)}</span> : null}
          <i className="temps" aria-hidden />
        </Link>
      ) : null}
    </>
  );
}
