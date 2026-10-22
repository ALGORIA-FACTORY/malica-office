/**
 * Vocabulaire visuel Malica Office — hérité des maquettes de l'ancien
 * produit, réaligné sur la doctrine Edition One : monochrome, coins nets,
 * élévation par bordures, aucune ombre. La couleur est un signal rare.
 */
import type { ReactNode, ComponentPropsWithoutRef } from "react";
import { Link } from "@tanstack/react-router";

import marqueAlgoria from "@/assets/algoria-mark.svg";
import marqueRg from "@/assets/rg-mark.svg";
import malica from "@/assets/malica.jpeg";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "stop" | "neutral";

/**
 * Employé seulement ici — par `SignalLight` et par la poignée. knip l'a
 * signalé comme export inutile, pas comme code mort : le retirer aurait
 * cassé deux appels internes. On retire donc le mot `export`, pas la
 * fonction.
 */
function SignalDot({ tone = "neutral" }: { tone?: Tone }) {
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

/** Le visage de Malica — le même portrait local dans tous les espaces. */
/**
 * Le visage de Malica.
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
export function MalicaAvatar({
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
      src={malica}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, objectPosition: "center 18%" }}
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
 * La marque ALGORIA.
 *
 * Même mécanique que `MarqueRg`, et pour la même raison : un masque CSS sur
 * `bg-current`, donc un seul fichier teinté par `currentColor`, qui sert le
 * thème clair et le thème sombre. Une balise `img` ne saurait pas s'inverser.
 *
 * Elle est posée à UN endroit — la barre d'application du layout PME, à
 * gauche. La taille vient de la feuille (`.appbar .mk`), pas d'ici : c'est la
 * feuille qui tient le dessin de cette barre, en entier.
 */
export function MarqueAlgoria({ className, ...reste }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...reste}
      className={cn("inline-block bg-current", className)}
      style={{
        maskImage: `url(${marqueAlgoria})`,
        WebkitMaskImage: `url(${marqueAlgoria})`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
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

/**
 * L'en-tête d'un écran du cabinet — un seul, pour tous.
 *
 * Audit du 20 octobre 2026 : vingt-deux en-têtes écrits à la main, en cinq
 * variantes (filet ou non, 30 ou 38 px, surtitre gras ou mono, marigold ou
 * gris). Celui-ci fixe la forme : surtitre, titre, chapeau, actions à droite,
 * contenu dessous (indicateurs, onglets). `ton="encre"` est réservé à
 * l'accueil du cabinet, qui ouvre la journée.
 */
export function EnTeteCabinet({
  surtitre,
  titre,
  chapeau,
  actions,
  retour,
  ton = "papier",
  children,
}: {
  surtitre?: ReactNode;
  titre: ReactNode;
  chapeau?: ReactNode;
  actions?: ReactNode;
  /** Un lien de retour (écran de détail) : rendu à gauche du titre. */
  retour?: ReactNode;
  ton?: "papier" | "encre";
  children?: ReactNode;
}) {
  const encre = ton === "encre";
  return (
    <header
      className={cn(
        encre
          ? "-mx-4 -mt-6 bg-foreground px-4 py-8 text-background sm:-mx-6 sm:px-6 lg:-mx-9 lg:-mt-7 lg:px-10 lg:py-9"
          : "border-b border-foreground pb-6",
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          {retour}
          <div className="min-w-0">
            {surtitre ? (
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.22em]",
                  encre ? "text-marigold-on-ink" : "text-muted-foreground",
                )}
              >
                {surtitre}
              </p>
            ) : null}
            <h1
              className={cn(
                "mt-2.5 font-semibold tracking-[-0.025em]",
                encre
                  ? "text-[32px] leading-[1.02] sm:text-[42px] lg:text-[54px]"
                  : "text-[30px] leading-[1.05] sm:text-[38px]",
              )}
            >
              {titre}
            </h1>
            {chapeau ? (
              <div
                className={cn(
                  "mt-3 max-w-[62ch] text-[13.5px] leading-[1.55]",
                  encre ? "text-background/80" : "text-text-2",
                )}
              >
                {chapeau}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-end gap-3">{actions}</div> : null}
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </header>
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
 * La poignée qui rappelle Malica.
 *
 * C'est son visage, et rien d'autre : on clique sur la personne à qui l'on
 * veut parler. Un bouton « assistant » posé à côté d'elle poserait deux fois
 * la même question.
 */
export function MalicaPoignee({
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
      <MalicaAvatar size={36} alt={nom} />
      <span className="pe-2 text-[11px] font-semibold uppercase tracking-wide">{nom}</span>
    </button>
  );
}

/** Panneau latéral de Malica — elle perçoit, rappelle, propose ; jamais un chiffre sans le Socle. */
export function MalicaPanel({
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
        <MalicaAvatar size={40} alt={title} />
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

/** Bloc de parole dans le panneau : une note bordée, jamais une bulle. */
export function MalicaNote({ kicker, children }: { kicker?: string; children: ReactNode }) {
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

/** Le petit titre en capitales espacées, au-dessus d'un bloc. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </p>
  );
}
