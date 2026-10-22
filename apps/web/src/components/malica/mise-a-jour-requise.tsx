/**
 * L'écran « mettez à jour » — quand l'API refuse de parler à cette coque.
 *
 * Il se rend à la place de toute l'application, et HORS du fournisseur de
 * traductions, comme la frontière d'erreur : il lit ses phrases directement
 * dans le dictionnaire (`maj.*`), dans la langue rangée par l'application.
 * Rien à réessayer, rien à contourner — le contrat a changé, et la coque
 * doit suivre. Le bouton demande la mise à jour ; tant qu'elle n'est pas là,
 * recharger ne change rien, et l'écran le dit.
 */
import { MESSAGES, type Locale } from "@malica/socle/messages";
import { useEtatTransport } from "@/lib/transport/etat";

function langueRangee(): Locale {
  try {
    const rangee = window.localStorage.getItem("malica.locale");
    if (rangee === "en" || rangee === "ar" || rangee === "fr") return rangee;
  } catch {
    // Stockage inaccessible — navigation privée, réglage du navigateur.
  }
  return "fr";
}

function MiseAJourRequise({ versionMinimale }: { versionMinimale: string | null }) {
  const mots = MESSAGES[langueRangee()];
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {mots["maj.titre"]}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{mots["maj.corps"]}</p>
        {versionMinimale ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {mots["maj.version"].replace("{version}", versionMinimale)}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            // Le magasin, ou la mise à jour en vol, remplacera ce rechargement
            // quand la coque existera. Recharger ne coûte rien et vaut mieux
            // qu'un bouton mort.
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {mots["maj.bouton"]}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Rend l'écran si le transport l'exige ; rien sinon. À poser à la racine. */
export function GardeDeVersion({ children }: { children: React.ReactNode }) {
  const { miseAJourRequise } = useEtatTransport();
  if (miseAJourRequise)
    return <MiseAJourRequise versionMinimale={miseAJourRequise.versionMinimale} />;
  return <>{children}</>;
}
