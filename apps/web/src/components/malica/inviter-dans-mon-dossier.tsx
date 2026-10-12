/**
 * Inviter quelqu'un dans son dossier — le pendant PME de l'écran du cabinet.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « je veux donner les accès à Mondher Chaouech dans
 * l'application PME et cabinet avec tous les accès ».
 *
 * Le cabinet savait inviter quelqu'un depuis sa mise en route. La PME, non :
 * un dossier n'avait qu'un seul membre, celui qui l'avait créé, et aucun
 * écran n'en ajoutait un second. Un dirigeant ne pouvait donc ni associer
 * son comptable à son propre espace, ni préparer sa succession, ni même
 * donner accès à son associé.
 *
 * La fonction du Socle, elle, n'a jamais été réservée aux cabinets : elle
 * invite dans N'IMPORTE QUEL dossier, et la politique de la base exige déjà
 * d'en être dirigeant ou expert. Encore un outil juste que personne
 * n'appelait — c'est le motif récurrent de ce dépôt.
 *
 * ======================================================= PAS DE MOT DE PASSE
 *
 * On n'ouvre pas un compte pour quelqu'un d'autre. L'invitation nomme une
 * ADRESSE ; la personne crée son compte elle-même, et l'invitation
 * l'attend dans son portail. Son mot de passe ne passe par personne.
 *
 * ================================================ CE QUE CHAQUE RÔLE DONNE
 *
 * `dirigeant` — tout, y compris accepter ou refuser un mandat de cabinet.
 * `collaborateur` — le quotidien, sans les décisions d'engagement.
 *
 * Les deux autres rôles du référentiel, `expert` et `assistant`, décrivent
 * un cabinet et ne sont pas proposés ici : les offrir dans un dossier de PME
 * ferait choisir entre quatre mots dont deux ne veulent rien dire à cet
 * endroit.
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
  const [role, setRole] = useState<"dirigeant" | "collaborateur">("dirigeant");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<string | null>(null);

  const invitations = useQuery({
    queryKey: ["invitations-du-dossier", pme.tenantId],
    queryFn: () => office().collab.invitations(pme.tenantId),
  });

  const inviter = useMutation({
    mutationFn: () =>
      office().collab.inviter({ tenantId: pme.tenantId, email: email.trim(), role }),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["invitations-du-dossier", pme.tenantId] });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-dans-mon-dossier", t("common.error")));
    },
  });

  const enAttente = (invitations.data ?? []).filter((i) => !i.acceptedAt);

  return (
    <>
      <p className="mb-2 mt-7 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("pme.membres.titre")}
      </p>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-text-2">{t("pme.membres.lede")}</p>

      <div className="flex border border-line-strong">
        {(["dirigeant", "collaborateur"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            aria-pressed={r === role}
            className={
              "flex-1 py-[9px] text-[12.5px] font-medium " +
              (r === role
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground")
            }
          >
            {t(r === "dirigeant" ? "pme.membres.role.dirigeant" : "pme.membres.role.collaborateur")}
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
          className="h-[46px] min-w-0 flex-1 border border-border bg-background px-3 text-[14px]"
        />
        <button
          type="button"
          onClick={() => inviter.mutate()}
          disabled={inviter.isPending || email.trim().length === 0}
          className="h-[46px] bg-foreground px-4 text-[14px] font-medium text-background disabled:opacity-40"
        >
          {t("pme.membres.inviter")}
        </button>
      </div>

      {/*
       * Ce qui s'est passé, dit tout de suite. Une invitation qui part sans
       * un mot laisse croire qu'on a mal cliqué, et on la renvoie trois fois.
       */}
      {erreur ? <p className="mt-2 text-[12.5px] text-signal-warn">{erreur}</p> : null}
      {envoyee ? (
        <p className="mt-2 text-[12.5px] text-signal-ok">
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
    </>
  );
}
