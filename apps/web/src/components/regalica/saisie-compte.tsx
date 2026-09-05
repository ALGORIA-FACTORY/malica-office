import { useId } from "react";

import type { CompteDuPlan } from "@regalica/socle/ports/repositories";
import { cn } from "@/lib/utils";

/**
 * Le plan, offert une fois pour tout un écran.
 *
 * La liste ne porte que le CODE en valeur : un navigateur qui complète y écrit
 * ce qu'il voit, et le libellé n'a rien à faire dans le champ — il s'affiche
 * dessous, importé du plan.
 */
export function ListeDesComptes({ id, plan }: { id: string; plan: readonly CompteDuPlan[] }) {
  return (
    <datalist id={id}>
      {plan.map((c) => (
        <option key={c.code} value={c.code}>
          {c.libelle}
        </option>
      ))}
    </datalist>
  );
}

/**
 * Saisir un compte, et voir immédiatement ce qu'il est.
 *
 * ================================================== POURQUOI ON TAPE UN NUMÉRO
 *
 * Un expert-comptable connaît ses comptes par cœur : il tape 6111, il ne
 * déroule pas six cent vingt-six lignes. La liste existe quand même — en
 * `datalist`, c'est-à-dire proposée sans jamais bloquer la frappe. On ne
 * remplace pas un geste rapide par un geste lent au prétexte d'aider.
 *
 * ============================================ LE LIBELLÉ NE SE SAISIT JAMAIS
 *
 * Il s'importe du plan : officiel (verbatim NC 01), extension livrée par
 * Regalica, ou compte du cabinet. Un libellé recopié à la main diverge de la
 * balance dès la première faute de frappe, et c'est cette divergence que les
 * revues relèvent. Ici il est affiché, pas éditable.
 *
 * Un code hors du plan reste TAPABLE : l'écran n'est pas juge. Il dit ce
 * qu'il voit — « inconnu du plan » —, et la base refuse s'il faut refuser.
 * Un écran se contourne, un déclencheur non.
 */
export function SaisieDeCompte({
  valeur,
  onChange,
  plan,
  label,
  inconnuLabel,
  originesLabels,
  collectifLabel,
  listeId,
  disabled,
  className,
}: {
  valeur: string;
  onChange: (code: string) => void;
  plan: readonly CompteDuPlan[];
  label: string;
  /** Ce qu'on dit d'un code que le plan ne connaît pas. */
  inconnuLabel: string;
  originesLabels: Record<CompteDuPlan["origine"], string>;
  /** Un collectif reçoit des tiers : l'écran le signale avant l'erreur. */
  collectifLabel: string;
  /** L'id d'une `ListeDesComptes` rendue une fois pour l'écran. */
  listeId: string;
  disabled?: boolean;
  className?: string;
}) {
  const decrit = useId();
  const code = valeur.trim();
  const compte = code ? (plan.find((c) => c.code === code) ?? null) : null;

  return (
    <div className={cn("min-w-0", className)}>
      <input
        type="text"
        inputMode="numeric"
        value={valeur}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        list={listeId}
        aria-label={label}
        aria-describedby={decrit}
        className="num w-full border border-border bg-background px-2 py-1 text-[13px] disabled:opacity-60"
      />
      <p
        id={decrit}
        className={cn(
          "mt-1 text-[11px] leading-snug",
          compte ? "text-muted-foreground" : code ? "text-signal-warn" : "text-muted-foreground",
        )}
      >
        {compte ? (
          <>
            {compte.libelle}
            <span className="ms-2 uppercase tracking-wide opacity-70">
              {originesLabels[compte.origine]}
            </span>
            {compte.collectif ? (
              <span className="ms-2 uppercase tracking-wide text-signal-warn">
                {collectifLabel}
              </span>
            ) : null}
          </>
        ) : code ? (
          inconnuLabel
        ) : (
          "\u00a0"
        )}
      </p>
    </div>
  );
}
