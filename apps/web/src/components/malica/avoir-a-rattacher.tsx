/**
 * La facture d'origine d'un avoir, à rattacher (réglage « Avoirs » du cabinet :
 * lié à sa facture, décision du CEO du 31 octobre 2026).
 *
 * Le Socle lie un avoir à sa facture par le numéro qu'il imprime ; quand ce
 * numéro ne désigne aucune facture du dossier (ou plusieurs), rien ne se
 * propose, et le cabinet la désigne ici : une liste des factures du même
 * dossier et du même sens, déjà comptabilisées, et un geste. Le lien est un
 * fait, signé et daté ; puis la proposition se relit. Les explications sont
 * dans le i.
 */
import type { PropositionDePiece } from "@malica/socle/ports/repositories";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Aide } from "@/components/malica/aide";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/avoir-a-rattacher";

export function AvoirARattacher({
  pieceId,
  proposition,
  onRattachee,
}: {
  pieceId: string;
  proposition: PropositionDePiece | undefined;
  /** Le lien est posé : l'écran relit la proposition. */
  onRattachee: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const [choisie, setChoisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const aRattacher =
    proposition !== undefined && !proposition.ok && proposition.raisonCode === "facture_d_origine";
  const factures = useQuery({
    queryKey: ["factures-a-rattacher", pieceId],
    queryFn: () => office().office.facturesARattacher(pieceId),
    enabled: aRattacher,
  });
  const rattacher = useMutation({
    mutationFn: (factureId: string) => office().office.rattacherLaFacture(pieceId, factureId),
    onMutate: () => setErreur(null),
    onSuccess: onRattachee,
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });
  if (!aRattacher) return null;

  // Ce qui manque vient du serveur en CODE (R12) : aucune facture, ou une
  // facture sans écriture prise en charge.
  const manque = proposition.avoir?.manque ?? "introuvable";
  const titre =
    manque === "non_comptabilisee" ? t("cab.avoir.non_comptabilisee") : t("cab.avoir.titre");
  const liste = factures.data ?? [];
  return (
    <div className="space-y-2.5 border border-signal-warn bg-card px-3.5 py-3">
      <p id="avoir-a-rattacher" className="flex items-center text-[14px] font-semibold">
        {titre}
        <Aide
          titre={titre}
          paragraphes={[{ texte: t("cab.avoir.aide") }, { texte: t(`cab.avoir.manque.${manque}`) }]}
        />
      </p>
      {factures.isSuccess && liste.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("cab.avoir.aucune")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5" role="group" aria-labelledby="avoir-a-rattacher">
          <select
            aria-label={t("cab.avoir.choisir")}
            value={choisie}
            onChange={(e) => setChoisie(e.target.value)}
            className="min-h-[48px] border border-border bg-background px-2 text-[13px]"
          >
            <option value="">{t("cab.avoir.choisir")}</option>
            {liste.map((f) => (
              <option key={f.id} value={f.id}>
                {t("cab.avoir.option", {
                  numero: f.numero ?? "—",
                  date: f.date ?? "—",
                  emetteur: f.emetteur ?? "—",
                  ttc: f.ttc ? montant(f.ttc, locale) : "—",
                })}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!choisie || rattacher.isPending}
            onClick={() => rattacher.mutate(choisie)}
            className="min-h-[48px] border border-foreground bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {t("cab.avoir.rattacher")}
          </button>
        </div>
      )}
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
