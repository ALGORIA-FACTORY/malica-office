/**
 * La file du cabinet en table — au bureau une table, au téléphone des cartes.
 *
 * Elle vivait dans `routes/_authenticated/cabinet.index.tsx`, exportée pour
 * le dossier d'un client. Une fonction exportée par un fichier de route reste
 * dans la partie que le routeur charge d'emblée : la table et ses imports
 * (aperçu de pièce, encre, lisibles) partaient avec la vitrine. Ici, elle ne
 * suit que les écrans qui la montrent.
 */
import { Link } from "@tanstack/react-router";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { InkCell, InkTable, InkTableRow, SignalLight } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { feuDuStatut, joursDAttente } from "@/lib/file-cabinet";
import { initialesDe } from "@/lib/initiales";
import { jourDeLEcriture } from "@/lib/jour-de-l-ecriture";
import { montant } from "@/lib/lisible";
import { MOT_CABINET } from "@/lib/statut";
import type { QueueItem } from "@malica/socle/ports/repositories";

/**
 * La file, en table au bureau et en cartes au téléphone.
 *
 * Relevé sur staging le 4 novembre 2026 à 375 px : les sept colonnes
 * restaient une table dans un défilement de côté, et le libellé s'écrasait
 * à une lettre par ligne. Sous 720 px, chaque ligne devient une carte — la
 * vignette et le client en tête avec le statut, le libellé sur toute la
 * largeur, puis le montant, l'attente et « Ouvrir ». Un seul balisage pour
 * les deux : la carte est la même ligne, posée autrement par la feuille
 * (`.cab-file`), et rien ne se dédouble au DOM.
 */
export function QueueTable({ rows }: { rows: QueueItem[] }) {
  const { t, locale } = useI18n();
  return (
    <InkTable
      className="cab-file"
      caption={t("cab.queue.title")}
      head={[
        t("cab.queue.rank"),
        t("cab.queue.client"),
        t("cab.queue.libelle"),
        t("cab.queue.amount"),
        t("cab.queue.status"),
        t("cab.queue.age"),
        "",
      ]}
    >
      {rows.map((row, i) => {
        const jours = joursDAttente(row.envoyeeLe);
        return (
          <InkTableRow key={row.pieceId}>
            <InkCell numeric className="cab-file-rang">
              {i + 1}
            </InkCell>
            <InkCell className="cab-file-client">
              {/* La vraie page, à gauche : le comptable reconnaît la pièce avant de l'ouvrir. */}
              <span className="flex items-center gap-3">
                <ApercuDePiece pieceId={row.pieceId} className="vignette" />
                <span className="min-w-0">
                  <span className="block font-medium">{row.clientName}</span>
                  {/*
                   * Une demande qui attend se VOIT dans la file. Sans cette
                   * pastille, le comptable devrait ouvrir chaque pièce pour
                   * découvrir qu'un client attend une réponse — donc il ne la
                   * découvrirait pas.
                   */}
                  {row.demandeEnAttente ? (
                    <span className="mt-0.5 inline-block bg-signal-warn px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-background">
                      {t(
                        row.demandeEnAttente === "rappel"
                          ? "cab.file.demande.rappel"
                          : "cab.file.demande.suppression",
                      )}
                    </span>
                  ) : null}
                  {row.doublonDe ? (
                    <span className="mt-0.5 ms-1 inline-block bg-signal-warn px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-background">
                      {t("cab.file.doublon")}
                    </span>
                  ) : null}
                  {row.collaborateur ? (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="num bg-foreground px-1 text-[9px] text-background">
                        {initialesDe(row.collaborateur)}
                      </span>
                      <span className="truncate">{row.collaborateur}</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </InkCell>
            <InkCell className="cab-file-libelle">
              {/*
               * « Pas encore lue » était faux, et visiblement faux.
               *
               * 13 octobre 2026 : huit lignes de la file portaient le statut
               * LUE et, dans la colonne LIBELLÉ, « Pas encore lue ». Le
               * libellé de cette colonne est celui de l'ÉCRITURE ; son repli
               * décrivait la pièce, et se trompait de sujet. Une pièce lue
               * dont aucune écriture n'est comptabilisée n'est pas une pièce
               * non lue — c'est précisément celle que le cabinet doit
               * regarder.
               *
               * 4 novembre 2026 : « Lue — aucune écriture », sans un nom, ne
               * dit pas QUELLE pièce attend. Le fournisseur lu (ou dit par une
               * personne) s'y ajoute quand on le connaît.
               */}
              <span className="block">
                {row.libelle ??
                  (row.status === "capturee"
                    ? t("cab.queue.unread")
                    : row.tiers
                      ? t("cab.queue.sansEcriture.tiers", { tiers: row.tiers })
                      : t("cab.queue.sansEcriture"))}
              </span>
              {row.dateEcriture ? (
                <span className="num block text-[10.5px] text-muted-foreground">
                  {jourDeLEcriture(row.dateEcriture, locale)}
                </span>
              ) : null}
            </InkCell>
            <InkCell numeric className="cab-file-montant" label={t("cab.queue.amount")}>
              {/* L'écriture d'abord ; sinon le TTC lu ; sinon rien (7 novembre 2026). */}
              {row.montant
                ? montant(row.montant, locale)
                : row.montantLu
                  ? montant(row.montantLu, locale)
                  : "—"}
            </InkCell>
            <InkCell className="cab-file-statut">
              <SignalLight tone={feuDuStatut(row.statut)} label={t(MOT_CABINET[row.statut])} />
            </InkCell>
            <InkCell numeric className="cab-file-attente" label={t("cab.queue.age")}>
              {jours === 0 ? t("cab.queue.age.today") : t("cab.queue.age.days", { n: jours })}
            </InkCell>
            <InkCell className="cab-file-ouvrir">
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: row.pieceId }}
                className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
              >
                {t("cab.queue.open")}
              </Link>
            </InkCell>
          </InkTableRow>
        );
      })}
    </InkTable>
  );
}
