import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { MarqueRg } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/invitation")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Invitation — Malica Office" },
      // Le jeton ne part jamais dans un Referer, même si la page charge une ressource.
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Invitation,
});

/** Le jeton, le temps d'une session d'onglet : il survit à la création d'accès. */
const CLE = "malica.invitation.jeton";

/**
 * Le jeton arrive dans le FRAGMENT (`/invitation#…`) : aucun serveur ne l'a vu.
 * On le range en mémoire de session et on l'efface de la barre d'adresse, pour
 * qu'il ne reste ni dans l'historique ni dans un lien copié par mégarde.
 */
function recupererJeton(): string | null {
  const brut = window.location.hash.replace(/^#/, "");
  if (/^[0-9a-f]{64}$/.test(brut)) {
    try {
      sessionStorage.setItem(CLE, brut);
    } catch {
      // Stockage refusé (navigation privée stricte) : le jeton vit dans la page.
    }
    window.history.replaceState(null, "", window.location.pathname);
    return brut;
  }
  try {
    return sessionStorage.getItem(CLE);
  } catch {
    return null;
  }
}

/**
 * La page que le contact ouvre depuis son lien.
 *
 * Sans session : ce qu'il faut faire, et les deux chemins — créer l'accès ou se
 * connecter —, qui reviennent ici. Avec session : ce qu'on rejoint, pour qui,
 * et un seul bouton. Accepté, le contact arrive dans son espace — vide, avec
 * un seul geste proposé : photographier sa première facture.
 */
function Invitation() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // undefined : pas encore lu. La lecture efface le fragment de l'adresse — un
  // effet de bord qui n'a pas sa place dans le rendu : le routeur réagit à
  // l'historique, et se mettrait à jour en plein rendu de cette page.
  const [jeton, setJeton] = useState<string | null | undefined>(undefined);
  useEffect(() => setJeton(recupererJeton()), []);

  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  const lue = useQuery({
    queryKey: ["invitation-lue"],
    queryFn: () => office().identity.lireInvitationParLien(jeton!),
    enabled: Boolean(jeton && compte.data),
    retry: false,
  });

  const accepter = useMutation({
    mutationFn: () => office().identity.accepterInvitationParLien(jeton!),
    onSuccess: () => {
      try {
        sessionStorage.removeItem(CLE);
      } catch {
        /* rien à ranger */
      }
      void navigate({ to: "/pme", replace: true });
    },
  });

  const deconnecter = useMutation({
    mutationFn: () => office().auth.deconnexion(),
    onSuccess: () => void compte.refetch(),
  });

  // Un jeton absent n'a rien à montrer ici.
  useEffect(() => {
    if (jeton === null && !compte.isLoading && compte.data)
      void navigate({ to: "/office", replace: true });
  }, [jeton, compte.isLoading, compte.data, navigate]);

  const inv = lue.data;
  const adresseDifferente =
    inv && compte.data && inv.email.toLowerCase() !== compte.data.email.toLowerCase();

  // Un lien qui n'ouvre rien ne s'annonce pas « Votre espace est prêt »
  // (ANO-037) : le titre dit ce que le corps dit.
  const introuvable =
    jeton === null || Boolean(compte.data && (lue.isError || (lue.isSuccess && !inv)));
  const lienMort = introuvable || Boolean(inv && !inv.valable);

  let corps: React.ReactNode;
  if (jeton === undefined) {
    corps = <p className="text-[14px] text-[#9A9AA0]">{t("common.loading")}</p>;
  } else if (introuvable) {
    corps = (
      <p className="text-[16px] leading-[1.6] text-[#C7C7CC]">{t("invitation.introuvable")}</p>
    );
  } else if (compte.isLoading || (compte.data && lue.isLoading)) {
    corps = <p className="text-[14px] text-[#9A9AA0]">{t("common.loading")}</p>;
  } else if (!compte.data) {
    corps = (
      <>
        <p className="text-[16px] leading-[1.6] text-[#C7C7CC]">{t("invitation.anonyme")}</p>
        <div className="mt-8 space-y-2">
          <Link
            to="/auth"
            search={{ suite: "/invitation", mode: "signup" }}
            className="flex h-14 w-full items-center justify-center bg-[#FAFAFA] text-[16px] font-semibold text-[#0A0A0A]"
          >
            {t("invitation.creer")}
          </Link>
          <Link
            to="/auth"
            search={{ suite: "/invitation" }}
            className="flex h-12 w-full items-center justify-center text-[15px] font-medium text-[#C7C7CC]"
          >
            {t("invitation.connecter")}
          </Link>
        </div>
      </>
    );
  } else if (inv && !inv.valable) {
    corps = (
      <p className="text-[16px] leading-[1.6] text-[#C7C7CC]">{t("invitation.plusValable")}</p>
    );
  } else if (inv) {
    corps = (
      <>
        <p className="text-[17px] leading-[1.6] text-[#FAFAFA]">
          {t("invitation.dossier", { cabinet: inv.cabinet ?? "—", pme: inv.pme })}
        </p>
        <p className="mt-3 text-[14px] text-[#9A9AA0]">
          {t("invitation.adresse", { email: inv.email })}
        </p>
        {adresseDifferente ? (
          <>
            <p
              role="alert"
              className="mt-6 border border-[#E3B75C] px-3 py-2 text-[14px] text-[#E3B75C]"
            >
              {t("invitation.mauvaiseAdresse", { email: inv.email })}
            </p>
            <button
              type="button"
              onClick={() => deconnecter.mutate()}
              className="mt-4 h-12 w-full border border-[#3A3A3C] text-[15px] font-medium text-[#FAFAFA]"
            >
              {t("invitation.connecter")}
            </button>
          </>
        ) : (
          <>
            {accepter.isError ? (
              <p role="alert" className="mt-6 text-[14px] text-[#E08163]">
                {accepter.error instanceof Error
                  ? accepter.error.message
                  : t("invitation.plusValable")}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => accepter.mutate()}
              disabled={accepter.isPending}
              className="mt-8 h-14 w-full bg-[#FAFAFA] text-[16px] font-semibold text-[#0A0A0A] disabled:opacity-60"
            >
              {t("invitation.rejoindre")}
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <div className="pt-safe relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden bg-[#0A0A0A] text-[#FAFAFA]">
      <MarqueRg
        aria-hidden
        className="pointer-events-none absolute -bottom-[90px] -start-[70px] h-[340px] w-[340px] opacity-[0.08]"
      />
      <main className="relative flex-1 px-[26px] pb-8 pt-9">
        <MarqueRg aria-hidden className="h-[30px] w-[30px]" />
        <p className="mt-11 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#E3B75C]">
          {t("invitation.kicker")}
        </p>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em]">
          {t(lienMort ? "invitation.titreLienMort" : "invitation.titre")}
        </h1>
        <div className="mt-5">{corps}</div>
      </main>
    </div>
  );
}
