/**
 * La demande d'un siège, chez le propriétaire (« Malica sans blocage »,
 * lot 4) : le propriétaire est au siège ce que le comptable est au
 * propriétaire — il accorde ou refuse, et un refus porte sa note, ici comme
 * en base (`refus.piece.motif_requis`).
 *
 * La même carte que la décision de la fiche : un mot, deux boutons de 48 px,
 * le principal plein à gauche. Ce que fait l'accord est dans le ⓘ : sur une
 * pièce déjà chez le comptable, la demande y part d'elle-même.
 */
import type { DemandeSurPiece } from "@malica/socle/ports/repositories";
import { MOTIF_LONGUEUR_MAX } from "@malica/socle/circuit";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Aide } from "@/components/malica/aide";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/demande-du-siege";

export function DemandeDuSiege({
  pieceId,
  objet,
  auteur,
  chezLeComptable,
  onTranchee,
}: {
  pieceId: string;
  objet: DemandeSurPiece;
  /** Le prénom du siège qui demande. */
  auteur: string | null;
  /** La pièce est déjà chez le comptable : l'accord lui transmet la demande. */
  chezLeComptable: boolean;
  onTranchee: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [refus, setRefus] = useState(false);
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const qui = auteur ?? t("circuit.siege");

  const trancher = useMutation({
    mutationFn: (accorde: boolean) =>
      office().collab.repondreSurPiece(pieceId, objet, accorde, accorde ? null : note.trim()),
    onMutate: () => setErreur(null),
    onSuccess: () => onTranchee(),
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  return (
    <div className="f-dec am" role="region" aria-label={t("circuit.demande.aria")}>
      <div className="f-dec-tete">
        <div>
          <p className="f-dec-titre">
            {t(objet === "rappel" ? "circuit.demande.rappel" : "circuit.demande.suppression", {
              qui,
            })}
            <Aide
              titre={t("circuit.demande.aide.titre")}
              paragraphes={[
                {
                  texte: t(
                    chezLeComptable
                      ? "circuit.demande.aide.transmise"
                      : objet === "rappel"
                        ? "circuit.demande.aide.rappel"
                        : "circuit.demande.aide.suppression",
                    { qui },
                  ),
                },
                { texte: t("circuit.demande.aide.refus", { qui }) },
              ]}
            />
          </p>
        </div>
      </div>
      {refus ? (
        <label className="f-dec-note">
          <span>{t("circuit.demande.note")}</span>
          <textarea
            rows={2}
            value={note}
            maxLength={MOTIF_LONGUEUR_MAX}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      ) : null}
      <div className="f-dec-gestes deux">
        {refus ? (
          <>
            <button
              type="button"
              className="pr"
              disabled={trancher.isPending || note.trim() === ""}
              onClick={() => trancher.mutate(false)}
            >
              {trancher.isPending ? t("common.loading") : t("cab.demande.refuser")}
            </button>
            <button type="button" disabled={trancher.isPending} onClick={() => setRefus(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="pr"
              disabled={trancher.isPending}
              onClick={() => trancher.mutate(true)}
            >
              {trancher.isPending ? t("common.loading") : t("cab.demande.accorder")}
            </button>
            <button type="button" disabled={trancher.isPending} onClick={() => setRefus(true)}>
              {t("cab.demande.refuser")}
            </button>
          </>
        )}
      </div>
      {erreur ? (
        <p role="alert" className="f-dec-sous">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
