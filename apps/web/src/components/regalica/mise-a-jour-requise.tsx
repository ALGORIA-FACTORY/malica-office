/**
 * L'écran « mettez à jour » — quand l'API refuse de parler à cette coque.
 *
 * Il se rend à la place de toute l'application, et HORS du fournisseur de
 * traductions, comme la frontière d'erreur : il porte ses phrases lui-même.
 * Rien à réessayer, rien à contourner — le contrat a changé, et la coque
 * doit suivre. Le bouton demande la mise à jour ; tant qu'elle n'est pas là,
 * recharger ne change rien, et l'écran le dit.
 */
import { useEtatTransport } from "@/lib/transport/etat";

const MOTS = {
  fr: {
    titre: "Une mise à jour est nécessaire.",
    corps:
      "Cette version de l'application ne peut plus parler au service. Mettez-la à jour pour continuer.",
    version: (v: string) => `Version minimale : ${v}`,
    bouton: "Mettre à jour",
  },
  en: {
    titre: "An update is required.",
    corps: "This version of the app can no longer talk to the service. Update it to continue.",
    version: (v: string) => `Minimum version: ${v}`,
    bouton: "Update",
  },
  ar: {
    titre: "يلزم تحديث التطبيق.",
    corps: "لم يعد هذا الإصدار من التطبيق قادرًا على التواصل مع الخدمة. حدّثه للمتابعة.",
    version: (v: string) => `الإصدار الأدنى: ${v}`,
    bouton: "تحديث",
  },
} as const;

function langueRangee(): keyof typeof MOTS {
  try {
    const rangee = window.localStorage.getItem("regalica.locale");
    if (rangee === "en" || rangee === "ar" || rangee === "fr") return rangee;
  } catch {
    // Stockage inaccessible — navigation privée, réglage du navigateur.
  }
  return "fr";
}

function MiseAJourRequise({ versionMinimale }: { versionMinimale: string | null }) {
  const mots = MOTS[langueRangee()];
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{mots.titre}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{mots.corps}</p>
        {versionMinimale ? (
          <p className="mt-1 text-xs text-muted-foreground">{mots.version(versionMinimale)}</p>
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
            {mots.bouton}
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
