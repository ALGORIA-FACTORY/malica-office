/**
 * Vocabulaire visuel Regalica Office — hérité des maquettes de l'ancien
 * produit, réaligné sur la doctrine Edition One : monochrome, coins nets,
 * élévation par bordures, aucune ombre. La couleur est un signal rare.
 */
import type { ReactNode, ComponentPropsWithoutRef } from "react";
import { Link } from "@tanstack/react-router";

import marqueRg from "@/assets/rg-mark.svg";
import regalica from "@/assets/regalica.jpeg";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "stop" | "neutral";

export function SignalDot({ tone = "neutral" }: { tone?: Tone }) {
  const color =
    tone === "ok"
      ? "bg-signal-ok"
      : tone === "warn"
        ? "bg-signal-warn"
        : tone === "stop"
          ? "bg-signal-stop"
          : "bg-foreground";
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0", color)} />;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Le chiffre : kicker mono, nombre large, contexte discret. */
export function BigNumber({
  kicker,
  value,
  context,
}: {
  kicker: string;
  value: string;
  context?: string;
}) {
  return (
    <div>
      <p className="num text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{kicker}</p>
      <p className="num mt-1 text-[44px] font-medium leading-none tracking-tight">{value}</p>
      {context ? <p className="mt-2 text-[13px] text-muted-foreground">{context}</p> : null}
    </div>
  );
}

/** Card primaire pleine encre — une seule par écran. */
export function InkCard({
  to,
  label,
  state,
  onClick,
}: {
  to?: string;
  label: string;
  state?: string;
  onClick?: () => void;
}) {
  const inner = (
    <div className="border border-foreground bg-foreground px-4 py-5 text-background">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-xs text-background/70">{state || "\u00A0"}</p>
    </div>
  );
  if (to) {
    return (
      <Link to={to} className="block">
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="block w-full text-start">
      {inner}
    </button>
  );
}

/** Card pierre — bordure, jamais d'ombre, jamais de chevron. */
export function StoneCard({
  to,
  label,
  state,
  disabled,
}: {
  to?: string;
  label: string;
  state?: string;
  disabled?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "flex h-full min-h-[86px] flex-col justify-between border border-border bg-card px-4 py-4",
        disabled ? "opacity-60" : "hover:bg-accent",
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{state || "\u00A0"}</p>
    </div>
  );
  if (to && !disabled) {
    return (
      <Link to={to} className="block">
        {inner}
      </Link>
    );
  }
  return <div aria-disabled={disabled}>{inner}</div>;
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

export type StepState = "done" | "current" | "pending";

/** Timeline verticale d'une pièce — capturée → lue → comptabilisée. */
export function Timeline({
  steps,
}: {
  steps: Array<{ key: string; label: string; state: StepState }>;
}) {
  return (
    <ol className="relative ms-1 mt-3">
      <span
        aria-hidden
        className="absolute bottom-1.5 top-1.5 w-px bg-border"
        style={{ insetInlineStart: "5px" }}
      />
      {steps.map((s) => (
        <li key={s.key} className="relative py-1" style={{ paddingInlineStart: "22px" }}>
          <span
            aria-hidden
            className={cn(
              "absolute top-[9px] h-[11px] w-[11px] border",
              s.state === "done"
                ? "border-foreground bg-foreground"
                : s.state === "current"
                  ? "border-foreground bg-background"
                  : "border-border bg-background",
            )}
            style={{ insetInlineStart: 0 }}
          />
          <span
            className={cn(
              "text-[11px]",
              s.state === "pending" ? "text-muted-foreground" : "font-medium text-foreground",
            )}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Le visage de Regalica — image en niveaux de gris, coins nets, bordure seule. */
/**
 * Le visage de Regalica.
 *
 * L'''image vit dans le dépôt, importée par Vite : elle est empreintée, servie
 * avec le reste du bundle, et ne dépend d'''aucun hébergeur.
 *
 * Ce n'''était pas le cas avant : un fichier JSON pointait vers le CDN du
 * fournisseur précédent, et le jour où nous sommes partis il a rendu 404 : le
 * panneau affichait le texte de remplacement. Le garde-fou de sortie ne pouvait
 * pas le voir — le nom du fournisseur n'''apparaissait nulle part dans le fichier,
 * seulement dans un chemin d'''URL opaque.
 */
export function RegalicaAvatar({
  size = 36,
  alt,
  className,
  rond,
}: {
  size?: number;
  alt: string;
  className?: string;
  /**
   * Le portrait rond, cerclé de marigold — la forme de l'accueil PME.
   *
   * Le cadrage `center 18%` n'est pas cosmétique : la photo est en pied, et
   * un recadrage centré rendrait un buste sans visage à 26 px.
   */
  rond?: boolean;
}) {
  return (
    <img
      src={regalica}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, ...(rond ? { objectPosition: "center 18%" } : null) }}
      className={cn(
        "shrink-0 object-cover",
        rond ? "rounded-full border-2 border-marigold" : "border border-border",
        className,
      )}
    />
  );
}

/**
 * Le sigle RG.
 *
 * Il sert à deux échelles opposées : dix-neuf pixels dans le bandeau de
 * présence, deux cent trente-huit en filigrane de masthead. C'est le même
 * fichier, teinté par `currentColor` — d'où le masque plutôt qu'une balise
 * `img`, qui ne saurait pas s'inverser en thème sombre.
 */
export function MarqueRg({ className, ...reste }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...reste}
      className={cn("inline-block bg-current", className)}
      style={{
        maskImage: `url(${marqueRg})`,
        WebkitMaskImage: `url(${marqueRg})`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}

/**
 * La parole de Regalica — visage + salutation + phrase de cadrage.
 *
 * Si `onVisage` est fourni, son visage devient cliquable : c'est ainsi qu'on
 * lui adresse la parole. Sans lui, l'image reste une image, et rien ne laisse
 * croire à une porte qui n'existe pas.
 */
export function RegalicaVoice({
  greeting,
  sentence,
  amount,
  avatarAlt = "Regalica",
  onVisage,
  visageLibelle,
}: {
  greeting: string;
  sentence: string;
  amount?: string | null;
  avatarAlt?: string;
  onVisage?: () => void;
  visageLibelle?: string;
}) {
  return (
    <section className="flex items-start gap-3">
      {onVisage ? (
        <button
          type="button"
          onClick={onVisage}
          title={visageLibelle}
          aria-label={visageLibelle}
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          <RegalicaAvatar size={36} alt={avatarAlt} />
        </button>
      ) : (
        <RegalicaAvatar size={36} alt={avatarAlt} />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[19px] font-medium leading-snug tracking-tight">{greeting}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
          {sentence}
          {amount ? <span className="num ms-1 font-medium text-foreground">{amount}</span> : null}
        </p>
      </div>
    </section>
  );
}

/** Feu de conformité — le verdict porte la justification, le feu la signale. */
export function SignalLight({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <SignalDot tone={tone} />
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
    </span>
  );
}

/** Titre de section — filet supérieur, jamais d'ombre. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">{children}</h2>
      {action}
    </div>
  );
}

/**
 * Section repliable — même filet, même titre, un état en plus.
 *
 * Les longues listes du paramétrage — cent soixante rôles, six cent vingt-six
 * comptes — se replient pour laisser voir la structure de la page. Le compteur
 * reste visible replié : on doit savoir ce qu'''on cache.
 *
 * Le bouton porte le titre lui-même plutôt qu'''un chevron seul : c'''est la cible
 * la plus large, et elle se lit au clavier comme à la souris.
 */
export function SectionRepliable({
  titre,
  ouvert,
  onBascule,
  resume,
  children,
}: {
  titre: ReactNode;
  ouvert: boolean;
  onBascule: () => void;
  resume?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <button
          type="button"
          onClick={onBascule}
          aria-expanded={ouvert}
          className="flex min-h-[36px] items-baseline gap-2 text-start text-[13px] font-semibold uppercase tracking-[0.16em]"
        >
          <span aria-hidden className="text-[11px] opacity-60">
            {ouvert ? "−" : "+"}
          </span>
          {titre}
        </button>
        {resume ? <span className="text-[12px] text-muted-foreground">{resume}</span> : null}
      </div>
      {ouvert ? children : null}
    </section>
  );
}

/** Bandeau de chiffres gouvernés — chaque valeur vient du Socle. */
export function KpiRow({
  items,
}: {
  items: Array<{ key: string; label: string; value: string; context?: string }>;
}) {
  return (
    <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="bg-card px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {item.label}
          </p>
          <p className="num mt-2 text-[26px] font-medium leading-none tracking-tight">
            {item.value}
          </p>
          {item.context ? (
            <p className="mt-2 text-[11px] text-muted-foreground">{item.context}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Table d'encre — filets, chiffres en mono, aucune zébrure colorée. */
export function InkTable({
  head,
  children,
  caption,
}: {
  head: ReactNode[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="min-w-full border-collapse text-[13px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border">
            {head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="px-3 py-2 text-start text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function InkTableRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border last:border-b-0">{children}</tr>;
}

export function InkCell({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "max-w-[18rem] px-3 py-2 align-top break-words",
        numeric && "num whitespace-nowrap text-end",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Vide assumé : une phrase, pas une illustration. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="border border-border bg-card px-4 py-6 text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * La poignée qui rappelle Regalica.
 *
 * C'est son visage, et rien d'autre : on clique sur la personne à qui l'on
 * veut parler. Un bouton « assistant » posé à côté d'elle poserait deux fois
 * la même question.
 */
export function RegalicaPoignee({
  nom,
  onOuvrir,
  libelle,
  className,
}: {
  nom: string;
  onOuvrir: () => void;
  libelle: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOuvrir}
      title={libelle}
      aria-label={libelle}
      className={cn(
        "z-30 flex items-center gap-2 border border-border bg-card p-1 shadow-sm transition-colors hover:bg-accent",
        className,
      )}
    >
      <RegalicaAvatar size={36} alt={nom} />
      <span className="pe-2 text-[11px] font-semibold uppercase tracking-wide">{nom}</span>
    </button>
  );
}

/** Panneau latéral de Regalica — elle perçoit, rappelle, propose ; jamais un chiffre sans le Socle. */
export function RegalicaPanel({
  title,
  status,
  ask,
  footer,
  children,
  framed = true,
  onFermer,
  fermerLibelle,
}: {
  title: string;
  status?: string;
  ask?: string;
  /** Fil de conversation réel — remplace la barre d'invite décorative. */
  footer?: ReactNode;
  children: ReactNode;
  framed?: boolean;
  /** Absent : le panneau ne se ferme pas. */
  onFermer?: () => void;
  fermerLibelle?: string;
}) {
  return (
    <aside className={cn("flex h-full flex-col bg-card", framed && "border-s border-border")}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <RegalicaAvatar size={40} alt={title} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-tight">{title}</p>
          {status ? (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <SignalDot tone="ok" />
              {status}
            </p>
          ) : null}
        </div>
        {onFermer ? (
          <button
            type="button"
            onClick={onFermer}
            aria-label={fermerLibelle ?? "Fermer"}
            title={fermerLibelle ?? "Fermer"}
            className="shrink-0 border border-border px-2 py-0.5 text-[15px] leading-tight text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px] leading-relaxed">
        {children}
      </div>
      {footer ? (
        <div className="border-t border-border px-4 py-3">{footer}</div>
      ) : ask ? (
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between border border-border px-3 py-2 text-[12px] text-muted-foreground">
            <span>{ask}</span>
            <span aria-hidden>→</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

/** Liste d'agents au travail — état factuel, jamais un chiffre inventé. */
export function AgentList({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; state: string; tone?: Tone }>;
}) {
  return (
    <div>
      <p className="pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-3">
            <span className="flex items-baseline gap-2 text-[13px]">
              <SignalDot tone={item.tone ?? "ok"} />
              {item.label}
            </span>
            <span className="text-[11px] text-muted-foreground">{item.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cartes de chiffres autonomes — filets séparés, comme la maquette. */
export function StatCards({
  items,
}: {
  items: Array<{ key: string; label: string; value: string; tone?: Tone }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="border border-border bg-card px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {item.label}
          </p>
          <p
            className={cn(
              "num mt-3 text-[34px] font-medium leading-none tracking-tight",
              item.tone === "ok" && "text-signal-ok",
              item.tone === "warn" && "text-signal-warn",
              item.tone === "stop" && "text-signal-stop",
            )}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Bloc de parole dans le panneau : une note bordée, jamais une bulle. */
export function RegalicaNote({ kicker, children }: { kicker?: string; children: ReactNode }) {
  return (
    <div className="border border-border px-3 py-3">
      {kicker ? <Eyebrow>{kicker}</Eyebrow> : null}
      <div className={cn("text-[13px] leading-relaxed", kicker && "mt-1")}>{children}</div>
    </div>
  );
}

/** Barre d'actions collée en bas de la colonne de travail. */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3">
      {children}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  variant = "stone",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ink" | "stone";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50",
        variant === "ink"
          ? "border-foreground bg-foreground text-background hover:bg-background hover:text-foreground"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
