/**
 * « Toutes · ALGORIA · SOTUMAG » — le choix de la société, là où l'on travaille.
 *
 * Le sélecteur de l'en-tête est parti le 3 novembre 2026 (décision du
 * dirigeant) : il décidait en silence de ce que montrait chaque écran. La
 * bibliothèque, ses dossiers et les échéances montrent TOUTES les sociétés par
 * défaut, et ces puces en isolent une. Le choix est partagé entre ces écrans
 * (`pme.societeAffichee`) et ne change pas le dossier ouvert.
 *
 * Une seule société : rien ne s'affiche, il n'y a rien à choisir.
 *
 * Le dessin est celui des filtres de la pochette (`.filtres`, `aria-pressed`) :
 * aucune forme nouvelle.
 */
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";

export function FiltreDesSocietes() {
  const { t } = useI18n();
  const pme = usePme();
  if (pme.dossiers.length < 2) return null;
  const choix: ReadonlyArray<{ id: string | null; nom: string }> = [
    { id: null, nom: t("pme.societes.toutes") },
    ...pme.dossiers.map((d) => ({ id: d.id, nom: d.name })),
  ];
  return (
    <div className="filtres" role="group" aria-label={t("pme.societes.choix")}>
      {choix.map((c) => (
        <button
          key={c.id ?? "toutes"}
          type="button"
          aria-pressed={pme.societeAffichee === c.id}
          onClick={() => pme.afficherSociete(c.id)}
        >
          {c.nom}
        </button>
      ))}
    </div>
  );
}
