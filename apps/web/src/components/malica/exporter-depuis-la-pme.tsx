/**
 * « Exporter » — les pièces d'une société, à un comptable extérieur.
 *
 * Le jumeau d'`ImprimerDepuisLaPme`, posé à côté de lui dans le même groupe
 * ouvert (un mois, un siège, une sélection) : aucun écran neuf. Le bouton ouvre
 * une feuille de deux cases (les originaux en ZIP, la liste en Excel, cochées par
 * défaut), qui dit le périmètre en clair, puis prépare. Trois états, comme
 * l'impression : en cours, prêt (un bouton par fichier gardé), erreur (avec sa
 * référence). Les pièces privées n'y entrent jamais — le serveur le refuse.
 *
 * Disponible partout, y compris Basic : l'export ne se vend pas.
 */
import { useState } from "react";

import { megaoctets } from "@/hooks/use-impression";
import { useExportBibliotheque } from "@/hooks/use-export-bibliotheque";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";

/** Une société du lot exporté, avec le nombre de ses pièces. */
export interface SocieteExportee {
  id: string;
  nom: string;
  n: number;
}

export function ExporterDepuisLaPme({
  pieces,
  societes,
  libelle,
  titre,
  classe,
  classeDuTexte,
  quandFerme,
}: {
  pieces: readonly string[];
  societes: readonly SocieteExportee[];
  libelle: string;
  /** Ce qui s'exporte, dit dans la feuille (le mois, la sélection). */
  titre: string;
  /** La classe du bouton, celle de l'écran qui le reçoit. */
  classe: string;
  /** La classe du texte qui dit où en est l'export. */
  classeDuTexte: string;
  /** L'écran qui montre le geste peut le retirer une fois la feuille refermée. */
  quandFerme?: () => void;
}) {
  const { t, locale } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const [zip, setZip] = useState(true);
  const [excel, setExcel] = useState(true);
  const exp = useExportBibliotheque();
  // Une fois les fichiers prêts, les pièces ne sont plus « à exporter » : l'état prêt reste dit.
  const issue = exp.issue;
  const vide = pieces.length === 0 && issue === null;

  const fermer = () => {
    setOuvert(false);
    exp.oublier();
    quandFerme?.();
  };
  const perimetre =
    societes.length > 1
      ? t("pme.export.parSociete", { count: societes.length })
      : t("pme.export.perimetre", { count: pieces.length, societe: societes[0]?.nom ?? "" });

  return (
    <>
      <button
        type="button"
        className={classe}
        aria-expanded={ouvert}
        onClick={() => (ouvert ? fermer() : setOuvert(true))}
      >
        {libelle}
      </button>
      {ouvert ? (
        <div className="exp" role="group" aria-label={titre}>
          <h3>{titre}</h3>
          {issue?.genre === "pret" ? null : vide ? (
            <p role="status" className={classeDuTexte}>
              {t("pme.export.rien")}
            </p>
          ) : (
            <>
              <label className="exp-ligne">
                <input
                  type="checkbox"
                  checked={zip}
                  disabled={exp.enCours}
                  onChange={(e) => setZip(e.target.checked)}
                />
                <span>
                  <b>{t("pme.export.pieces")}</b>
                  <small>{t("pme.export.piecesAide")}</small>
                </span>
              </label>
              <label className="exp-ligne">
                <input
                  type="checkbox"
                  checked={excel}
                  disabled={exp.enCours}
                  onChange={(e) => setExcel(e.target.checked)}
                />
                <span>
                  <b>{t("pme.export.liste")}</b>
                  <small>{t("pme.export.listeAide")}</small>
                </span>
              </label>
              <p className={classeDuTexte}>
                {perimetre} {t("pme.export.sansPrivees")}
              </p>
              {!zip && !excel ? (
                <p role="alert" className={classeDuTexte}>
                  {t("pme.export.aucunFichier")}
                </p>
              ) : null}
            </>
          )}
          {exp.enCours ? (
            <p role="status" className={classeDuTexte}>
              {t("pme.export.enCours")}
            </p>
          ) : null}
          {exp.erreur && !exp.enCours ? (
            <p role="alert" className={`${classeDuTexte} exp-err`}>
              {texteDeLErreur(exp.erreur, "export", t("pme.export.erreur"))}
            </p>
          ) : null}
          {issue?.genre === "trop_volumineuse" ? (
            <p role="alert" className={`${classeDuTexte} exp-err`}>
              {t("pme.export.volume", {
                taille: megaoctets(issue.octets, locale),
                max: megaoctets(issue.octetsMax, locale),
              })}
            </p>
          ) : null}
          {issue?.genre === "pret" ? (
            <>
              <p role="status" className={classeDuTexte}>
                {t("pme.export.pret", { count: issue.fichiers.length })}
              </p>
              {issue.absents > 0 ? (
                <p role="alert" className={`${classeDuTexte} exp-err`}>
                  {t("pme.export.absents", { count: issue.absents })}
                </p>
              ) : null}
              {issue.fichiers.map((f) => (
                <button key={f.id} type="button" className={classe} onClick={() => exp.remettre(f)}>
                  {t("pme.export.telecharger", { nom: f.nomDeFichier })}
                </button>
              ))}
              {exp.chemin ? (
                <p role="status" className={classeDuTexte} style={{ overflowWrap: "anywhere" }}>
                  {t("pme.export.enregistre")} {exp.chemin}
                </p>
              ) : null}
            </>
          ) : null}
          <div className="exp-gestes">
            {!vide && issue?.genre !== "pret" ? (
              <button
                type="button"
                className={classe}
                disabled={exp.enCours || (!zip && !excel)}
                aria-busy={exp.enCours}
                onClick={() => exp.lancer({ pieces, zip, excel })}
              >
                {exp.erreur && !exp.enCours ? t("pme.export.reessayer") : t("pme.export.prepare")}
              </button>
            ) : null}
            <button type="button" className={classe} onClick={fermer}>
              {issue?.genre === "pret" ? t("common.fermer") : t("cab.biblio.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
