/**
 * Son Mon espace part avec son compte (« Malica sans blocage », lot 4).
 *
 * Un siège qui quitte une société y laisse les pièces de la société ; ses
 * pièces privées restent à lui seul, et cet écran les lui montre hors de toute
 * société : il les télécharge, il les supprime. Il ne les envoie jamais — il
 * n'est plus membre ; la base le refuse aussi (`capture_piece_set_vis`,
 * `piece_envoyer`).
 *
 * Le même Mon espace que dans la société (spec §5, revue de #146) : la grille
 * de miniatures par mois, le compte, deux gestes côte à côte sur les papiers
 * choisis, la même question avant d'effacer (`grille-des-mois.tsx`). Il n'y a
 * pas de fiche où ouvrir une pièce hors de la société : toucher un papier le
 * choisit. L'explication est dans le ⓘ.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { Aide } from "@/components/malica/aide";
import {
  CompteDesPapiers,
  ConfirmerLaSuppression,
  GrilleDesMois,
} from "@/components/malica/grille-des-mois";
import { useSupprimerDeMonEspaceParti } from "@/hooks/use-gestes-du-circuit";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois } from "@/lib/lisible";
import { nomDeFichierDePiece } from "@/lib/nom-de-fichier";
import { LotInterrompu, unParUn } from "@/lib/un-par-un";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/mon-espace-parti";
const CLE = ["mon-espace-hors-societe"] as const;

function useMonEspaceParti() {
  return useQuery({
    queryKey: CLE,
    queryFn: () => office().capture.monEspaceHorsSociete(),
  });
}

/** Le chemin vers cet écran, depuis le compte — seulement s'il y a quelque chose. */
export function LienMonEspaceParti({ className }: { className?: string }) {
  const { t } = useI18n();
  const pieces = useMonEspaceParti();
  const n = pieces.data?.length ?? 0;
  if (n === 0) return null;
  return (
    <Link to="/mon-espace" className={className}>
      {t("monespace.lien", { count: n })}
    </Link>
  );
}

export function MonEspaceParti() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const pieces = useMonEspaceParti();
  /** Les papiers choisis, dans l'ordre où on les a touchés. */
  const [choisis, setChoisis] = useState<readonly string[]>([]);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [remis, setRemis] = useState<string | null>(null);

  const toutes = pieces.data ?? [];
  // Un choix qui a quitté l'espace (supprimé, relu) ne compte plus.
  const choix = choisis.filter((id) => toutes.some((p) => p.id === id));

  /** Ce qui s'est arrêté reste choisi, et la raison se dit. */
  const direLeRefus = (e: unknown) => {
    if (e instanceof LotInterrompu) setChoisis(e.restants);
    return texteDeLErreur(e instanceof LotInterrompu ? e.cause : e, OU, t("common.error"));
  };

  const telecharger = useMutation({
    mutationFn: (ids: readonly string[]) =>
      unParUn(ids, async (id) => {
        const p = toutes.find((x) => x.id === id);
        if (!p) throw new Error(`piece absente de Mon espace : ${id}`);
        const octets = await office().capture.apercu(id);
        if (!octets) throw new Error(`contenu absent : ${id}`);
        const { chemin } = await enregistrerUnFichier(
          octets,
          nomDeFichierDePiece(`${p.societe} ${p.createdAt.slice(0, 10)}`, p.id, octets.type),
        );
        setRemis(chemin);
      }),
    onMutate: () => {
      setErreur(null);
      setRemis(null);
    },
    onError: (e: unknown) => setErreur(direLeRefus(e)),
  });

  // La porte de la suppression (`use-gestes-du-circuit.ts`), hors de la société.
  const supprimer = useSupprimerDeMonEspaceParti({
    onMutate: () => setErreur(null),
    onSuccess: () => setChoisis([]),
    onError: (e: unknown) => setErreur(direLeRefus(e)),
    onSettled: async () => {
      setConfirmer(false);
      await qc.invalidateQueries({ queryKey: CLE });
    },
  });

  const occupe = telecharger.isPending || supprimer.isPending;
  const basculer = (id: string) =>
    setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div data-ecran="coffre" data-famille="papiers" className="flex min-h-0 flex-1 flex-col">
      <div className="pad">
        <h1>
          {t("statut.pme.mon_espace")}
          <Aide
            titre={t("statut.pme.mon_espace")}
            paragraphes={[{ texte: t("monespace.sous") }, { texte: t("monespace.aide") }]}
          />
        </h1>

        <CompteDesPapiers n={toutes.length} />

        {erreur ? (
          <div className="card" role="alert">
            <p>{erreur}</p>
          </div>
        ) : null}

        {pieces.isPending ? (
          <p className="foot">{t("common.loading")}</p>
        ) : pieces.isError ? (
          <div className="card" role="alert">
            <p>{texteDeLErreur(pieces.error, OU, t("common.error"))}</p>
          </div>
        ) : toutes.length === 0 ? (
          <div className="card">
            <p>{t("monespace.vide")}</p>
          </div>
        ) : (
          <>
            <GrilleDesMois
              papiers={toutes}
              moisDe={(p) => p.createdAt.slice(0, 7)}
              titreDe={(p) => p.societe}
              ligneDe={(p) => jourEtMois(p.createdAt, locale)}
              choisis={choix}
              basculer={basculer}
              occupe={occupe}
            />
            {/* Deux gestes de même poids, 48 px, le principal plein d'abord. */}
            <div className="gestes">
              <button
                type="button"
                className="pr"
                disabled={choix.length === 0 || occupe}
                onClick={() => telecharger.mutate(choix)}
              >
                {telecharger.isPending ? t("common.loading") : t("cab.review.telecharger")}
              </button>
              <button
                type="button"
                disabled={choix.length === 0 || occupe}
                onClick={() => setConfirmer(true)}
              >
                {t("pme.coffre.supprimer")}
              </button>
            </div>
            {remis ? <p className="foot">{remis}</p> : null}
          </>
        )}
      </div>

      {confirmer ? (
        <ConfirmerLaSuppression
          n={choix.length}
          enCours={supprimer.isPending}
          oui={() => supprimer.mutate(choix)}
          fermer={() => setConfirmer(false)}
        />
      ) : null}
    </div>
  );
}
