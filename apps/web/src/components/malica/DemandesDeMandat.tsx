/**
 * Les demandes de mandat que des sociétés adressent à CETTE comptabilité.
 *
 * ============================================================== POURQUOI
 *
 * Une société invite sa comptabilité par e-mail (7.1) : c'est une ligne
 * d'invitation, pas un engagement. La liste des clients ne lit que les
 * engagements, et seul le portail (/office) montrait l'invitation — une
 * comptabilité qui venait de se créer arrivait sur un écran vide, sans voir la
 * demande qui l'attendait (recette du 13 novembre 2026, A2).
 *
 * La carte vit donc dans les Clients et au tableau de bord. Accepter active le
 * mandat AVEC cette comptabilité (`accepterInvitationDeLaSociete`) ; refuser
 * expire l'invitation. La base refait le contrôle : seul l'expert de la
 * comptabilité accepte, et l'écran le dit plutôt que de proposer un bouton qui
 * échouerait.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useMonAcces } from "@/hooks/use-mon-acces";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export function DemandesDeMandat({ cabinetId }: { cabinetId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const acces = useMonAcces(cabinetId);
  const expert = acces.data?.role === "expert";

  // La même clé que le portail : accepter ici met aussi le portail à jour.
  const invitations = useQuery({
    queryKey: ["invitations-pour-moi"],
    queryFn: () => office().collab.invitationsPourMoi(),
  });
  const demandes = (invitations.data ?? []).filter((i) => i.kind === "pme" && i.role === "expert");

  const repondre = useMutation({
    mutationFn: async (input: { id: string; pme: string; accepte: boolean }) => {
      if (input.accepte) {
        await office().identity.accepterInvitationDeLaSociete({
          jeton: null,
          invitationId: input.id,
          cabinetTenantId: cabinetId,
        });
        return;
      }
      await office().collab.repondreAInvitation(input.id, false);
    },
    onSuccess: async (_r, input) => {
      setErreur(null);
      setMessage(
        input.accepte ? t("cab.demandes.accepte", { pme: input.pme }) : t("cab.demandes.refusee"),
      );
      // Un mandat vient de naître, ou une demande de tomber : tout se relit.
      await qc.invalidateQueries();
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/DemandesDeMandat", t("cab.demandes.erreur"))),
  });

  if (demandes.length === 0 && !message && !erreur) return null;

  return (
    <section
      aria-labelledby="demandes-de-mandat"
      className="border border-s-2 border-border border-s-marigold bg-card p-5"
    >
      <h2
        id="demandes-de-mandat"
        className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
      >
        {t("cab.demandes.titre")}
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {demandes.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="min-w-0 text-[14px]">
              {t("invitation.comptabilite", { pme: d.cabinet })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={repondre.isPending || !expert}
                onClick={() => repondre.mutate({ id: d.id, pme: d.cabinet, accepte: true })}
                className="min-h-[44px] border border-foreground bg-foreground px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-background disabled:opacity-40"
              >
                {t("cab.demandes.accepter")}
              </button>
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ id: d.id, pme: d.cabinet, accepte: false })}
                className="min-h-[44px] border border-border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
              >
                {t("cab.demandes.refuser")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {demandes.length > 0 && acces.isSuccess && !expert ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">{t("cab.demandes.reserve")}</p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 text-[12.5px] text-signal-ok">
          {message}
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
