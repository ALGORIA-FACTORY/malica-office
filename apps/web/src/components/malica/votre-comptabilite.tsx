/**
 * « Votre comptabilité » — planche 6, approuvée le 7 novembre 2026.
 *
 * « Rien ne réunit ce qui touche la comptabilité. » En tête de la
 * bibliothèque, chaque cabinet au mandat actif a son dossier : son nom, les
 * sociétés qu'il tient, et ce qui attend un geste (les pièces retournées).
 * Un toucher ouvre son écran.
 *
 * Aucune lecture de plus : l'offre et le cabinet de chaque société viennent
 * de `fichesDesSocietes` (la même clé que les Réglages), les pièces de la
 * même lecture groupée que la bibliothèque.
 */
import { Link } from "@tanstack/react-router";

import { useFichesDesSocietes } from "@/hooks/use-fiches-des-societes";
import { usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useI18n } from "@/i18n";
import { cabinetsDesSocietes } from "@/lib/votre-comptabilite";

/**
 * `societe` : la société de l'en-tête — seul son cabinet se montre ; `null`
 * (« Toutes les sociétés ») : ceux de toutes (9 novembre 2026).
 */
export function VotreComptabilite({ societe }: { societe: string | null }) {
  const { t } = useI18n();
  const { ids, fiches } = useFichesDesSocietes();
  const pieces = usePiecesLuesDesSocietes(ids);
  const parSociete = new Map(ids.map((id, i) => [id, pieces[i]?.data ?? []]));
  const cabinets = cabinetsDesSocietes(fiches.data ?? [], parSociete, societe);
  if (cabinets.length === 0) return null;

  return (
    <>
      <div className="sec">
        <h2>{t("pme.compta.votre")}</h2>
      </div>
      <div className="comptas">
        {cabinets.map((c, i) => (
          <Link
            key={c.id}
            to="/pme/comptabilite/$cabinetId"
            params={{ cabinetId: c.id }}
            className={i === 0 ? "compta une" : "compta"}
          >
            <span className="av" aria-hidden>
              {c.nom.slice(0, 1).toLocaleUpperCase()}
            </span>
            <span className="bd">
              <b>{c.nom}</b>
              <span>{t("pme.compta.mandat", { count: c.societes.length })}</span>
            </span>
            {c.aRepondre > 0 ? <em>{t("pme.compta.aRepondre", { count: c.aRepondre })}</em> : null}
          </Link>
        ))}
      </div>
    </>
  );
}
