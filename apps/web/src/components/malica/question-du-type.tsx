/**
 * « Qu'est-ce que c'est ? » — la question posée avant la lecture.
 *
 * ================================================================= POURQUOI
 *
 * Demandé quatre fois depuis le 10 octobre 2026 : « après le scan un écran
 * apparaît pour que l'utilisateur choisisse autre document, achat ou vente,
 * extrait bancaire, gouvernance. Et après le choix Malica lit le document sur
 * cette base. »
 *
 * Jusqu'ici la lecture partait en aveugle sur une invite de facture : un
 * extrait bancaire était lu comme une facture ratée plutôt que reconnu comme
 * un relevé, et un procès-verbal appelait un modèle de vision pour rien.
 *
 * ====================================================== CE QUI LA REND SUPPORTABLE
 *
 * Une question de plus est une occasion d'abandonner. Trois choses la
 * rendent légère :
 *
 *   — la liste vient du RÉFÉRENTIEL : les sept dossiers (`ref.dossiers`),
 *     ceux de l'accueil, pas les vingt-trois types du pack ;
 *   — les libellés sont des phrases, pas une nomenclature. « Une facture que
 *     j'ai reçue », pas « facture_achat » ;
 *   — on peut passer. « Je ne sais pas » renvoie une pièce sans type, lue
 *     comme avant — c'est moins bien, et c'est mieux que d'abandonner.
 *
 * ================================================== ET CE N'EST PAS UNE PREUVE
 *
 * La pièce naît « a_confirmer » : la personne a DÉCLARÉ, rien n'est vérifié.
 * Si le matricule du dossier dit le contraire, c'est la comparaison qui
 * gagne — une déclaration est une intention.
 */
import { useRef } from "react";

import { usePiegeDeFocus } from "@/hooks/use-superposition";

import { useDossiers } from "@/hooks/use-dossiers";
import { useI18n } from "@/i18n";
import { dossierDeLaPiece, typePourLeDossier } from "@/lib/dossiers";

/**
 * ============================================ UNE QUESTION POUR TOUT LE LOT
 *
 * 11 octobre 2026, avec l'arrivée des PDF par lots : dix documents ne font
 * pas dix questions. Un lot est presque toujours d'une seule nature — un mois
 * d'achats, un carnet de ventes — et dix questions d'affilée sont dix
 * occasions d'abandonner, la dixième recevant une réponse au hasard.
 *
 * Chaque pièce reste retypable ensuite, sur son écran.
 */
/**
 * La même feuille sert APRÈS la lecture, pour corriger le type (23 octobre
 * 2026) : une seule liste, un seul dessin. `actuel` marque le type de la
 * pièce ; le bouton du bas devient « Annuler » — corriger n'a pas de « je ne
 * sais pas ».
 */
type Sortie =
  { mode: "capture"; onPasser: () => void } | { mode: "correction"; onAnnuler: () => void };

export function QuestionDuType({
  documents,
  onRepondre,
  actuel = null,
  ...sortie
}: {
  documents: readonly string[];
  /** Le TYPE à écrire : le dossier choisi le donne (`lib/dossiers.ts`). */
  onRepondre: (code: string) => void;
  /** La pièce corrigée : son type et le sens lu, pour marquer son dossier. */
  actuel?: { typeDeDocument: string | null; kind: "facture_achat" | "facture_vente" | null } | null;
} & Sortie) {
  const { t } = useI18n();
  /*
   * La feuille recouvre l'ecran : sans ce piege, on tabule dans la page qu'on
   * ne voit plus. Elle n'est PAS sur la pile des superpositions — elle se
   * ferme en repondant, et brancher `Echap` dessus enverrait les pieces sans
   * type, ce qui est une decision de produit. D'ou le focus seul.
   */
  const feuille = useRef<HTMLDivElement | null>(null);
  usePiegeDeFocus(true, feuille);
  /*
   * SEPT DOSSIERS, PAS DES TYPES (25 octobre 2026, maquette validée) : les
   * mêmes noms et les mêmes teintes que l'accueil. Le dossier choisi écrit
   * son type par défaut ; la lecture précise ensuite. En correction, choisir
   * le dossier où la pièce est déjà garde son type précis.
   */
  const { dossiers, types } = useDossiers();
  const dossierActuel = actuel ? dossierDeLaPiece(actuel, types) : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40">
      <div
        ref={feuille}
        role="dialog"
        aria-modal="true"
        aria-label={t("pme.type.titre")}
        className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-border bg-background px-[18px] pb-safe pt-3"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border" />
        <p className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em]">
          {t("pme.type.titre")}
        </p>
        {/*
         * Un seul document : son nom. Plusieurs : leur nombre — dix noms de
         * fichiers empilés ne renseignent sur rien et poussent les tuiles sous
         * l'écran.
         */}
        <p className="mt-1 truncate text-[14px] text-text-2">
          {documents.length === 1 ? documents[0] : t("pme.type.lot", { count: documents.length })}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {dossiers.map((d) => (
            <button
              key={d.code}
              type="button"
              data-teinte={d.teinte}
              aria-pressed={sortie.mode === "correction" ? d.code === dossierActuel : undefined}
              onClick={() => onRepondre(typePourLeDossier(d, actuel, types))}
              className="tuile-dossier relative flex min-h-[104px] flex-col items-start justify-between gap-3 overflow-hidden rounded-[18px] p-3.5 text-start text-[16px] font-extrabold leading-tight"
            >
              <span aria-hidden className="ini">
                {d.libelle.slice(0, 1)}
              </span>
              {/* Un exemple de ce qu'il range : le nom de son type par défaut. */}
              <span className="ex">{types.find((x) => x.code === d.typeParDefaut)?.libelle}</span>
              {d.libelle}
            </button>
          ))}
          {/*
           * Passer n'est pas un échec, et ce choix ne se cache pas : le fichier
           * est déjà pris, et une question qui bloque ferait perdre une photo à
           * chaque hésitation. La pièce part sans type et se lit comme avant.
           */}
          {sortie.mode === "capture" ? (
            <button
              type="button"
              onClick={sortie.onPasser}
              className="flex min-h-[104px] flex-col items-start justify-between gap-3 rounded-[18px] border border-dashed border-line-strong p-3.5 text-start text-[15px] font-bold leading-tight hover:bg-accent"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.8.7-.8 1.3v.3M12 17v.2" />
              </svg>
              {t("pme.type.passer")}
            </button>
          ) : null}
        </div>

        {sortie.mode === "correction" ? (
          <button
            type="button"
            onClick={sortie.onAnnuler}
            className="mt-3 h-[46px] w-full text-[14px] font-medium text-text-2 underline underline-offset-4"
          >
            {t("common.cancel")}
          </button>
        ) : (
          <p className="mb-3 mt-3 text-center text-[13px] text-muted-foreground">
            {t("pme.type.corrigeable")}
          </p>
        )}
      </div>
    </div>
  );
}
