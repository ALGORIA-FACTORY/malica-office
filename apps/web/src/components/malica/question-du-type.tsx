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
 *   — la liste vient du RÉFÉRENTIEL, et seulement ce qui se propose à la
 *     capture : six choix, pas les dix-sept types du pack ;
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
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { usePiegeDeFocus } from "@/hooks/use-superposition";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

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
  onRepondre: (code: string) => void;
  actuel?: string | null;
} & Sortie) {
  const { t, locale } = useI18n();
  /*
   * La feuille recouvre l'ecran : sans ce piege, on tabule dans la page qu'on
   * ne voit plus. Elle n'est PAS sur la pile des superpositions — elle se
   * ferme en repondant, et brancher `Echap` dessus enverrait les pieces sans
   * type, ce qui est une decision de produit. D'ou le focus seul.
   */
  const feuille = useRef<HTMLDivElement | null>(null);
  usePiegeDeFocus(true, feuille);
  const types = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });

  // Six, pas les dix-sept du pack : choisir dans une liste de dix-sept est un
  // autre genre d'abandon. Le référentiel dit lesquels, par son drapeau.
  const proposes = (types.data ?? []).filter((ty) => ty.proposeALaCapture);

  /*
   * 24 octobre 2026, parcours validé par Wissem : de grosses tuiles plutôt
   * qu'une liste, un toucher répond. Le dessin de chaque tuile suit le CODE du
   * référentiel — un pictogramme n'est pas une règle métier (R4 ne vise que
   * les valeurs réglementaires) — et un type sans dessin à lui prend le
   * document générique : ce que le référentiel ajoute demain s'affiche quand même.
   */
  const pictogramme = (code: string) => DESSINS[code] ?? DESSINS["autre"]!;

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
          {proposes.map((ty) => (
            <button
              key={ty.code}
              type="button"
              aria-pressed={sortie.mode === "correction" ? ty.code === actuel : undefined}
              onClick={() => onRepondre(ty.code)}
              className={`flex min-h-[104px] flex-col items-start justify-between gap-3 rounded-[18px] bg-card p-3.5 text-start text-[15px] font-bold leading-tight hover:bg-accent ${
                ty.code === actuel ? "ring-2 ring-foreground" : ""
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={pictogramme(ty.code)} />
              </svg>
              {ty.libelle}
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

/** Le dessin de chaque type proposé, par son code ; « autre » sert de repli. */
const DESSINS: Readonly<Record<string, string>> = {
  facture_achat: "M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM12 8v6M9 11l3 3 3-3",
  facture_vente: "M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM12 14V8M9 11l3-3 3 3",
  ticket_caisse: "M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4",
  releve_bancaire: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  gouvernance: "M4 21h16M6 21V10M18 21V10M12 3l9 5H3zM10 21v-6h4v6",
  autre: "M6 3h8l4 4v14H6zM14 3v4h4",
};
