/**
 * Inviter quelqu'un dans l'équipe de la comptabilité, sur place, dans
 * Réglages · Équipe et accès. L'écran « Mise en route » qui portait ce
 * formulaire est retiré (8 novembre 2026) : le geste vit ici, une fois.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useCabinet } from "@/components/malica/cabinet-context";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

const ROLES_INVITABLES = ["collaborateur", "expert", "assistant"] as const;
const ROLES: Record<(typeof ROLES_INVITABLES)[number], MessageKey> = {
  expert: "cab.onb.role.expert",
  collaborateur: "cab.onb.role.collaborateur",
  assistant: "cab.onb.role.assistant",
};
const CHAMP =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function InviterLEquipe({ fermer }: { fermer?: () => void }) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES_INVITABLES)[number]>("collaborateur");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const inviter = useMutation({
    mutationFn: () => office().collab.inviter({ tenantId: org.id, email: email.trim(), role }),
    onSuccess: async (r) => {
      setErreur(null);
      setMessage(t(r.deja ? "cab.onb.2.deja" : "cab.onb.2.invitee", { email: r.email }));
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["cab-invitations", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-l-equipe", t("common.error")));
    },
  });

  return (
    <form
      className="cab-entre space-y-2 rounded-xl border border-[#c9e2d3] bg-[#f6fbf8] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() && !inviter.isPending) inviter.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_auto]">
        <label className="block">
          <span className="sr-only">{t("cab.onb.2.email")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={t("cab.onb.2.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={CHAMP}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="sr-only">{t("cab.onb.2.role")}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES_INVITABLES)[number])}
            className={CHAMP}
          >
            {ROLES_INVITABLES.map((r) => (
              <option key={r} value={r}>
                {t(ROLES[r])}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={inviter.isPending || !email.trim()}
          className="cab-button cab-button-primary"
        >
          {t("cab.onb.2.inviter")}
        </button>
      </div>
      <p className="text-[11.5px] text-muted-foreground">{t("cab.onb.2.email.hint")}</p>
      {message ? (
        <p role="status" className="text-[12.5px] text-signal-ok">
          {message}
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
      {fermer ? (
        <button
          type="button"
          onClick={fermer}
          className="text-[12px] text-muted-foreground hover:underline"
        >
          {t("cab.cli.fermer")}
        </button>
      ) : null}
    </form>
  );
}
