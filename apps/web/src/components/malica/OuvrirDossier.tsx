/**
 * Le cabinet ouvre le dossier d'une PME qui n'existe pas encore, puis invite
 * son contact.
 *
 * Deux temps, dans le même panneau : le dossier (raison sociale, matricule
 * fiscal, adresse — les mentions de facturation), puis le contact. Le lien
 * s'affiche UNE fois, au moment où il est émis : la base n'en garde que
 * l'empreinte, il ne se relit pas. Le cabinet le transmet lui-même ; l'état
 * de chaque invitation se lit ensuite, et une invitation en attente se révoque.
 *
 * Le jeton est dans le fragment du lien (`/invitation#…`) : il ne part jamais
 * vers un serveur, ni dans un journal d'accès.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { StatutInvitation } from "@malica/socle/ports/repositories";

const STATUTS: Record<StatutInvitation, MessageKey> = {
  en_attente: "cab.dossier.statut.en_attente",
  acceptee: "cab.dossier.statut.acceptee",
  expiree: "cab.dossier.statut.expiree",
  revoquee: "cab.dossier.statut.revoquee",
};

export function OuvrirDossier({ cabinetId }: { cabinetId: string }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");
  const [mf, setMf] = useState("");
  const [adresse, setAdresse] = useState("");
  const [email, setEmail] = useState("");
  const [dossier, setDossier] = useState<{ id: string; name: string } | null>(null);
  const [lien, setLien] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const ouvrir = useMutation({
    mutationFn: () =>
      office().identity.ouvrirDossier({
        cabinetTenantId: cabinetId,
        name: nom.trim(),
        legalId: mf.trim(),
        adresse: adresse.trim() || null,
      }),
    onSuccess: (d) => {
      setDossier({ id: d.id, name: d.name });
      void client.invalidateQueries({ queryKey: ["cab-clients", cabinetId] });
    },
  });

  const invitations = useQuery({
    queryKey: ["dossier-invitations", dossier?.id],
    queryFn: () => office().identity.invitationsDuDossier(dossier!.id),
    enabled: Boolean(dossier),
  });

  const inviter = useMutation({
    mutationFn: () => office().identity.inviterContact(dossier!.id, email.trim()),
    onSuccess: (r) => {
      setCopie(false);
      setLien(r.lien ?? `${window.location.origin}/invitation#${r.jeton}`);
      void invitations.refetch();
    },
  });

  const revoquer = useMutation({
    mutationFn: (id: string) => office().identity.revoquerInvitation(id),
    onSuccess: () => {
      setLien(null);
      void invitations.refetch();
    },
  });

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="border border-foreground bg-foreground px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-background hover:text-foreground"
      >
        {t("cab.dossier.ouvrir")}
      </button>
    );
  }

  const erreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

  return (
    <section
      aria-labelledby="ouvrir-dossier-titre"
      className="space-y-5 border border-border bg-card px-5 py-5"
    >
      <h2 id="ouvrir-dossier-titre" className="text-[18px] font-semibold tracking-[-0.01em]">
        {dossier ? dossier.name : t("cab.dossier.titre")}
      </h2>

      {!dossier ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            ouvrir.mutate();
          }}
        >
          <Champ label={t("cab.dossier.nom")} value={nom} onChange={setNom} required />
          <Champ label={t("cab.dossier.mf")} value={mf} onChange={setMf} required />
          <div className="sm:col-span-2">
            <Champ label={t("cab.dossier.adresse")} value={adresse} onChange={setAdresse} />
          </div>
          {ouvrir.isError ? <Erreur>{erreur(ouvrir.error)}</Erreur> : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={ouvrir.isPending}
              className="bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
            >
              {t("cab.dossier.valider")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-[13.5px] text-text-2">{t("cab.dossier.ouvert")}</p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              inviter.mutate();
            }}
          >
            <div className="min-w-[260px] flex-1">
              <Champ
                label={t("cab.dossier.contact")}
                value={email}
                onChange={setEmail}
                type="email"
                required
              />
            </div>
            <button
              type="submit"
              disabled={inviter.isPending}
              className="bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
            >
              {t("cab.dossier.inviter")}
            </button>
          </form>
          {inviter.isError ? <Erreur>{erreur(inviter.error)}</Erreur> : null}

          {lien ? (
            <div className="space-y-2 border border-marigold px-4 py-3">
              <p className="text-[12.5px] font-semibold">{t("cab.dossier.lien.titre")}</p>
              <p className="text-[12.5px] text-text-2">{t("cab.dossier.lien.aide")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all bg-background px-2 py-1.5 text-[12px]">
                  {lien}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(lien).then(() => setCopie(true));
                  }}
                  className="border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent"
                >
                  {copie ? t("cab.dossier.lien.copie") : t("cab.dossier.lien.copier")}
                </button>
              </div>
            </div>
          ) : null}

          {(invitations.data ?? []).length > 0 ? (
            <ul
              aria-label={t("cab.dossier.invitations")}
              className="divide-y divide-border border-y border-border"
            >
              {(invitations.data ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 break-all">{i.email}</span>
                  <span
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.12em]",
                      i.statut === "en_attente" && "text-marigold",
                      i.statut === "acceptee" && "text-signal-ok",
                      (i.statut === "expiree" || i.statut === "revoquee") &&
                        "text-muted-foreground",
                    )}
                  >
                    {t(STATUTS[i.statut])}
                  </span>
                  {i.statut === "en_attente" ? (
                    <button
                      type="button"
                      onClick={() => revoquer.mutate(i.id)}
                      disabled={revoquer.isPending}
                      className="border border-border px-2.5 py-1 text-[12px] hover:bg-accent"
                    >
                      {t("cab.dossier.revoquer")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function Champ({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-input bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground"
      />
    </label>
  );
}

function Erreur({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="border border-signal-stop px-3 py-2 text-[12.5px] text-signal-stop sm:col-span-2"
    >
      {children}
    </p>
  );
}
