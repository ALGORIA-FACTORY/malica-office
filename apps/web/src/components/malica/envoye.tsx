/**
 * « Envoyé » : un seul modèle pour tout ce qui part chez quelqu'un.
 *
 * Maquette « Écran Envoyé », validée le 27 octobre 2026. Demande de Wissem :
 * « les boutons transmis doivent finir avec un écran qui informe de ça, et
 * s'appliquer dans toute l'app ». Avant, un envoi réussi se voyait mal ou pas
 * du tout : la pièce disparaissait du coffre, la feuille de réponse se
 * refermait sans un mot, le retour du cabinet tenait en une ligne grise.
 *
 * Trois tailles, selon le poids du geste :
 *
 *   - `EcranEnvoye` — plein écran, quand l'envoi TERMINE la tâche (une pièce
 *     transmise, un lot). Il dit qui l'a reçu et depuis quand, ce qui se passe
 *     ensuite, et donne deux sorties ; un lot nomme ce qui est resté ;
 *   - `ConfirmationSurPlace` — une ligne cochée À LA PLACE du bouton, pour un
 *     geste court (rappel, réponse, relance) ; elle reste ;
 *   - `PasEncoreParti` — quand rien n'est parti : une phrase, et réessayer.
 *     Le détail technique va au journal, jamais à l'écran.
 *
 * Et le panneau du cabinet, `PanneauRetourne`, même grammaire en largeur.
 *
 * Rien ne s'affiche avant la réponse du serveur : « Envoyé » n'est jamais
 * une promesse.
 */
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { momentDeLEnvoi } from "@/lib/lisible";

export interface Sortie {
  libelle: string;
  action: () => void;
}

/** La coche, tracée comme celle de « C'est réglé ». */
function Coche({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M4 12.5l5 5L20 6.5" strokeDasharray="34" className="rg-draw" />
    </svg>
  );
}

export interface Restee {
  id: string;
  nom: string;
  raison: string;
  ouvrir: () => void;
}

/**
 * L'envoi a terminé la tâche : plein écran, dans le style de « C'est réglé ».
 *
 * `restees` n'est rendu que si quelque chose n'est pas parti : un succès
 * partiel ne dit jamais « tout est parti ».
 */
export function EcranEnvoye({
  titre,
  quoi,
  suite,
  trace,
  restees,
  principale,
  secondaire,
  lien,
}: {
  titre: string;
  /** Qui l'a reçu, et depuis quand — écrit après la réponse du serveur. */
  quoi: ReactNode;
  /** Ce qui se passe ensuite. */
  suite: string | null;
  /** Ce que la pièce garde : « Transmise à AUDICORP · 27/10 ». */
  trace: string | null;
  restees?: { titre: string; liste: readonly Restee[]; ouvrir: string } | null;
  principale: Sortie;
  secondaire: Sortie | null;
  /** Le chemin de retour, toujours une demande. */
  lien?: Sortie | null;
}) {
  return (
    <div
      role="status"
      className="pt-safe rg-rise fixed inset-0 z-40 flex w-full flex-col items-center justify-center overflow-y-auto bg-background px-10 py-10 text-center"
    >
      <Coche className="shrink-0 text-signal-ok" />
      <p className="mt-5 text-[27px] font-semibold tracking-[-0.03em]">{titre}</p>
      <p className="mt-2.5 max-w-[290px] text-[15px] leading-[1.55] text-foreground">{quoi}</p>
      {suite ? (
        <p className="mt-2 max-w-[290px] text-[15px] leading-[1.55] text-text-2">{suite}</p>
      ) : null}
      {trace ? (
        <span className="mt-6 inline-flex min-h-[34px] items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] font-semibold text-signal-info">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {trace}
        </span>
      ) : null}

      {restees && restees.liste.length > 0 ? (
        <div className="mt-8 w-full text-start">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {restees.titre}
          </p>
          <ul className="mt-2.5 flex flex-col gap-2">
            {restees.liste.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-[18px] bg-card px-4 py-3.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="truncate text-[15px]">{r.nom}</b>
                  <span className="text-[13px] text-text-2">{r.raison}</span>
                </span>
                <button
                  type="button"
                  onClick={r.ouvrir}
                  className="min-h-[44px] shrink-0 rounded-full border border-line-strong px-3.5 text-[13px] font-semibold"
                >
                  {restees.ouvrir}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-10 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={principale.action}
          className="min-h-[52px] rounded-full bg-foreground text-[15px] font-semibold text-background"
        >
          {principale.libelle}
        </button>
        {secondaire ? (
          <button
            type="button"
            onClick={secondaire.action}
            className="min-h-[48px] rounded-full border border-line-strong text-[14px] font-medium"
          >
            {secondaire.libelle}
          </button>
        ) : null}
      </div>
      {lien ? (
        <button
          type="button"
          onClick={lien.action}
          className="mt-5 min-h-[44px] text-[13px] text-muted-foreground underline underline-offset-[3px]"
        >
          {lien.libelle}
        </button>
      ) : null}
    </div>
  );
}

/** Un geste court : la confirmation s'écrit à la place du bouton, et reste. */
export function ConfirmationSurPlace({ titre, detail }: { titre: string; detail: string }) {
  return (
    <div role="status" className="flex min-h-[58px] items-center gap-3 py-2 text-start">
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden
        className="shrink-0 text-signal-ok"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[14px]">{titre}</b>
        <span className="text-[12.5px] text-text-2">{detail}</span>
      </span>
    </div>
  );
}

/**
 * Rien n'est parti : une phrase, et réessayer.
 *
 * La raison technique est déjà au journal (`texteDeLErreur`) : l'écran ne la
 * montre pas, il dit seulement ce qui compte — rien n'a été envoyé.
 */
export function PasEncoreParti({
  qui,
  reessayer,
  enCours,
}: {
  qui: string;
  reessayer: () => void;
  enCours: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-[18px] border border-line-strong px-4 py-3.5 text-start"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[14px]">{t("envoi.pasParti")}</b>
        <span className="text-[12.5px] text-text-2">{t("envoi.pasParti.rien", { qui })}</span>
      </span>
      <button
        type="button"
        disabled={enCours}
        onClick={reessayer}
        className="min-h-[44px] shrink-0 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        {enCours ? t("common.loading") : t("envoi.reessayer")}
      </button>
    </div>
  );
}

/** Un retour au client, tel qu'il est parti : ce que le client lit, et quand. */
export interface RetourEnvoye {
  motif: string;
  note: string | null;
  le: string;
}

/**
 * Le cabinet : l'envoi a terminé la tâche de la pièce, le panneau le dit en
 * entier — ce que le client lit, mot pour mot, et la suite.
 */
export function PanneauRetourne({
  piece,
  client,
  retour,
  suivante,
  file,
}: {
  /** « ÉMETTEUR · montant devise » ; vide : « Cette pièce ». */
  piece: string;
  /** Le client, tel que la file le nomme ; `null` : « le client ». */
  client: string | null;
  retour: RetourEnvoye;
  suivante: (() => void) | null;
  file: () => void;
}) {
  const { t, locale } = useI18n();
  const vars = {
    piece: piece || t("envoi.piece.sansNom"),
    client: client ?? t("envoi.cab.client"),
    quand: momentDeLEnvoi(retour.le, locale).quand,
    motif: retour.motif,
  };
  return (
    <section role="status" className="flex flex-col gap-4 py-2">
      <Coche className="text-signal-ok" />
      <p className="text-[30px] font-extrabold leading-tight tracking-[-0.03em]">
        {t("envoi.cab.retour.titre")}
      </p>
      <p className="text-[15px] leading-[1.55] text-foreground">
        {retour.note ? t("envoi.cab.retour.phrase.note", vars) : t("envoi.cab.retour.phrase", vars)}
      </p>
      <p className="text-[15px] leading-[1.55] text-muted-foreground">
        {t("envoi.cab.retour.suite")}
      </p>
      <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-card px-4 py-3.5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t("envoi.cab.retour.lit")}
        </span>
        <b className="text-[14px]">{retour.motif}</b>
        {retour.note ? <q className="text-[13.5px] text-text-2">{retour.note}</q> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2.5">
        {suivante ? (
          <button
            type="button"
            onClick={suivante}
            className="min-h-[52px] rounded-[12px] bg-foreground px-[22px] text-[15px] font-semibold text-background"
          >
            {t("envoi.suivante")} ›
          </button>
        ) : null}
        <button
          type="button"
          onClick={file}
          className="min-h-[52px] rounded-[12px] border border-line-strong bg-card px-[22px] text-[15px] font-semibold"
        >
          {t("envoi.cab.file")}
        </button>
      </div>
    </section>
  );
}
