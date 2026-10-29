import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { FileLocale } from "@/components/malica/file-locale";
import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { Aide } from "@/components/malica/aide";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois, momentDeLEnvoi, montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { EcranEnvoye } from "@/components/malica/envoye";
import { office } from "@/verticals/malica-office/composition";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { clePiecesLues, usePiecesLues } from "@/hooks/use-pieces-lues";
import { useMonCabinet } from "@/hooks/use-mon-cabinet";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Mon espace — Malica Office" },
      {
        name: "description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:title", content: "Mon espace — Malica Office" },
      {
        property: "og:description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCoffre,
});

const OU = "routes/_authenticated/pme.coffre";

/** Un lot arrêté en route : ce qui est passé, ce qui reste, et pourquoi. */
class LotInterrompu extends Error {
  constructor(
    readonly faits: readonly string[],
    readonly restants: readonly string[],
    override readonly cause: unknown,
  ) {
    super("lot interrompu");
  }
}

/** Un geste sur chaque papier, l'un après l'autre ; s'il s'arrête, on sait où. */
async function unParUn(
  ids: readonly string[],
  geste: (id: string) => Promise<unknown>,
): Promise<readonly string[]> {
  const faits: string[] = [];
  for (const [i, id] of ids.entries()) {
    try {
      await geste(id);
    } catch (cause) {
      throw new LotInterrompu(faits, ids.slice(i), cause);
    }
    faits.push(id);
  }
  return faits;
}

/** Le mois d'une pièce, `AAAA-MM` : la date du document, sinon celle du dépôt. */
const moisDe = (p: PieceLue) => (p.dateDocument ?? p.createdAt).slice(0, 7);

/**
 * Mon espace — ce que vous gardez pour vous.
 *
 * ================================================ LE DESSIN DU 28 OCTOBRE 2026
 *
 * Maquette « Malica sans blocage », écran « Mon espace », validée par Wissem :
 * on reconnaît un papier à sa tête. Une grille de grandes miniatures, rangées
 * par mois ; un compte, « Mon espace · N papiers » ; deux gestes côte à côte,
 * « Mettre dans la société » et « Supprimer », sur les papiers choisis.
 *
 * Toucher un papier l'ouvre, comme partout ailleurs ; le rond de son coin le
 * choisit. Deux cibles, chacune de 44 points au moins, plutôt qu'un appui long
 * que personne ne devine. L'explication est dans le ⓘ du titre, pas à l'écran.
 *
 * ============================================ LE MUR EST TENU PAR LA BASE
 *
 * Seules les pièces `personnel` de leur auteur paraissent ici : la RLS ne rend
 * à personne d'autre — pas même au dirigeant — le Mon espace d'un siège
 * (`l-espace-prive-l-est-aussi-du-patron.test.ts`). La miniature passe par la
 * même RLS (`/pieces/:id/miniature`).
 *
 * ================================================== « METTRE DANS LA SOCIÉTÉ »
 *
 * Le libellé dit le geste : `vis` passe de `personnel` à `entite`, la
 * bibliothèque de la société — le même geste que « La dire à la société » sur
 * la fiche. Rien ne part chez le cabinet, et l'écran qui suit le DIT. Il porte
 * ensuite le geste que cet écran portait seul jusqu'ici, « Transmettre à
 * {cabinet} », et son écran « Envoyé » : la transmission reste une décision
 * séparée, à un geste de là, jamais un effet de bord.
 *
 * Avant ce dessin, « Transmettre » passait directement de `personnel` à
 * `partage`. Le libellé « Mettre dans la société » ne peut pas porter ce
 * geste-là sans mentir.
 *
 * ================================================== CE QUI RESTE DU DESSIN D'AVANT
 *
 * `.app` et `.nav` ne sont pas rendus — la coque et la barre du bas sont
 * tenues par `pme.tsx`. `-mx-4 -my-5` annule le `px-4 py-5` de son `<main>`.
 * La teinte de l'espace privé est peinte par la feuille, sur la coque, par
 * `:has([data-ecran="coffre"])` : cet écran n'a rien à poser pour elle.
 */
function PmeCoffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [erreur, setErreur] = useState<string | null>(null);
  /** Les papiers choisis, dans l'ordre où on les a touchés. */
  const [choisis, setChoisis] = useState<readonly string[]>([]);
  const [confirmer, setConfirmer] = useState(false);
  const feuille = useRef<HTMLDivElement | null>(null);
  useSuperposition(confirmer, () => setConfirmer(false), feuille);
  /** Ce qui vient d'entrer dans la société, puis ce qui vient de partir au cabinet. */
  const [misEnSociete, setMisEnSociete] = useState<readonly string[] | null>(null);
  const [transmis, setTransmis] = useState<readonly string[] | null>(null);

  const pieces = usePiecesLues();
  const cabinet = useMonCabinet(pme.tenantId);
  const nomDuCabinet = cabinet.data?.name ?? t("pme.coffre.votreComptable");

  const relire = async () => {
    await qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) });
    await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
  };

  /**
   * Un geste interrompu au milieu d'un lot se DIT : combien sont passés, et
   * ce qui reste — choisi, prêt à être repris. Jamais un état partiel muet.
   */
  const direLInterruption = (
    e: unknown,
    cle: "pme.coffre.partiel.mis" | "pme.coffre.partiel.supprimes",
  ) => {
    if (!(e instanceof LotInterrompu)) return texteDeLErreur(e, OU, t("common.error"));
    const raison = texteDeLErreur(e.cause, OU, t("common.error"));
    if (e.faits.length === 0) return raison;
    setChoisis(e.restants);
    const total = e.faits.length + e.restants.length;
    return `${t(cle, { faits: e.faits.length, total, count: e.restants.length })} ${raison}`;
  };

  const mettre = useMutation({
    mutationFn: (ids: readonly string[]) =>
      unParUn(ids, (id) => office().collab.setPieceVis(id, "entite")),
    onSuccess: async (ids) => {
      setErreur(null);
      setChoisis([]);
      await relire();
      setMisEnSociete(ids);
    },
    onError: async (e: unknown) => {
      setErreur(direLInterruption(e, "pme.coffre.partiel.mis"));
      await relire();
    },
  });

  const supprimer = useMutation({
    // `false` : la pièce n'est plus visible. Ce n'est pas un succès — le
    // journal le garde, comme sur la fiche.
    mutationFn: (ids: readonly string[]) =>
      unParUn(ids, async (id) => {
        if (!(await office().capture.supprimer(id)))
          throw new Error(`suppression sans effet : ${id}`);
      }),
    onSuccess: async () => {
      setErreur(null);
      setChoisis([]);
      setConfirmer(false);
      await relire();
    },
    onError: async (e: unknown) => {
      setConfirmer(false);
      setErreur(direLInterruption(e, "pme.coffre.partiel.supprimes"));
      await relire();
    },
  });

  const transmettre = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      // La décision est relue au dernier instant ; aucun destinataire n'est inventé.
      const destinataire = await office().identity.monCabinet(pme.tenantId);
      if (!destinataire) throw new Error(t("relation.sansDestinataire"));
      await office().collab.transmettreLesPieces([...ids]);
      return ids;
    },
    onSuccess: async (ids) => {
      setErreur(null);
      // Relire avant de dire : l'heure de la transmission vient de la base.
      await relire();
      setMisEnSociete(null);
      setTransmis(ids);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  // Seules les pièces gardées pour soi. Ce qui est dans la société se regarde
  // dans « Vos documents », avec son statut.
  const toutes = pieces.data ?? [];
  const visibles = toutes
    .filter((p) => p.vis === "personnel")
    .sort((a, b) => (b.dateDocument ?? b.createdAt).localeCompare(a.dateDocument ?? a.createdAt));

  /** Les mois, du plus récent au plus ancien, chacun avec ses papiers. */
  const parMois: { mois: string; papiers: PieceLue[] }[] = [];
  for (const p of visibles) {
    const m = moisDe(p);
    const dernier = parMois[parMois.length - 1];
    if (dernier?.mois === m) dernier.papiers.push(p);
    else parMois.push({ mois: m, papiers: [p] });
  }
  const anneeCourante = String(new Date().getUTCFullYear());
  const nomDuMois = (mois: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      ...(mois.startsWith(anneeCourante) ? {} : { year: "numeric" }),
      timeZone: "UTC",
    }).format(new Date(`${mois}-01T00:00:00Z`));

  // Le titre suit le STATUT : une pièce lue sans émetteur n'est pas une pièce
  // non lue. Voir pme.list.tsx.
  const titreDe = (p: PieceLue) =>
    p.emetteur ?? (p.status === "capturee" ? t("pme.list.nonLue") : t("pme.list.sansEmetteur"));
  const jour = (p: PieceLue) => jourEtMois(p.dateDocument ?? p.createdAt, locale);
  /**
   * Le montant, ou rien : « un montant absent n'est pas un montant nul ».
   * `montant(null)` rend la chaîne vide, et rien ne s'affiche.
   */
  const somme = (p: PieceLue) => {
    const rendu = montant(p.total, locale);
    return rendu === "" ? "" : `${rendu} ${p.devise ?? pme.currency}`;
  };

  const basculer = (id: string) =>
    setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  // Un choix qui a quitté l'espace (supprimé ailleurs, relu) ne compte plus.
  const choix = choisis.filter((id) => visibles.some((p) => p.id === id));
  const occupe = mettre.isPending || supprimer.isPending;

  const panne = pieces.error ?? null;

  /* ============================================================== ENVOYÉ
   *
   * Les papiers sont partis chez le cabinet : sans cet écran, ils
   * disparaîtraient de la grille sans un mot (maquette « Écran Envoyé », 27
   * octobre 2026). Les mots et l'heure viennent de la base relue.
   */
  const partis = transmis ? toutes.filter((p) => transmis.includes(p.id)) : [];
  const premier = partis[0];
  if (transmis && premier && partis.every((p) => p.vis === "partage")) {
    const quand = premier.transmiseLe ? momentDeLEnvoi(premier.transmiseLe, locale).quand : null;
    return (
      <EcranEnvoye
        titre={t("envoi.lot.tout", { count: partis.length })}
        quoi={
          quand
            ? partis.length === 1
              ? t("envoi.piece.chez", { piece: titreDe(premier), qui: nomDuCabinet, quand })
              : t("envoi.lot.chez", { count: partis.length, qui: nomDuCabinet, quand })
            : t("pme.transmettre.faite", { cabinet: nomDuCabinet })
        }
        suite={partis.length === 1 ? t("envoi.piece.suite", { qui: nomDuCabinet }) : null}
        trace={
          premier.transmiseLe
            ? t("envoi.trace", { qui: nomDuCabinet, jour: jourEtMois(premier.transmiseLe, locale) })
            : null
        }
        principale={{ libelle: t("envoi.coffre.retour"), action: () => setTransmis(null) }}
        secondaire={
          partis.length === 1
            ? {
                libelle: t("envoi.voir"),
                action: () =>
                  void navigate({
                    to: "/pme/piece/$pieceId",
                    params: { pieceId: premier.id },
                    search: { onglet: "suivi" },
                  }),
              }
            : null
        }
      />
    );
  }

  /* ================================================= DANS LA SOCIÉTÉ
   *
   * Le même écran de fin que tout passage : ce qui a bougé, et où. Rien n'est
   * parti chez le cabinet, et c'est écrit ; « Transmettre » est le geste
   * suivant, s'il y a un cabinet à qui transmettre.
   */
  const entres = misEnSociete ? toutes.filter((p) => misEnSociete.includes(p.id)) : [];
  const entre = entres[0];
  if (misEnSociete && entre && entres.every((p) => p.vis === "entite")) {
    return (
      <EcranEnvoye
        titre={t("pme.coffre.mis.titre")}
        quoi={
          <>
            {t("pme.coffre.mis.quoi", { count: entres.length, piece: titreDe(entre) })}
            {erreur ? (
              <span role="alert" className="mt-2 block text-signal-stop">
                {erreur}
              </span>
            ) : null}
          </>
        }
        suite={
          cabinet.data
            ? t("pme.coffre.mis.suite", { qui: nomDuCabinet })
            : // Sans cabinet, la raison de l'absence de « Transmettre » se dit ici.
              t("relation.sansDestinataire")
        }
        trace={null}
        principale={{ libelle: t("envoi.coffre.retour"), action: () => setMisEnSociete(null) }}
        secondaire={
          cabinet.data
            ? {
                libelle: t("pme.prive.transmettre", { cabinet: nomDuCabinet }),
                action: () => {
                  if (!transmettre.isPending) transmettre.mutate(entres.map((p) => p.id));
                },
              }
            : null
        }
      />
    );
  }

  return (
    <div
      data-ecran="coffre"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ─────────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          /*
           * DETTE, et elle est nommée : `common.retour` n'existe pas dans
           * `packages/socle/src/messages.ts`. Les retours du produit lisent une
           * clé rangée sous l'écran « à régler ». Le renommage appartient au
           * socle, pas à cet écran.
           */
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.nav.coffre")}</span>
        <span className="ic" aria-hidden>
          <IconeCadenas />
        </span>
      </div>

      <div className="pad">
        <h1>
          {t("pme.coffre.titre")}
          <Aide
            titre={t("pme.coffre.titre")}
            paragraphes={[
              { texte: t("pme.prive.sous") },
              { texte: t("pme.coffre.wall") },
              { texte: t("pme.coffre.choisir.aide") },
              { texte: t("pme.coffre.pied") },
            ]}
          />
        </h1>

        {visibles.length > 0 ? (
          <span className="compte" role="status">
            <i aria-hidden />
            {t("pme.coffre.compte", { count: visibles.length })}
          </span>
        ) : null}

        <FileLocale vis="personnel" />

        {panne || pieces.fetchStatus === "paused" ? (
          <div className="card" role="status">
            <p>
              {pieces.fetchStatus === "paused"
                ? t("common.horsLigne")
                : texteDeLErreur(panne, OU, t("common.error"))}
            </p>
            <button
              type="button"
              className="btn"
              disabled={pieces.fetchStatus === "paused"}
              onClick={() => void pieces.refetch()}
            >
              {t("common.reessayer")}
            </button>
          </div>
        ) : null}

        {erreur ? (
          <div className="card" role="alert">
            <p>{erreur}</p>
          </div>
        ) : null}

        {pieces.isPending && pieces.fetchStatus !== "paused" ? (
          <p className="foot">{t("common.loading")}</p>
        ) : !pieces.isSuccess && pieces.data === undefined ? null : visibles.length === 0 &&
          !pme.file.elements.some((e) => e.vis === "personnel") ? (
          <div className="card">
            <p>{t("pme.prive.vide")}</p>
          </div>
        ) : (
          <>
            {parMois.map(({ mois, papiers }) => (
              <section key={mois} className="mois" aria-label={nomDuMois(mois)}>
                <h2>{nomDuMois(mois)}</h2>
                <div className="grille">
                  {papiers.map((p) => {
                    const choisi = choix.includes(p.id);
                    return (
                      <div key={p.id} className={cn("tuile", choisi && "on")}>
                        <button
                          type="button"
                          className="ouvrir"
                          onClick={() =>
                            void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } })
                          }
                        >
                          <ApercuDePiece pieceId={p.id} />
                          <b>{titreDe(p)}</b>
                          <span className="dt">
                            {[jour(p), somme(p)].filter(Boolean).join(" · ")}
                          </span>
                          {p.status === "capturee" ? (
                            <EtatDeLecture
                              refus={p.lectureRefusee}
                              vis={p.vis}
                              lecture={p.lecture}
                              motifDitAilleurs="piece_personnelle"
                            />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="choix"
                          aria-pressed={choisi}
                          aria-label={t("pme.coffre.choisir", { piece: titreDe(p) })}
                          disabled={occupe}
                          onClick={() => basculer(p.id)}
                        >
                          <span aria-hidden>
                            <svg viewBox="0 0 24 24" className="g">
                              <path d="M5 12.5l4.5 4.5L19 7.5" />
                            </svg>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {visibles.length > 0 ? (
              <div className="gestes">
                <button
                  type="button"
                  className="pr"
                  disabled={choix.length === 0 || occupe}
                  onClick={() => mettre.mutate(choix)}
                >
                  {t("pme.coffre.mettre")}
                </button>
                <button
                  type="button"
                  disabled={choix.length === 0 || occupe}
                  onClick={() => setConfirmer(true)}
                >
                  {t("pme.coffre.supprimer")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {confirmer ? (
        <FeuilleDuBas
          titre={t("pme.coffre.supprimer.titre", { count: choix.length })}
          onFermer={() => setConfirmer(false)}
          feuilleRef={feuille}
          disposition="flex flex-col gap-4 pb-6"
          croix={false}
        >
          <p className="text-[15px] text-text-2">
            {t("pme.coffre.supprimer.sur", { count: choix.length })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={supprimer.isPending}
              onClick={() => supprimer.mutate(choix)}
              className="min-h-[48px] rounded-full bg-foreground text-[15px] font-semibold text-background disabled:opacity-40"
            >
              {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmer(false)}
              className="min-h-[48px] rounded-full border border-line-strong text-[15px] font-semibold"
            >
              {t("common.cancel")}
            </button>
          </div>
        </FeuilleDuBas>
      ) : null}
    </div>
  );
}

/**
 * Le cadenas — l'espace privé, dans la barre du haut. Il porte `class="g"`, la
 * seule règle d'icône commune aux écrans de la famille ; sa taille vient du
 * contexte (`.top .ic svg`).
 */
function IconeCadenas() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}
