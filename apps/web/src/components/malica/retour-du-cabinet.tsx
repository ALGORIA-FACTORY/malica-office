/**
 * La pièce retournée par la comptabilité, sur la fiche du client.
 *
 * Maquette « Retours du cabinet et pièces à confirmer » (25 octobre 2026),
 * puis « Malica sans blocage » (28 octobre) : une pièce retournée ne bloque
 * jamais. Avant, « Renvoyer » restait éteint tant que le geste n'était pas
 * fait, et ni supprimer ni garder n'étaient possibles sans l'accord du
 * cabinet — qui les refusait ensuite.
 *
 * Désormais, dans cet ordre :
 *   1. ce que le cabinet dit, tel quel — motif, note entre guillemets, qui ;
 *      ce que fait chaque sortie est dans le ⓘ, pas dans la carte ;
 *   2. ce qui est déjà fait, quand la base le prouve (après le retour) ;
 *   3. les sorties, deux par ligne : le geste du motif — ou « Renvoyer » une
 *      fois fait —, puis reprendre la photo (elle REMPLACE celle-ci),
 *      répondre, garder, supprimer.
 *
 * Un seul circuit, deux fois (lot 4) : la MÊME carte porte le retour du
 * propriétaire au siège. Sur le retour du comptable d'une pièce de siège, le
 * siège fait le geste et le propriétaire renvoie : la fiche ne passe
 * « Renvoyer » et « Garder » qu'à qui en a le droit (`null` sinon).
 */
import type { RetourDuCabinet } from "@malica/socle/ports/repositories";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { Aide } from "@/components/malica/aide";
import { ConfirmationSurPlace, PasEncoreParti } from "@/components/malica/envoye";
import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois, momentDeLEnvoi } from "@/lib/lisible";
import {
  FAIT_DU_GESTE,
  LIBELLE_DU_GESTE,
  sortiesDuRetour,
  type SortieDuRetour,
} from "@/lib/retour-du-cabinet";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/retour-du-cabinet";

/** Un geste de la fiche, et s'il est en cours. */
interface Geste {
  action: () => void;
  enCours: boolean;
}

/** Ce que dit le ⓘ de chaque sortie : son nom, puis ce qu'elle fait. */
const AIDE_DE_LA_SORTIE: Record<Exclude<SortieDuRetour, "geste">, MessageKey> = {
  renvoyer: "pme.retour.aide.renvoyer",
  reprendre_photo: "pme.retour.aide.reprendre",
  repondre: "pme.retour.aide.repondre",
  garder: "pme.retour.aide.garder",
  supprimer: "pme.retour.aide.supprimer",
};

export function CarteDuRetour({
  pieceId,
  retour,
  onGeste,
  onReprendreLaPhoto,
  onVoirLeFait,
  renvoyer,
  garder,
  supprimer,
}: {
  pieceId: string;
  retour: RetourDuCabinet;
  /** Le geste du motif, branché par la fiche sur l'action qui existe déjà. */
  onGeste: () => void;
  /** Le scanner, ouvert pour REMPLACER cette pièce. */
  onReprendreLaPhoto: () => void;
  /** Montrer ce qui a été fait — la chaîne de la pièce. */
  onVoirLeFait: () => void;
  /** `null` : ce n'est pas à cette personne de renvoyer. */
  renvoyer: Geste | null;
  /** `null` : garder n'est pas son geste (le siège, le retour du propriétaire). */
  garder: Geste | null;
  /**
   * Effacer, ou archiver si le cabinet l'avait prise en charge : la base
   * tranche. `null` : le circuit ne le lui offre pas (`gestesDuCircuit`).
   */
  supprimer: Geste | null;
}) {
  const { t, locale } = useI18n();
  const [reponseOuverte, setReponseOuverte] = useState(false);
  /** La réponse partie : elle s'écrit sous les sorties, et reste. */
  const [reponseEnvoyee, setReponseEnvoyee] = useState<{ texte: string; le: string } | null>(null);
  /** Deux temps, jamais un seul : un effacement ne part pas par mégarde. */
  const [aConfirmer, setAConfirmer] = useState(false);
  // Qui l'a retournée : le cabinet, ou le prénom du propriétaire.
  const qui = retour.qui ?? t("pme.coffre.votreComptable");
  const faitLibelle = FAIT_DU_GESTE[retour.geste];
  const montrerLeFait = retour.fait && faitLibelle != null;
  const permises: Partial<Record<SortieDuRetour, Geste | null>> = { renvoyer, garder, supprimer };
  const sorties = sortiesDuRetour(retour.geste, retour.fait).filter(
    (s) => !(s in permises) || permises[s] != null,
  );
  const enCours = Boolean(renvoyer?.enCours || garder?.enCours || supprimer?.enCours);
  const sansGeste = { action: () => undefined, enCours: false };

  const bouton: Record<SortieDuRetour, { libelle: string; action: () => void; enCours?: boolean }> =
    {
      geste: { libelle: t(LIBELLE_DU_GESTE[retour.geste]), action: onGeste },
      renvoyer: { libelle: t("pme.retour.renvoyer"), ...(renvoyer ?? sansGeste) },
      reprendre_photo: {
        libelle: t("pme.retour.geste.reprendre_photo"),
        action: onReprendreLaPhoto,
      },
      repondre: { libelle: t("pme.retour.geste.repondre"), action: () => setReponseOuverte(true) },
      garder: { libelle: t("pme.retour.garder"), ...(garder ?? sansGeste) },
      supprimer: { libelle: t("pme.retour.supprimer"), action: () => setAConfirmer(true) },
    };

  return (
    <div className="f-ret">
      <div className="f-ret-dit">
        <span className={retour.fait ? "f-ret-etat ok" : "f-ret-etat"}>
          <i />
          {retour.fait
            ? t("pme.retour.etat.pret")
            : retour.chez === "proprietaire"
              ? // Le propriétaire au siège : son prénom, pas « votre comptabilité ».
                t("pme.retour.etat.qui", { qui, date: jourEtMois(retour.le, locale) })
              : t("pme.retour.etat", { date: jourEtMois(retour.le, locale) })}
          <Aide
            titre={t("pme.retour.aide.titre")}
            paragraphes={sorties
              .filter((s): s is Exclude<SortieDuRetour, "geste"> => s !== "geste")
              .map((s) => ({ titre: bouton[s].libelle, texte: t(AIDE_DE_LA_SORTIE[s], { qui }) }))}
          />
        </span>
        <b>{retour.motifLibelle}</b>
        {retour.note ? <q>{retour.note}</q> : null}
        {retour.qui ? <span className="f-ret-qui">{retour.qui}</span> : null}
      </div>

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
      ) : null}

      {aConfirmer && supprimer ? (
        <div className="f-ret-sur" role="alertdialog" aria-label={t("pme.supprimer.action")}>
          <p>{t("pme.retour.supprimer.sur")}</p>
          <div className="f-dec-gestes deux">
            <button type="button" onClick={() => setAConfirmer(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="sup"
              disabled={supprimer.enCours}
              onClick={supprimer.action}
            >
              {supprimer.enCours ? t("common.loading") : t("pme.supprimer.oui")}
            </button>
          </div>
        </div>
      ) : (
        <div className="f-dec-gestes deux f-ret-sorties">
          {sorties.map((s, i) => (
            <button
              key={s}
              type="button"
              className={i === 0 ? "pr" : s === "supprimer" ? "sup" : undefined}
              disabled={enCours}
              onClick={bouton[s].action}
            >
              {bouton[s].enCours ? t("common.loading") : bouton[s].libelle}
            </button>
          ))}
        </div>
      )}

      {reponseEnvoyee ? (
        <ConfirmationSurPlace
          titre={t("envoi.reponse.fait", { qui })}
          detail={t("envoi.reponse.detail", {
            texte: reponseEnvoyee.texte,
            quand: momentDeLEnvoi(reponseEnvoyee.le, locale).quand,
          })}
        />
      ) : null}

      {reponseOuverte ? (
        <RepondreAuCabinet
          pieceId={pieceId}
          qui={qui}
          onFermer={() => setReponseOuverte(false)}
          onEnvoyee={setReponseEnvoyee}
        />
      ) : null}
    </div>
  );
}

function RepondreAuCabinet({
  pieceId,
  qui,
  onFermer,
  onEnvoyee,
}: {
  pieceId: string;
  qui: string;
  onFermer: () => void;
  onEnvoyee: (r: { texte: string; le: string }) => void;
}) {
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
      // Écrite après la réponse du serveur : jamais une promesse.
      onEnvoyee({ texte: texte.trim(), le: new Date().toISOString() });
      fermer();
      // Le préfixe relit aussi le retour (`["piece", id, "retour", …]`).
      await qc.invalidateQueries({ queryKey: ["piece", pieceId] });
    },
    // Une panne va au journal ; seul un refus rédigé (4xx) a une phrase.
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, "") || null),
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
      {envoyer.isError ? (
        <PasEncoreParti qui={qui} reessayer={() => envoyer.mutate()} enCours={envoyer.isPending} />
      ) : null}
      {erreur ? (
        <p role="alert" className="text-[13px] text-signal-warn">
          {erreur}
        </p>
      ) : null}
      <button
        type="button"
        hidden={envoyer.isError}
        disabled={!texte.trim() || envoyer.isPending}
        onClick={() => envoyer.mutate()}
        className="min-h-[52px] rounded-full bg-foreground text-[15px] font-semibold text-background disabled:opacity-40"
      >
        {envoyer.isPending ? t("common.loading") : t("pme.retour.reponse.envoyer")}
      </button>
    </FeuilleDuBas>
  );
}
