/**
 * Inviter quelqu'un dans son dossier — UN seul geste, depuis le 19 octobre 2026.
 *
 * ================================================================= POURQUOI
 *
 * L'écran des réglages portait TROIS invitations pour la même chose : « Qui
 * entre dans ce dossier » (dirigeant ou collaborateur), « Inviter un siège »
 * sous chaque société, et « Inviter un propriétaire ». Relevé sur l'appareil :
 * trois champs d'adresse, deux vocabulaires (« dirigeant », « propriétaire »),
 * et des chemins qui ne disaient pas la même chose sur le prix.
 *
 * Il n'en reste qu'un, dans les mots des trois rôles décidés le 19 octobre :
 *
 *   `proprietaire` — dirige la société avec le propriétaire principal, sur une
 *                    place payée, sans toucher l'abonnement ;
 *   `utilisateur`  — le quotidien, sur une place.
 *
 * Les deux passent par la porte qui compte les places et ne s'ouvre qu'au
 * propriétaire principal (`proprietaire_inviter`, `siege_inviter`) : la base
 * refuse la place de trop, l'écran montre le refus.
 *
 * ======================================================= PAS DE MOT DE PASSE
 *
 * On n'ouvre pas un compte pour quelqu'un d'autre. L'invitation nomme une
 * ADRESSE ; la personne crée son compte elle-même, et l'invitation
 * l'attend dans son portail. Son mot de passe ne passe par personne.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export function InviterDansMonDossier() {
  const { t } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"proprietaire" | "utilisateur">("utilisateur");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<string | null>(null);

  const invitations = useQuery({
    queryKey: ["invitations-du-dossier", pme.tenantId],
    queryFn: () => office().collab.invitations(pme.tenantId),
  });

  const inviter = useMutation({
    mutationFn: () =>
      role === "proprietaire"
        ? office().facturation.inviterProprietaire(email.trim(), pme.tenantId)
        : office().facturation.inviterSiege(email.trim(), pme.tenantId),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["invitations-du-dossier", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["forfait-sieges"] });
      await qc.invalidateQueries({ queryKey: ["mon-forfait"] });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-dans-mon-dossier", t("common.error")));
    },
  });

  const enAttente = (invitations.data ?? []).filter((i) => !i.acceptedAt);

  return (
    <div className="card">
      <p className="t-body">{t("pme.membres.lede")}</p>

      <div className="mt-2 flex border border-line-strong">
        {(["utilisateur", "proprietaire"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            aria-pressed={r === role}
            className={
              "flex-1 px-2 py-[9px] text-[12.5px] font-medium " +
              (r === role
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground")
            }
          >
            {/*
             * Les clés gardent leur nom d'origine (`dirigeant`,
             * `collaborateur`) ; leurs textes disent désormais les rôles du
             * 19 octobre — propriétaire, utilisateur.
             */}
            {t(
              r === "proprietaire"
                ? "pme.membres.role.dirigeant"
                : "pme.membres.role.collaborateur",
            )}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("pme.membres.adresse")}
          aria-label={t("pme.membres.adresse")}
          className="h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]"
        />
        <button
          type="button"
          className="btn"
          style={{ width: "auto" }}
          onClick={() => inviter.mutate()}
          disabled={inviter.isPending || email.trim().length === 0}
        >
          {t("pme.membres.inviter")}
        </button>
      </div>

      {/*
       * Ce qui s'est passé, dit tout de suite. Une invitation qui part sans
       * un mot laisse croire qu'on a mal cliqué, et on la renvoie trois fois.
       */}
      {erreur ? <p className="warn">{erreur}</p> : null}
      {envoyee ? (
        <p className="t-body" aria-live="polite">
          {t("pme.membres.envoyee", { email: envoyee })}
        </p>
      ) : null}

      {enAttente.length > 0 ? (
        <ul className="mt-3 grid gap-px border border-border bg-border">
          {enAttente.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 bg-card px-3 py-2">
              <span className="min-w-0 truncate text-[13px]">{i.email}</span>
              <span className="shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
                {t("pme.membres.attend")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
