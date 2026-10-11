/**
 * « Comment avez-vous payé ? » — l'étape qui suit la lecture.
 *
 * ================================================================= POURQUOI
 *
 * Demandé le 10 octobre 2026 : « le moyen de paiement doit être choisi entre
 * la liste suivante dans un écran qui suit la lecture : espèce, chèque, carte
 * bancaire, traite, chèque de banque, virement ou autre. À l'exception
 * d'espèces les autres on doit prendre une photo et le rattacher à la
 * facture. »
 *
 * ======================================== PAS UN ÉCRAN DE PLUS : UNE PAGE QUI DESCEND
 *
 * Quatre écrans font quatre occasions d'abandonner. Celui-ci vit donc SOUS
 * les montants, sur la même page : on descend, on répond, on continue.
 *
 * ===================================================== CE QUI NE BLOQUE PAS
 *
 * La photo du justificatif ne conditionne rien. Un dirigeant qui n'a pas son
 * talon sous la main doit pouvoir avancer : la pièce est marquée
 * « justificatif manquant » et la liste le lui rappellera. Un écran qui
 * refuse d'avancer se contourne en cochant « espèces », et l'information est
 * perdue au lieu d'être gagnée.
 *
 * ============================================== ET LA LISTE VIENT DU PACK
 *
 * Huit moyens, leurs comptes de trésorerie, leurs libellés traduits : tout
 * vient de `ref.payment_means`, à la date de la pièce. Un moyen de paiement
 * écrit en dur donnerait une écriture fausse dans la première juridiction
 * suivante — avec des libellés justes et des comptes faux, donc invisible.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useState } from "react";

import { files } from "@/capabilities/files";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { vidage } from "@/lib/hors-ligne";
import { office } from "@/verticals/malica-office/composition";

export function CommentCEstPaye({
  pieceId,
  visDeLaPiece,
  dateDeLaPiece,
  ttcMineur,
  devise,
}: {
  pieceId: string;
  /**
   * La visibilité de la facture, que la preuve reprend.
   *
   * « Et qui doit être transmis au comptable avec la photo » : si la facture
   * est partie, le talon part avec elle. Une preuve restée personnelle sur une
   * facture transmise donnerait au cabinet une pièce dont le justificatif
   * existe et reste invisible.
   */
  visDeLaPiece: "personnel" | "partage";
  /** La date de la pièce : c'est à elle que le pack est lu, jamais à l'horloge. */
  dateDeLaPiece: string | null;
  /** Le total lu, en unités mineures — proposé par défaut, jamais imposé. */
  ttcMineur: number | null;
  devise: string;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);

  const au = dateDeLaPiece ?? new Date().toISOString().slice(0, 10);

  const moyens = useQuery({
    queryKey: ["moyens-paiement", pme.packId, locale, au],
    queryFn: () => office().referential.moyensDePaiement(pme.packId!, locale, au),
    enabled: !!pme.packId,
    staleTime: 60 * 60 * 1000,
  });

  const paiements = useQuery({
    queryKey: ["paiements", pieceId],
    queryFn: () => office().capture.paiementsDUnePiece(pieceId),
  });

  /**
   * La photo du justificatif — même capture, même archive, même chiffrement.
   *
   * Elle passe par la FILE, comme toute pièce : hors ligne, la preuve attend
   * dans l'appareil et part au retour du réseau. Photographier un talon de
   * chèque dans un parking sans réseau est précisément le cas qui se présente.
   *
   * Son type, `justificatif_paiement`, porte `porte_ecriture = false` : un
   * document transmis au cabinet et comptabilisable une seconde fois est la
   * façon la plus simple de compter une charge deux fois.
   */
  async function photographierLaPreuve(): Promise<string | null> {
    const [pris] = await files.takePhoto();
    if (!pris) return null;
    const cle = await vidage().deposer(
      {
        cle: files.newIdempotencyKey(),
        tenantId: pme.tenantId,
        entityId: pme.entityId,
        source: pris.source,
        // La preuve suit la facture : si celle-ci est partie au cabinet, le
        // talon part avec elle — « transmise au comptable avec la photo ».
        vis: visDeLaPiece,
        contentType: pris.blob.type || "application/pdf",
        documentKind: "justificatif_paiement",
        nomFichier: pris.name,
      },
      pris.blob,
    );
    const element = await vidage().attendre(cle, 8_000);
    return element?.pieceId ?? null;
  }

  const inscrire = useMutation({
    /*
     * ============================ LA PHOTO D'ABORD, QUAND LE MOYEN L'EXIGE
     *
     * Demandé le 10 octobre : « à l'exception d'espèces les autres on doit
     * prendre une photo et la rattacher à la facture ». L'appareil s'ouvre
     * donc au tap, avant l'inscription, et le paiement naît déjà prouvé —
     * une seule écriture, et la table des paiements reste en ajout seul.
     *
     * Un abandon de l'appareil n'annule RIEN : le paiement s'inscrit sans
     * preuve, la ligne dit « justificatif à photographier », et le bouton
     * reste là. Un écran qui refuse d'avancer se contourne en cochant
     * « espèces », et l'information est perdue au lieu d'être gagnée.
     */
    mutationFn: async (moyenCode: string) => {
      const paye = moyenCode !== "non_paye";
      const justificatifPieceId = exigeUnePreuve(moyenCode) ? await photographierLaPreuve() : null;
      return office().capture.enregistrerPaiement({
        pieceId,
        packId: pme.packId!,
        moyenCode,
        // Le montant et la date vont ensemble ou pas du tout : la base le
        // refuse autrement, et un paiement à moitié saisi ne se lit pas.
        montantMineur: paye ? ttcMineur : null,
        devise,
        payeLe: paye && ttcMineur !== null ? new Date().toISOString().slice(0, 10) : null,
        justificatifPieceId,
      });
    },
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["paiements", pieceId] });
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/comment-c-est-paye", t("common.error"))),
  });

  /**
   * La preuve qui arrive APRÈS — et c'est le cas courant.
   *
   * Le paiement est en ajout seul : il ne se réécrit pas. Le rattachement est
   * donc une écriture nouvelle, et la dernière vaut — reprendre une photo
   * floue n'est pas l'exception.
   */
  const rattacher = useMutation({
    mutationFn: async (paiementId: string) => {
      const preuve = await photographierLaPreuve();
      if (!preuve) return;
      await office().capture.rattacherJustificatif(paiementId, preuve);
    },
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["paiements", pieceId] });
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/comment-c-est-paye", t("common.error"))),
  });

  const deja = paiements.data ?? [];
  const libelleDuMoyen = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.libelle ?? code;
  const exigeUnePreuve = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.exigeJustificatif ?? false;

  return (
    <section className="mt-6 border-t border-border pt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-marigold">
        {t("pme.paiement.titre")}
      </p>

      {deja.length > 0 ? (
        <>
          {/*
           * Ce qui a DÉJÀ été inscrit, en premier : un acompte puis un solde
           * sont deux faits, et le second ne remplace pas le premier.
           */}
          <ul className="mt-2.5 grid gap-px border border-border bg-border">
            {deja.map((p) => (
              <li key={p.id} className="bg-card px-3 py-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-medium">{libelleDuMoyen(p.moyenCode)}</span>
                  <span className="num shrink-0 text-[13.5px]">
                    {p.montantMineur === null
                      ? "—"
                      : montant((p.montantMineur / 1000).toFixed(3), locale)}
                  </span>
                </span>
                {/*
                 * Le manque était dit, et rien ne permettait d'y répondre :
                 * une ligne orange sur toutes les pièces, pour toujours. Elle
                 * est devenue le bouton qui ouvre l'appareil.
                 */}
                {p.justificatifPieceId === null && exigeUnePreuve(p.moyenCode) ? (
                  <button
                    type="button"
                    onClick={() => rattacher.mutate(p.id)}
                    disabled={rattacher.isPending}
                    className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-signal-warn underline underline-offset-2 disabled:opacity-40"
                  >
                    <Camera className="h-[13px] w-[13px]" aria-hidden />
                    {rattacher.isPending ? t("common.loading") : t("pme.paiement.preuve.prendre")}
                  </button>
                ) : p.justificatifPieceId !== null ? (
                  <span className="mt-0.5 block text-[11.5px] text-signal-ok">
                    {t("pme.paiement.preuve.jointe")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-text-2">{t("pme.paiement.ajouter")}</p>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] leading-[1.5] text-text-2">{t("pme.paiement.lede")}</p>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {(moyens.data ?? []).map((m) => (
          <button
            key={m.code}
            type="button"
            onClick={() => inscrire.mutate(m.code)}
            disabled={inscrire.isPending}
            className="min-h-[46px] border border-border px-2.5 text-[13.5px] font-medium hover:bg-accent disabled:opacity-40"
          >
            {m.libelle}
          </button>
        ))}
      </div>

      {erreur ? <p className="mt-2 text-[12.5px] text-signal-warn">{erreur}</p> : null}
    </section>
  );
}
