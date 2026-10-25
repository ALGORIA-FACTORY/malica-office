/**
 * La pièce retournée par la comptabilité, sur la fiche du client.
 *
 * Maquette « Retours du cabinet et pièces à confirmer », validée le
 * 25 octobre 2026. Avant, un retour ne montrait ni le motif ni la note : la
 * carte redemandait « C'est bien le bon montant ? », et « Oui » recomptabilisait
 * sans le document que le cabinet attendait.
 *
 * Désormais, dans cet ordre :
 *   1. ce que le cabinet dit, tel quel — motif, note entre guillemets, qui ;
 *   2. ce qu'il faut faire — UN geste, celui que le motif désigne ;
 *   3. « Renvoyer à la comptabilité », possible seulement quand le geste est
 *      fait (la base le dit : une preuve postérieure au retour) ;
 *   4. « Répondre à la comptabilité », pour ne pas être d'accord, ou demander.
 */
import type { RetourDuCabinet } from "@malica/socle/ports/repositories";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois } from "@/lib/lisible";
import { FAIT_DU_GESTE, LIBELLE_DU_GESTE } from "@/lib/retour-du-cabinet";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/retour-du-cabinet";

export function CarteDuRetour({
  pieceId,
  retour,
  onGeste,
  onPhotographier,
  onVoirLeFait,
  renvoyer,
}: {
  pieceId: string;
  retour: RetourDuCabinet;
  /** Le geste du motif, branché par la fiche sur l'action qui existe déjà. */
  onGeste: () => void;
  /** Pour un document à joindre qui n'est pas encore photographié. */
  onPhotographier: (() => void) | null;
  /** Montrer ce qui a été fait — la chaîne de la pièce. */
  onVoirLeFait: () => void;
  renvoyer: { action: () => void; enCours: boolean };
}) {
  const { t, locale } = useI18n();
  const [reponseOuverte, setReponseOuverte] = useState(false);
  const faitLibelle = FAIT_DU_GESTE[retour.geste];
  // Le geste sans trace n'attend rien : on le propose, et on peut renvoyer.
  const pret = retour.fait;
  const montrerLeFait = pret && faitLibelle != null;
  const repondreEstLeGeste = retour.geste === "repondre";
  const ouvrirLaReponse = () => setReponseOuverte(true);

  return (
    <div className="f-ret">
      <div className="f-ret-dit">
        <span className={pret ? "f-ret-etat ok" : "f-ret-etat"}>
          <i />
          {pret
            ? t("pme.retour.etat.pret")
            : t("pme.retour.etat", { date: jourEtMois(retour.le, locale) })}
        </span>
        <b>{retour.motifLibelle}</b>
        {retour.note ? <q>{retour.note}</q> : null}
        {retour.cabinet ? <span className="f-ret-qui">{retour.cabinet}</span> : null}
      </div>

      <p className="f-ret-tit">{t("pme.retour.aFaire")}</p>
      {montrerLeFait ? (
        <div className="f-ret-fait">
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span className="bd">
            <b>{t(faitLibelle)}</b>
            <span>{t("pme.retour.fait.sous")}</span>
          </span>
          <button type="button" onClick={onVoirLeFait}>
            {t("pme.retour.voir")}
          </button>
        </div>
      ) : (
        <div className="f-ret-gestes">
          <button
            type="button"
            className="pr"
            onClick={repondreEstLeGeste ? ouvrirLaReponse : onGeste}
          >
            {t(LIBELLE_DU_GESTE[retour.geste])}
          </button>
          {onPhotographier ? (
            <button type="button" onClick={onPhotographier}>
              {t("pme.retour.photographier")}
            </button>
          ) : null}
        </div>
      )}

      <button
        type="button"
        className="f-ret-renvoi"
        disabled={!pret || renvoyer.enCours}
        onClick={renvoyer.action}
      >
        {renvoyer.enCours ? t("common.loading") : t("pme.retour.renvoyer")}
      </button>
      <p className="f-ret-aide">
        {pret ? t("pme.retour.renvoyer.pret") : t("pme.retour.renvoyer.attente")}
      </p>

      {repondreEstLeGeste && !montrerLeFait ? null : (
        <button type="button" className="f-ret-repondre" onClick={ouvrirLaReponse}>
          {t("pme.retour.geste.repondre")}
        </button>
      )}

      {reponseOuverte ? (
        <RepondreAuCabinet pieceId={pieceId} onFermer={() => setReponseOuverte(false)} />
      ) : null}
    </div>
  );
}

function RepondreAuCabinet({ pieceId, onFermer }: { pieceId: string; onFermer: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const feuille = useRef<HTMLDivElement | null>(null);
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const fermer = useCallback(() => onFermer(), [onFermer]);
  useSuperposition(true, fermer, feuille);

  const envoyer = useMutation({
    mutationFn: () => office().capture.repondreAuCabinet(pieceId, texte.trim()),
    onMutate: () => setErreur(null),
    onSuccess: async () => {
      fermer();
      await qc.invalidateQueries({ queryKey: ["piece", pieceId] });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  return (
    <FeuilleDuBas
      titre={t("pme.retour.geste.repondre")}
      onFermer={fermer}
      feuilleRef={feuille}
      disposition="flex flex-col gap-4 pb-6"
    >
      <label className="flex flex-col gap-2">
        <span className="sr-only">{t("pme.retour.reponse.champ")}</span>
        <textarea
          rows={4}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={t("pme.retour.reponse.champ")}
          className="resize-none rounded-[14px] border border-border bg-card px-3 py-3 text-[15px] outline-none"
        />
      </label>
      {erreur ? (
        <p role="alert" className="text-[13px] text-signal-warn">
          {erreur}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!texte.trim() || envoyer.isPending}
        onClick={() => envoyer.mutate()}
        className="min-h-[52px] rounded-full bg-foreground text-[15px] font-semibold text-background disabled:opacity-40"
      >
        {envoyer.isPending ? t("common.loading") : t("pme.retour.reponse.envoyer")}
      </button>
    </FeuilleDuBas>
  );
}
