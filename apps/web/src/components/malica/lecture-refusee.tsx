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
 * ========================================================= TROIS ÉTATS, TROIS MOTS
 *
 * Une pièce `capturee` est dans l'un de trois états, et la liste doit les
 * séparer :
 *
 *   — sans refus, et pas privée : « En attente de lecture ». Elle va être
 *     lue, il n'y a rien à faire ;
 *   — avec refus : « Non lue », et le motif juste en dessous. Il y a quelque
 *     chose à faire, ou au moins à savoir ;
 *   — privée et jamais lue : « Non lue », et la phrase de l'espace privé.
 *
 * ==================================== LE TROISIÈME SE DÉRIVE, IL NE S'ÉCRIT PAS
 *
 * 18 octobre 2026, mesuré sur le dossier d'atelier : trente pièces privées
 * affichaient « En attente de lecture ». Elles n'attendaient rien — une pièce
 * `personnel` n'est jamais lue (B6) — mais aucun refus n'avait été inscrit
 * pour elles : l'inscription est récente, et le journal d'audit ne contient
 * rien pour les pièces d'avant.
 *
 * La tentation était d'écrire ces trente refus par une migration. C'eût été
 * inscrire un fait daté d'aujourd'hui pour un refus qui n'a jamais eu lieu,
 * et R7 interdit de réécrire un fait comptable. Cet état se DÉRIVE donc de ce
 * qu'on sait déjà : la visibilité de la pièce. « Privée, jamais lue » n'est
 * pas un refus, c'est une conséquence, et elle se calcule.
 *
 * Elle se dit avec la même phrase et le même marquage qu'un refus
 * `piece_personnelle` inscrit — ce sont les mêmes faits, et deux présentations
 * pour un seul fait apprendraient à se méfier des deux. Ce qui manque, et ce
 * qui doit manquer, c'est la DATE : aucun refus n'a été prononcé.
 *
 * ============================================================ LA COULEUR, ET SON MOT
 *
 * Aucune information n'est portée par la seule couleur : la puce vient
 * toujours avec son mot écrit à côté (interdit n° 3 du langage visuel). Le
 * plafond, et lui seul, porte le marigold — partout ailleurs un refus est
 * vermillon.
 */
import { libelleDuRefus, motifDeLEtat, refusDuPlafond } from "@/lib/champ-lisible";
import { useI18n } from "@/i18n";
import type { LectureRefusee, Visibility } from "@malica/socle/ports/repositories";

/**
 * La ligne d'état d'une pièce non lue, dans une liste.
 *
 * Rendue À LA PLACE du statut : « Capturée » ne dit rien de plus que la date
 * d'à côté, là où « Non lue · plafond atteint » dit ce qu'il faut savoir.
 */
export function EtatDeLecture({
  refus,
  vis,
}: {
  refus: LectureRefusee | null | undefined;
  /**
   * Où la pièce est. Sans elle, une pièce privée jamais lue se rangeait avec
   * celles qui attendent leur tour — et disait donc le contraire de ce qui
   * est vrai.
   */
  vis: Visibility;
}) {
  const { t } = useI18n();
  const motif = motifDeLEtat(refus, vis);
  if (motif === null) {
    return (
      <span className="etat t-meta mt-px block" data-k="attente">
        <i aria-hidden />
        {t("pme.refus.attente")}
      </span>
    );
  }
  const plafond = refusDuPlafond(motif);
  return (
    <span className="mt-px block">
      <span className="etat t-meta" data-k={plafond ? "plafond" : "refus"}>
        <i aria-hidden />
        {t("pme.refus.titre")}
      </span>
      <span className="t-meta mt-px block">{libelleDuRefus(motif, t)}</span>
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
  motif,
  dateLisible,
}: {
  /** Le CODE du refus — inscrit par la base, ou dérivé de la visibilité. */
  motif: string;
  /**
   * La date du refus, déjà mise en forme dans la langue de la personne, ou
   * `null` quand il n'y a pas eu de refus à dater — une pièce privée jamais
   * lue n'a pas été refusée un jour précis, elle ne part pas, c'est tout.
   * Afficher la date du jour aurait fabriqué un fait.
   */
  dateLisible: string | null;
}) {
  const { t } = useI18n();
  const plafond = refusDuPlafond(motif);
  return (
    <div className="manque mt-4" data-k={plafond ? "plafond" : "refus"} role="status">
      <p className="etat t-label" data-k={plafond ? "plafond" : "refus"}>
        <i aria-hidden />
        {t("pme.refus.titre")}
      </p>
      <p className="t-body mt-2">{libelleDuRefus(motif, t)}</p>
      {dateLisible === null ? null : (
        <p className="t-meta mt-1.5">{t("pme.refus.le", { date: dateLisible })}</p>
      )}
    </div>
  );
}
