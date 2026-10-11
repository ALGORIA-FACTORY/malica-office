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
export function QuestionDuType({
  documents,
  onRepondre,
  onPasser,
}: {
  documents: readonly string[];
  onRepondre: (code: string) => void;
  onPasser: () => void;
}) {
  const { t, locale } = useI18n();
  const types = useQuery({
    queryKey: ["types-capture", locale],
    queryFn: () => office().referential.typesDeDocumentALaCapture(locale),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40">
      <div className="mx-auto w-full max-w-md border-t border-border bg-background px-[22px] pb-safe pt-5">
        <p className="text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">
          {t("pme.type.titre")}
        </p>
        {/*
         * Un seul document : son nom, qui dit à la personne de quoi on parle.
         * Plusieurs : leur nombre, parce que dix noms de fichiers empilés ne
         * renseignent sur rien et poussent les boutons sous l'écran.
         */}
        <p className="mt-1 truncate text-[12.5px] text-text-2">
          {documents.length === 1 ? documents[0] : t("pme.type.lot", { count: documents.length })}
        </p>

        <div className="mt-4 grid gap-1.5">
          {(types.data ?? []).map((ty) => (
            <button
              key={ty.code}
              type="button"
              onClick={() => onRepondre(ty.code)}
              className="min-h-[52px] border border-border px-3.5 text-start text-[15px] font-medium hover:bg-accent"
            >
              {ty.libelle}
            </button>
          ))}
        </div>

        {/*
         * Passer n'est pas un échec, et ce bouton ne se cache pas.
         *
         * Le fichier est déjà choisi : si la question bloquait, une photo
         * serait perdue à chaque hésitation. Elle part alors sans type et se
         * lit comme avant — moins bien, et c'est tout.
         */}
        <button
          type="button"
          onClick={onPasser}
          className="mt-3 h-[46px] w-full text-[14px] font-medium text-text-2 underline underline-offset-4"
        >
          {t("pme.type.passer")}
        </button>
      </div>
    </div>
  );
}
