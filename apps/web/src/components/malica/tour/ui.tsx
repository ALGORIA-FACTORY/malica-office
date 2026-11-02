/**
 * Les pièces de dessin de l'espace commun de la tour (2 novembre 2026).
 *
 * Edition One, étendu : encre, papier et gris pour l'essentiel ; filets plutôt
 * que boîtes ; coins nets ; Inter pour le texte, IBM Plex Mono tabulaire pour
 * les chiffres. La couleur ne sert qu'à dire un ÉTAT, par les quatre couleurs
 * fonctionnelles de la marque (jetons `--etat-*`, contraste AA dans les deux
 * thèmes). Aucune de ces pièces ne décide : elles montrent ce que la base rend.
 */
import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import type { EtatDuClient } from "@/lib/clients-de-la-tour";
import { cn } from "@/lib/utils";

/** Le focus du clavier, visible partout dans la tour. */
export const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

const TONS: Record<EtatDuClient, { cle: MessageKey; ton: string }> = {
  paye: { cle: "tour.etat.paye", ton: "text-etat-ok bg-etat-ok/10" },
  a_echoir: { cle: "tour.etat.a_echoir", ton: "text-etat-warn bg-etat-warn/10" },
  partiel: { cle: "tour.etat.partiel", ton: "text-etat-warn bg-etat-warn/10" },
  impaye: { cle: "tour.etat.impaye", ton: "text-etat-stop bg-etat-stop/10" },
  suspendu: { cle: "tour.etat.suspendu", ton: "bg-foreground text-background" },
  sans_facture: { cle: "tour.etat.sans_facture", ton: "text-muted-foreground bg-muted" },
  sans_licence: { cle: "tour.etat.sans_licence", ton: "text-muted-foreground bg-muted" },
};

/** L'état d'un client, en une pastille : un mot court, sa couleur de fonction. */
export function PastilleDEtat({ etat }: { etat: EtatDuClient }) {
  const { t } = useI18n();
  const { cle, ton } = TONS[etat];
  return (
    <span
      data-etat={etat}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-[11.5px] font-medium",
        ton,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-current" />
      {t(cle)}
    </span>
  );
}

/** Un chiffre de tête : son libellé court, sa valeur en mono, et un filtre s'il en ouvre un. */
export interface Chiffre {
  cle: string;
  libelle: string;
  valeur: string;
  /** Le chiffre dit un état à surveiller : sa valeur prend la couleur de l'état. */
  ton?: "stop" | "warn" | undefined;
  actif?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

/** Quelques chiffres avant la liste : le résumé d'abord, le détail ensuite. */
export function BandeauDeChiffres({ chiffres }: { chiffres: Chiffre[] }) {
  return (
    <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {chiffres.map((c) => {
        const contenu = (
          <>
            <dt className="text-[11.5px] text-muted-foreground">{c.libelle}</dt>
            <dd
              className={cn(
                "num mt-1 text-[21px] font-medium leading-none tracking-[-0.02em] sm:text-[26px]",
                c.ton === "stop" && c.valeur !== "0" && "text-etat-stop",
                c.ton === "warn" && c.valeur !== "0" && "text-etat-warn",
              )}
            >
              {c.valeur}
            </dd>
          </>
        );
        const cadre =
          "min-h-[76px] border-border px-4 py-3.5 text-start [&:not(:last-child)]:border-e max-sm:[&:nth-child(2n)]:border-e-0 max-sm:[&:nth-child(n+3)]:border-t";
        return c.onClick ? (
          <button
            key={c.cle}
            type="button"
            data-chiffre={c.cle}
            aria-pressed={c.actif ?? false}
            onClick={c.onClick}
            className={cn(cadre, FOCUS, "hover:bg-accent", c.actif && "bg-accent")}
          >
            {contenu}
          </button>
        ) : (
          <div key={c.cle} data-chiffre={c.cle} className={cadre}>
            {contenu}
          </div>
        );
      })}
    </dl>
  );
}

/** La recherche d'une longue liste : collée en haut, avec ses filtres à côté. */
export function BarreCollante({
  recherche,
  setRecherche,
  libelle,
  children,
}: {
  recherche: string;
  setRecherche: (v: string) => void;
  libelle: string;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-12 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-9 lg:px-9">
      <label
        className={cn(
          "flex h-11 min-w-0 flex-1 basis-56 items-center gap-2 border border-border bg-card px-3 text-muted-foreground focus-within:border-foreground",
        )}
      >
        <Search size={15} aria-hidden className="shrink-0" />
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={libelle}
          aria-label={libelle}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {children}
    </div>
  );
}

/** Une puce de filtre : 44 px de haut, son compte en mono. */
export function PuceDeFiltre({
  libelle,
  compte,
  actif,
  onClick,
}: {
  libelle: string;
  compte?: number;
  actif: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 border px-3 text-[12.5px]",
        FOCUS,
        actif
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      {libelle}
      {compte !== undefined ? <span className="num text-[11px] opacity-70">{compte}</span> : null}
    </button>
  );
}

/** Des lignes grises le temps que la base réponde : la forme de la liste, sans faux chiffre. */
export function Squelette({ lignes = 6 }: { lignes?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("common.loading")} className="divide-y divide-border">
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <span className="h-3.5 w-1/3 animate-pulse bg-muted motion-reduce:animate-none" />
          <span className="h-3.5 w-1/5 animate-pulse bg-muted motion-reduce:animate-none" />
          <span className="ms-auto h-5 w-16 animate-pulse bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** Une liste vide dit ce qui y apparaîtra, et comment. */
export function Vide({ titre, texte }: { titre: string; texte: string }) {
  return (
    <div data-vide className="border border-dashed border-border px-6 py-12 text-center">
      <p className="text-[14px] font-medium">{titre}</p>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] leading-[1.55] text-muted-foreground">
        {texte}
      </p>
    </div>
  );
}

/** L'en-tête d'un écran de la tour : un surtitre, un titre, et au plus une action. */
export function EnTeteDeLaTour({
  surtitre,
  titre,
  action,
}: {
  surtitre?: ReactNode;
  titre: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {surtitre ? <p className="text-[12px] text-muted-foreground">{surtitre}</p> : null}
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-[30px]">
          {titre}
        </h1>
      </div>
      {action}
    </header>
  );
}

/** Lectures consommées sur le droit du mois : le compte, et une barre fine. */
export function Consommation({ lues, droit }: { lues: number | null; droit: number | null }) {
  const { locale } = useI18n();
  if (lues === null || droit === null) return <span className="num text-muted-foreground">—</span>;
  const n = new Intl.NumberFormat(locale);
  const part = droit > 0 ? Math.min(1, lues / droit) : 0;
  return (
    <span className="inline-flex min-w-[7rem] flex-col gap-1">
      <span className="num text-[12.5px]">
        {n.format(lues)}
        <span className="text-muted-foreground"> / {n.format(droit)}</span>
      </span>
      <span aria-hidden className="h-[3px] w-full bg-muted">
        <span
          className={cn("block h-full", part >= 1 ? "bg-etat-warn" : "bg-foreground")}
          style={{ width: `${part * 100}%` }}
        />
      </span>
    </span>
  );
}
