/**
 * Le bandeau d'étapes, en tête d'un parcours sur poste de bureau.
 *
 * Deux parcours le portent. L'arrivée (`EtapesDuDepart`) : quatre étapes, celles
 * que l'arrivée enchaîne vraiment — la création de l'organisation
 * (`/onboarding`), la vérification de la société (`/pme/bienvenue`), le forfait
 * puis la comptabilité (`/pme/suite`). La fiche fiscale n'y figure pas : elle
 * s'ouvre aussi depuis les Réglages et les échéances, et lui donner un rang
 * dirait un ordre qui n'existe pas. Et « Ajouter des pièces » (`/pme/capturer`),
 * qui lui passe ses propres étapes.
 *
 * Le bandeau ne s'affiche qu'à partir de 1 024 px (`styles.css`, « le parcours ») :
 * sur téléphone, chaque écran garde sa barre d'origine, au pixel près.
 */
import { useI18n, type MessageKey } from "@/i18n";

export function BandeauDEtapes({
  nom,
  etapes,
  rang,
}: {
  /** Le nom du parcours, pour les lecteurs d'écran. */
  nom: MessageKey;
  /** Le nom de chaque étape, dans l'ordre. */
  etapes: readonly MessageKey[];
  /** L'étape en cours, comptée depuis 0. */
  rang: number;
}) {
  const { t } = useI18n();
  return (
    <ol className="bp-etapes" aria-label={t(nom)}>
      {etapes.map((cle, i) => (
        <li
          key={cle}
          data-etat={i < rang ? "fait" : i === rang ? "courante" : "a-venir"}
          aria-current={i === rang ? "step" : undefined}
        >
          <span className="bp-rang" aria-hidden>
            {i < rang ? (
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          {t(cle)}
        </li>
      ))}
    </ol>
  );
}

const DEPART = {
  organisation: "depart.etape.organisation",
  verifier: "depart.etape.verifier",
  forfait: "depart.etape.forfait",
  comptabilite: "depart.etape.comptabilite",
} as const satisfies Record<string, MessageKey>;

type EtapeDuDepart = keyof typeof DEPART;

const ORDRE = Object.keys(DEPART) as EtapeDuDepart[];

export function EtapesDuDepart({ courante }: { courante: EtapeDuDepart }) {
  return (
    <BandeauDEtapes
      nom="depart.etapes"
      etapes={Object.values(DEPART)}
      rang={ORDRE.indexOf(courante)}
    />
  );
}
