import type { Motif, TrafficLight } from "../../contracts/pivot.v1.ts";

/**
 * Règle non négociable : dès qu'un motif de sévérité "block" existe,
 * l'écriture est ROUGE et NE PEUT PAS être approuvée, quel que soit le rôle
 * ou le drapeau BULK_APPROVE. Le blocage vit ici, pas seulement dans l'UI.
 */
export function evaluateTrafficLight(motifs: readonly Motif[]): TrafficLight {
  if (motifs.some((m) => m.severity === "block")) return "ROUGE";
  if (motifs.some((m) => m.severity === "warn")) return "ORANGE";
  return "VERT";
}

export interface ApprovalContext {
  bulk_approve_enabled: boolean;
  is_bulk: boolean;
  approver_role_is_admin: boolean;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason: string;
}

/** Autorise (ou non) l'approbation d'une écriture. Interdit ROUGE inconditionnel. */
export function canApprove(traffic: TrafficLight, ctx: ApprovalContext): ApprovalDecision {
  if (traffic === "ROUGE") {
    return { allowed: false, reason: "traffic_light_red_blocked_by_engine" };
  }
  if (ctx.is_bulk && !ctx.bulk_approve_enabled) {
    return { allowed: false, reason: "bulk_approve_disabled" };
  }
  return { allowed: true, reason: "ok" };
}
