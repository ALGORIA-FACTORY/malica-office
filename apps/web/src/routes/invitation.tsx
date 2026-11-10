import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CadreConnexion } from "@/components/malica/cadre-connexion";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/invitation")({
  ssr: false,
  // Rendue sur l'appareil : le serveur n'en peint que l'attente, et le routeur
  // la retenait 500 ms de plus après l'hydratation (son minimum anti-
  // clignotement), avant même de demander la session. Voir `_authenticated/route.tsx`.
  pendingMinMs: 0,
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
    corps = <p className="cx-sub">{t("common.loading")}</p>;
  } else if (introuvable) {
    corps = <p className="cx-sub">{t("invitation.introuvable")}</p>;
  } else if (compte.isLoading || (compte.data && lue.isLoading)) {
    corps = <p className="cx-sub">{t("common.loading")}</p>;
  } else if (!compte.data) {
    corps = (
      <>
        <p className="cx-sub">{t("invitation.anonyme")}</p>
        <div className="cx-stack">
          <Link to="/auth" search={{ suite: "/invitation", mode: "signup" }} className="cx-submit">
            {t("invitation.creer")}
          </Link>
          <Link to="/auth" search={{ suite: "/invitation" }} className="cx-secondary">
            {t("invitation.connecter")}
          </Link>
        </div>
      </>
    );
  } else if (inv && !inv.valable) {
    corps = <p className="cx-sub">{t("invitation.plusValable")}</p>;
  } else if (inv) {
    corps = (
      <>
        <p className="cx-sub">
          {t("invitation.dossier", { cabinet: inv.cabinet ?? "—", pme: inv.pme })}
        </p>
        <p className="cx-sub">{t("invitation.adresse", { email: inv.email })}</p>
        {adresseDifferente ? (
          <>
            <p role="alert" className="cx-alert">
              {t("invitation.mauvaiseAdresse", { email: inv.email })}
            </p>
            <button type="button" onClick={() => deconnecter.mutate()} className="cx-secondary">
              {t("invitation.connecter")}
            </button>
          </>
        ) : (
          <>
            {accepter.isError ? (
              <p role="alert" className="cx-msg cx-err">
                {texteDeLErreur(accepter.error, "invitation : accepter", t("common.error"))}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => accepter.mutate()}
              disabled={accepter.isPending}
              aria-busy={accepter.isPending}
              className="cx-submit"
            >
              <span className="cx-fill" aria-hidden="true" />
              <span className="cx-label">{t("invitation.rejoindre")}</span>
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <CadreConnexion>
      <div className="cx-form">
        <div className="cx-head">
          <p className="cx-kicker">{t("invitation.kicker")}</p>
          <h1 className="cx-title">
            {t(lienMort ? "invitation.titreLienMort" : "invitation.titre")}
          </h1>
        </div>
        {corps}
      </div>
    </CadreConnexion>
  );
}
