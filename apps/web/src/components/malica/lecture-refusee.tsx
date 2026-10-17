/**
 * Pourquoi cette pièce n'a pas été lue — dit à l'écran.
 *
 * ================================================================== POURQUOI
 *
 * La base inscrit le motif depuis le 19 octobre 2026, et **aucun écran ne le
 * lisait**. Le dirigeant au plafond de son forfait photographiait sa facture,
 * elle était rangée, et rien ne se passait. Ce silence est la plainte qui a
 * ouvert la session du 17 octobre : une pièce refusée ressemblait trait pour
 * trait à une pièce qui attend son tour.
 *
 * ========================================================= DEUX ÉTATS, DEUX MOTS
 *
 * Une pièce `capturee` est dans l'un de deux états, et la liste doit les
 * séparer :
 *
 *   — sans refus : « En attente de lecture ». Elle va être lue, il n'y a rien
 *     à faire ;
 *   — avec refus : « Non lue », et le motif juste en dessous. Il y a quelque
 *     chose à faire, ou au moins à savoir.
 *
 * ============================================================ LA COULEUR, ET SON MOT
 *
 * Aucune information n'est portée par la seule couleur : la puce vient
 * toujours avec son mot écrit à côté (interdit n° 3 du langage visuel). Le
 * plafond, et lui seul, porte le marigold — partout ailleurs un refus est
 * vermillon.
 */
import { libelleDuRefus, refusDuPlafond } from "@/lib/champ-lisible";
import { useI18n } from "@/i18n";
import type { LectureRefusee } from "@malica/socle/ports/repositories";

/**
 * La ligne d'état d'une pièce non lue, dans une liste.
 *
 * Rendue À LA PLACE du statut : « Capturée » ne dit rien de plus que la date
 * d'à côté, là où « Non lue · plafond atteint » dit ce qu'il faut savoir.
 */
export function EtatDeLecture({ refus }: { refus: LectureRefusee | null | undefined }) {
  const { t } = useI18n();
  if (!refus) {
    return (
      <span className="etat t-meta mt-px block" data-k="attente">
        <i aria-hidden />
        {t("pme.refus.attente")}
      </span>
    );
  }
  const plafond = refusDuPlafond(refus.motif);
  return (
    <span className="mt-px block">
      <span className="etat t-meta" data-k={plafond ? "plafond" : "refus"}>
        <i aria-hidden />
        {t("pme.refus.titre")}
      </span>
      <span className="t-meta mt-px block">{libelleDuRefus(refus.motif, t)}</span>
    </span>
  );
}

/**
 * Le refus, en bloc, sur l'écran de la pièce.
 *
 * Pointillé et anneau : la carte dit ce qu'elle ferait sans se cacher — c'est
 * `.manque`, la primitive de ce qui attend. Le bouton « Lire » reste là : la
 * base tranchera, et l'écran n'a pas à deviner à sa place.
 */
export function RefusDeLecture({
  refus,
  dateLisible,
}: {
  refus: LectureRefusee;
  /** La date du refus, déjà mise en forme dans la langue de la personne. */
  dateLisible: string;
}) {
  const { t } = useI18n();
  const plafond = refusDuPlafond(refus.motif);
  return (
    <div className="manque mt-4" data-k={plafond ? "plafond" : "refus"} role="status">
      <p className="etat t-label" data-k={plafond ? "plafond" : "refus"}>
        <i aria-hidden />
        {t("pme.refus.titre")}
      </p>
      <p className="t-body mt-2">{libelleDuRefus(refus.motif, t)}</p>
      <p className="t-meta mt-1.5">{t("pme.refus.le", { date: dateLisible })}</p>
    </div>
  );
}
