/**
 * La pièce « en vérification » : la relecture ciblée de ses cases de montant tourne en
 * arrière-plan (décision du dirigeant, 8 novembre 2026), et son issue arrive quelques
 * secondes plus tard — vérifiée, ou la case précise à vérifier.
 *
 * Rien ne s'affiche quand aucune vérification n'a été demandée : pas d'alarme sans fait.
 * Tant qu'elle tourne, l'écran redemande au rythme commun (`SUIVI_DE_LECTURE_MS`) ; quand
 * elle se termine, la pièce se relit — une vérification prouvée est une lecture nouvelle.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { VerificationDeLaPiece as Verification } from "@malica/socle/ports/malica";

import { SignalLight } from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { SUIVI_DE_LECTURE_MS } from "@/lib/lecture";
import { office } from "@/verticals/malica-office/composition";

const POSITIONS = new Set([
  "haut_gauche",
  "haut_centre",
  "haut_droite",
  "milieu_gauche",
  "milieu_centre",
  "milieu_droite",
  "bas_gauche",
  "bas_centre",
  "bas_droite",
]);

/** Le message d'une vérification terminée, ou `null` quand il n'y a rien à dire. */
function messageDeVerification(v: Verification): {
  ton: "ok" | "warn";
  cle: MessageKey;
  kase: { texte: string; libelle: string | null; position: string } | null;
} | null {
  if (v.etat === "en_verification")
    return { ton: "warn", cle: "pme.verification.enCours", kase: null };
  const kase = v.detail?.kase && POSITIONS.has(v.detail.kase.position) ? v.detail.kase : null;
  if (v.motif === "verification.prouvee")
    return { ton: "ok", cle: "pme.verification.prouvee", kase: null };
  if (v.motif === "verification.non_prouvee") {
    return {
      ton: "warn",
      cle:
        v.detail?.code === "case_illisible" && kase
          ? "pme.verification.caseIllisible"
          : "pme.verification.neFermePas",
      kase,
    };
  }
  if (v.motif?.startsWith("verification.non_relue.")) {
    return { ton: "warn", cle: "pme.verification.nonRelue", kase: null };
  }
  return null;
}

export function VerificationDeLaPiece({ pieceId }: { pieceId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const etat = useQuery({
    queryKey: ["verification", pieceId],
    queryFn: () => office().malica.etatDeLecture(pieceId),
    refetchInterval: (q) =>
      q.state.data?.verification?.etat === "en_verification" ? SUIVI_DE_LECTURE_MS : false,
  });
  const v = etat.data?.verification ?? null;
  const avant = useRef<string | null>(null);
  useEffect(() => {
    const maintenant = v?.etat ?? null;
    if (avant.current === "en_verification" && maintenant === "terminee") {
      void qc.invalidateQueries({ queryKey: ["piece", pieceId] });
      void qc.invalidateQueries({ queryKey: ["lecture-observee", pieceId] });
    }
    avant.current = maintenant;
  }, [v?.etat, qc, pieceId]);
  if (!v) return null;
  const m = messageDeVerification(v);
  if (!m) return null;
  const texte = t(m.cle, {
    case: m.kase ? (m.kase.libelle ?? m.kase.texte) : "",
    position: m.kase ? t(`pme.verification.position.${m.kase.position}` as MessageKey) : "",
  });
  return (
    <div className="mt-4 border border-border bg-card p-4" role="status" aria-live="polite">
      <SignalLight tone={m.ton} label={texte} />
    </div>
  );
}
