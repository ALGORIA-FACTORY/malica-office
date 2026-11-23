import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CadreConnexion } from "@/components/malica/cadre-connexion";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import { EchecAuth } from "@malica/socle/ports/auth";

/**
 * La confirmation de l'adresse, depuis le lien reçu par courriel.
 *
 * Le secret voyage dans le FRAGMENT de l'adresse : il n'atteint jamais un
 * serveur par la barre d'adresse. On le lit, puis on l'efface de l'historique.
 * La confirmation ne demande aucune session : le lien suffit, et il ne sert
 * qu'une fois.
 */
export const Route = createFileRoute("/confirmer-adresse")({
  // Le titre est celui de la racine (aucune langue figée) ; le secret ne part
  // jamais dans un Referer.
  head: () => ({
    meta: [
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConfirmerAdresse,
});

type Etat = "lecture" | "confirmee" | "expiree" | "erreur";

function ConfirmerAdresse() {
  const { t } = useI18n();
  const [etat, setEtat] = useState<Etat>("lecture");

  useEffect(() => {
    const secret = window.location.hash.replace(/^#/, "");
    if (secret) window.history.replaceState(null, "", window.location.pathname);
    if (secret.length < 16) {
      setEtat("expiree");
      return;
    }
    office()
      .auth.confirmerAdresse(secret)
      .then(() => setEtat("confirmee"))
      .catch((err: unknown) =>
        setEtat(
          err instanceof EchecAuth && (err.motif === "lien_expire" || err.motif === "saisie")
            ? "expiree"
            : "erreur",
        ),
      );
  }, []);

  return (
    <CadreConnexion>
      <div className="cx-form">
        <div className="cx-head">
          <h1 className="cx-title">{t("adresse.page.titre")}</h1>
        </div>
        {etat === "lecture" ? (
          <p className="cx-hint" aria-busy="true">
            {t("auth.pending")}
          </p>
        ) : etat === "confirmee" ? (
          <p role="status" className="cx-msg">
            {t("adresse.page.confirmee")}
          </p>
        ) : (
          <p role="alert" className="cx-msg cx-err">
            {etat === "expiree" ? t("adresse.page.expiree") : t("auth.error.unreachable")}
          </p>
        )}
        <Link to="/office" className="cx-link-btn">
          {t("adresse.page.continuer")}
        </Link>
      </div>
    </CadreConnexion>
  );
}
