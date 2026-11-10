/**
 * La carte d'un groupe de pièces — un mois, une société, un siège.
 *
 * Elle était dessinée dans la bibliothèque seule. Le dossier ouvert la reprend
 * (1er novembre 2026, maquette validée par Wissem) : UNE carte, la même
 * feuille (`.grp`), pour que les deux écrans ne divergent jamais.
 */
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function CarteDeGroupe({
  icone,
  accent = false,
  titre,
  sous,
  valeur,
  n,
  onClick,
  presse,
  deroule,
}: {
  icone: ReactNode;
  /** L'icône prend l'accent (`.cli`) : un groupe de ventes, ou le choix en cours. */
  accent?: boolean;
  titre: ReactNode;
  /** La ligne sous le titre, déjà classée par l'appelant (`.k` ou `.miss`). */
  sous?: ReactNode;
  valeur: ReactNode;
  n: number;
  onClick: () => void;
  /** Une carte qu'on choisit : `aria-pressed`. */
  presse?: boolean;
  /** Une carte qui déroule ses pièces : `aria-expanded`. */
  deroule?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="grp"
      aria-pressed={presse}
      aria-expanded={deroule}
      onClick={onClick}
    >
      <i className={cn(accent && "cli")}>{icone}</i>
      <span className="bd">
        <b>{titre}</b>
        {sous}
        <span className="v">{valeur}</span>
      </span>
      <span className="n">
        <b>{n}</b>
        <span>{t("pme.list.pieces")}</span>
      </span>
    </button>
  );
}

/** Un calendrier — une période. */
export function IconeCalendrier() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/** Une silhouette — un siège, la personne qui a déposé la pièce. */
export function IconeSiege() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </svg>
  );
}
