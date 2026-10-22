import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import portraitMalica from "@/assets/malica.webp";
import { FileLocale } from "@/components/malica/file-locale";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { useMoisDeLExercice } from "@/hooks/use-mois-de-l-exercice";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { motifDeLEtat, refusDuPlafond } from "@/lib/champ-lisible";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre } from "@/lib/forfait";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import type { NatureTiers, PieceLue } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/list")({
  head: () => ({
    meta: [
      { title: "Vos documents — Malica Office" },
      {
        name: "description",
        content: "Ce que Malica a lu et classé, par mois ou par année.",
      },
      { property: "og:title", content: "Vos documents — Malica Office" },
      {
        property: "og:description",
        content: "Ce que Malica a lu et classé, par mois ou par année.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VosDocuments,
});

/*
 * ===========================================================================
 *
 *   LES CHAÎNES QUI N'ONT PAS ENCORE DE CLÉ — ET QUI EN ATTENDENT UNE
 *
 * Le dessin de la bibliothèque introduit un vocabulaire que
 * `packages/socle/src/messages.ts` ne porte pas encore : le nom des trois
 * nouveaux axes, le mot « pièces » seul (sans son nombre — `pme.doc.compte`
 * les porte ensemble et ne se coupe pas), la légende des trois états du
 * calendrier, et la remarque de Malica sur ce qui manque.
 *
 * Elles sont rassemblées ICI, en un seul bloc nommé, et nulle part ailleurs
 * dans le fichier. C'est une dette VISIBLE, pas une dispersion : le jour où
 * les clés entrent au dictionnaire dans les trois langues, ce bloc disparaît
 * d'un coup et chaque usage devient un `t(...)`. Tant qu'il est là, l'écran
 * est en français pour ces huit libellés — et il le dit.
 *
 * Tout le reste de l'écran passe par `t()` : « Mois » est `pme.vue.mois`,
 * « Année » est `pme.vue.annee`, « Achats » et « Ventes » sont
 * `pme.doc.type.*`, « Client » et « Fournisseur » sont `plan.nature.*`, le
 * compte de pièces est `pme.doc.compte`, ce qui n'est pas lu est
 * `pme.doc.lead.nonLues`, le plafond est `pme.refus.plafond_atteint`.
 */
const TEXTES = {
  regrouperPar: "Regrouper par",
  axeDossier: "Dossier",
  axeTiers: "Tiers",
  axeOperation: "Type d'opération",
  pieces: "pièces",
  tiers: "tiers",
  retour: "Retour",
  vueListe: "Liste",
  voirTout: (n: number) => `Voir les ${n}`,
  replier: "Replier",
  pasEncoreRecu: (mois: string) => `${mois} pas encore reçu`,
  legendeRecue: "Reçue",
  legendeAttendue: "Attendue, pas encore là",
  legendeRien: "Rien attendu",
  manquants: (n: number, mois: string, liste: string) =>
    n === 1
      ? `Un ensemble récurrent n'a rien reçu en ${mois} : ${liste}. Les mois précédents en portent une chaque fois.`
      : `${n} ensembles récurrents n'ont rien reçu en ${mois} : ${liste}. Les mois précédents en portent une chaque fois.`,
} as const;

type Axe = "mois" | "dossier" | "tiers" | "op";
type Vue = "liste" | "annee";
/**
 * Le sens d'une pièce — et c'est exactement l'ancien filtre de cet écran.
 *
 * Notre contrat de lecture ne connaît que `facture_achat` et `facture_vente`.
 * Les pastilles sont donc construites SUR CE QUI EXISTE réellement dans le
 * dossier, jamais sur la liste de la maquette : un filtre « Banque » qui ne
 * rend jamais rien apprend au dirigeant à ne plus toucher les filtres.
 */
type Sens = "tous" | "facture_achat" | "facture_vente";

/** Combien de lignes de groupes avant que « Voir les N » ne paraisse. */
const PREMIERS = 9;

/** Un entier rendu par la base, ou l'absence — qui s'écrit « — », jamais « 0 ». */
function compte(valeur: number | string | null | undefined): string {
  const n = nombre(valeur);
  return n === null ? "—" : String(n);
}

/** Ce qu'un groupe porte, une fois les pièces rassemblées sur l'axe choisi. */
interface Groupe {
  /** La clé de l'axe. `""` quand la pièce ne la porte pas encore. */
  cle: string;
  pieces: PieceLue[];
  /** Les montants CONNUS, en chaînes décimales du Socle. */
  achats: string[];
  ventes: string[];
  /** Combien de pièces du groupe n'ont pas encore été lues. */
  nonLues: number;
  /** Les mois de l'exercice où le groupe se présente, par index de colonne. */
  mois: Set<number>;
  /** Les types d'opération présents. */
  ops: Set<string>;
  /** Vrai quand TOUTES les pièces sont des ventes : c'est un client. */
  queDesVentes: boolean;
}

/**
 * La bibliothèque — le dessin validé (`livraison/ecrans/malica-bibliotheque.html`,
 * premier bloc `.app`), porté tel quel.
 *
 * ============================================================== CE QUI A CHANGÉ
 *
 * Le balisage, et les QUATRE AXES que le câblage demande. Les requêtes sont
 * celles d'avant (`capture.listAvecLecture` sur la clé `pieces-lues`, que le
 * layout invalide après chaque capture), plus trois lectures de référentiel
 * qui n'inventent rien et que d'autres écrans chargent déjà sur les mêmes
 * clés de cache :
 *
 *   — `charges.articles` donne, pour chaque pièce, SON DOSSIER (`familleCode`).
 *     C'est le seul pont qui existe : `PieceLue` ne porte pas de famille, et
 *     l'axe « par dossier » serait sinon une invention ;
 *   — `charges.familles` traduit ce code en nom lisible ;
 *   — `referentiel.typesDeDocument` traduit `kind` en « Achat », « Vente » ;
 *   — `tiers.lister` dit si un émetteur est un client ou un fournisseur.
 *
 * ========================================== UN ÉCRAN, UNE FENÊTRE DE DONNÉES
 *
 * Le câblage écrit « `capture.listAvecLecture` pour la vue liste,
 * `capture.lister` pour la grille annuelle ». Les deux vues sont ici servies
 * par `listAvecLecture` SEUL, et c'est délibéré : `capture.list` rend les
 * mêmes lignes avec moins (ni émetteur, ni type, ni total), la grille
 * annuelle n'a besoin que des dates que `listAvecLecture` porte déjà, et
 * deux appels pour un même jeu de pièces doubleraient l'ouverture de l'écran
 * sur un téléphone d'entrée de gamme. Si la liste devait un jour être
 * paginée, c'est à ce moment que la grille prendrait son propre appel.
 *
 * La cadence (mensuel / bimestriel / trimestriel) et l'anneau « il en manque
 * un » se calculent DANS LE CLIENT, sur les données déjà chargées — c'est un
 * calcul, pas une requête.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte déjà toutes les règles du dessin sous
 * `[data-surface="pme"] [data-ecran="bibliotheque"]`. Cet écran pose donc
 * `data-ecran="bibliotheque"` sur sa racine et n'emploie QUE les classes
 * relevées dans cette feuille — `.top .ttl .per .bk .pad .sub .lab .axe .ch
 * .vu .fil .sec .ret .grp .bd .k .v .miss .n .lines .pc .hd .nm .vl .rec .mt
 * .tag .dim .more .yr .d .ok .miss .none .fut .lgd .ceil .note .foot .g`.
 * Aucune classe utilitaire par-dessus : une seule d'entre elles contredirait
 * le dessin.
 *
 * `.app` n'est PAS rendu — la règle portée réservait la place de la rangée de
 * démonstration des forfaits, qui n'existe pas dans l'application ; le cadre
 * est tenu par le layout. `.nav` non plus : la barre du bas est rendue par
 * `pme.tsx`, une fois pour tous les écrans PME.
 *
 * ================================================== L'ABONNEMENT NE S'AFFICHE PAS
 *
 * La rangée « Basic · Solo · Team · Premium » est une affordance de maquette.
 * Ici l'offre se voit à UN endroit : le compteur de lectures de l'en-tête, et
 * le bandeau du plafond quand des pièces sont réellement bloquées. Les deux
 * lisent `pme.forfait`, que le layout a chargé une fois.
 *
 * ============================================ CE QUI N'EST PAS BRANCHÉ, ET POURQUOI
 *
 * Le champ de recherche du dessin est un `<span>` décoratif dans la maquette,
 * et la feuille ne style que `.srch span` : le porter demanderait une règle
 * `.srch input` qui n'existe pas. Il n'est donc pas rendu, plutôt que rendu
 * mort — voir le rapport de conversion.
 *
 * Le bouton « Me le rappeler le 28 » de la remarque n'a aucun appel au
 * contrat : aucun dépôt ne pose un rappel. La remarque est rendue, le bouton
 * non — un bouton qui ne fait rien est pire que son absence.
 *
 * Les deux rangées de filtres « sociétés » et « sièges » attendent une donnée
 * que `PieceLue` ne porte pas : `capture.pieces.created_by` (le siège qui a
 * saisi) n'est pas exposé par `listAvecLecture`. Elles ne sont pas rendues
 * plutôt que rendues fausses.
 *
 * (Ce qui précède décrit `VosDocuments`, plus bas ; le lot de transmission
 * qu'il affiche vit juste ici.)
 */
/**
 * Transmettre d'un geste ce qui est resté chez la société (ANO-LIVE-003).
 *
 * Seules partent les pièces de la société qui n'ont pas été transmises et
 * dont le dirigeant n'a pas DÉCIDÉ de les garder : l'espace privé ne part
 * jamais en lot, et une décision de garder n'est pas défaite par un bouton
 * de masse. Deux touches : la première arme, la seconde engage.
 */
function TransmettreCeQuiReste({ pieces }: { pieces: readonly PieceLue[] }) {
  const { t } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [armee, setArmee] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);
  const restantes = pieces.filter(
    (p) => p.vis === "entite" && !p.gardeeLe && p.status !== "retournee",
  );
  const transmettre = useMutation({
    mutationFn: () => office().collab.transmettreLesPieces(restantes.map((p) => p.id)),
    onSuccess: async (r) => {
      setArmee(false);
      setRetour(t("pme.list.transmettre.fait", { count: r.transmises }));
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
    },
    onError: (e: unknown) => {
      setArmee(false);
      setRetour(texteDeLErreur(e, "routes/_authenticated/pme.list", t("common.error")));
    },
  });
  if (!pme.aUnCabinet || (restantes.length === 0 && !retour)) return null;
  return (
    <div className="card">
      {restantes.length > 0 ? (
        <>
          <p className="t-body">{t("pme.list.transmettre.reste", { count: restantes.length })}</p>
          <button
            type="button"
            className="btn"
            disabled={transmettre.isPending}
            onClick={() => (armee ? transmettre.mutate() : (setArmee(true), setRetour(null)))}
          >
            {transmettre.isPending
              ? t("common.loading")
              : armee
                ? t("pme.list.transmettre.confirmer", { count: restantes.length })
                : t("pme.list.transmettre.action")}
          </button>
        </>
      ) : null}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

function VosDocuments() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();

  const [vue, setVue] = useState<Vue>("liste");
  const [axe, setAxe] = useState<Axe>("mois");
  const [sens, setSens] = useState<Sens>("tous");
  /** Le groupe ouvert, ou `null` : la liste des groupes. */
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [tout, setTout] = useState(false);

  const periode = currentPeriod();
  const moisDeLExercice = useMoisDeLExercice(periode);

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const toutes = useMemo(() => pieces.data ?? [], [pieces.data]);

  /*
   * ---------------------------------------------------------- les bornes de l'exercice
   *
   * Nommées, et dans cet ordre : une plage inversée rend vide sans erreur.
   */
  const premierMois = moisDeLExercice[0]?.periode ?? periode;
  const dernierMois = moisDeLExercice[moisDeLExercice.length - 1]?.periode ?? periode;
  /** L'exercice porte son millésime dans la pastille du haut. */
  const millesime = dernierMois.slice(0, 4);

  /*
   * LE DOSSIER D'UNE PIÈCE — le seul pont qui existe.
   *
   * `PieceLue` ne porte pas de famille de charges. `charges.articles` oui,
   * ligne par ligne, avec le `pieceId` : une pièce prend donc le dossier de
   * son premier article. Un seul appel pour l'exercice entier, sur la clé que
   * l'écran des charges emploie déjà.
   */
  const articles = useQuery({
    queryKey: ["charges-articles", pme.tenantId, premierMois, dernierMois],
    queryFn: () => office().charges.articles(pme.tenantId, premierMois, dernierMois),
  });

  const familles = useQuery({
    queryKey: ["charges-familles", pme.packId, locale],
    enabled: !!pme.packId,
    queryFn: () => office().charges.familles(pme.packId!, locale),
  });

  /** Le nom d'un type de document vient du référentiel traduit, jamais du code. */
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });

  /**
   * Les tiers du dossier — pour dire « Client » ou « Fournisseur ».
   *
   * `null` en nature : toutes, en un appel. L'écran ne crée pas de tiers, il
   * se contente de reconnaître celui que la lecture a relevé.
   */
  const tiers = useQuery({
    queryKey: ["tiers", pme.tenantId, null],
    queryFn: () => office().tiers.lister(pme.tenantId, null),
    staleTime: 10 * 60 * 1000,
  });

  const dossierParPiece = useMemo(() => {
    const carte = new Map<string, string>();
    for (const a of articles.data ?? []) {
      if (!carte.has(a.pieceId)) carte.set(a.pieceId, a.familleCode);
    }
    return carte;
  }, [articles.data]);

  const nomDuDossier = (code: string) =>
    (familles.data ?? []).find((f) => f.code === code)?.label ?? code;

  /**
   * La nature d'un émetteur, quand un tiers du dossier porte ce nom.
   *
   * Comparaison sur la raison sociale, insensible à la casse : c'est tout ce
   * que la lecture rend. Rien de deviné — sans correspondance, la nature est
   * `null` et l'écran se tait là-dessus.
   */
  const natureParNom = useMemo(() => {
    const carte = new Map<string, NatureTiers>();
    for (const x of tiers.data ?? []) {
      carte.set(x.raisonSociale.trim().toLocaleLowerCase(locale), x.nature);
    }
    return carte;
  }, [tiers.data, locale]);

  const natureDe = (nom: string): NatureTiers | null =>
    natureParNom.get(nom.trim().toLocaleLowerCase(locale)) ?? null;

  /** Le mois d'une pièce : celui du DOCUMENT s'il est lu, sinon celui du dépôt. */
  const moisDe = (p: PieceLue) => (p.dateDocument ?? p.createdAt).slice(0, 7);

  /** La colonne de la grille annuelle où un mois tombe, ou -1 hors exercice. */
  const colonneDe = (periodeDuMois: string) =>
    moisDeLExercice.findIndex((m) => m.periode === periodeDuMois);

  /** La dernière colonne qui a déjà eu lieu. Les suivantes sont `fut`. */
  const colonneCourante = useMemo(() => {
    let dernier = -1;
    moisDeLExercice.forEach((m, i) => {
      if (!m.aVenir) dernier = i;
    });
    return dernier;
  }, [moisDeLExercice]);

  const nomDuMois = (p: string, court = false) =>
    new Intl.DateTimeFormat(locale, {
      month: court ? "short" : "long",
      timeZone: "UTC",
    }).format(new Date(`${p}-01T00:00:00Z`));

  /** L'initiale d'un mois, pour l'en-tête de la grille annuelle. */
  const initialeDuMois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "narrow", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  const jour = (p: PieceLue) => {
    const iso = p.dateDocument ?? p.createdAt;
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  };

  const nomDuType = (code: string) =>
    (typesDoc.data ?? []).find((x) => x.code === code)?.libelle ??
    (code === "facture_achat"
      ? t("pme.doc.type.achats")
      : code === "facture_vente"
        ? t("pme.doc.type.ventes")
        : t("pme.doc.type.autre"));

  // ------------------------------------------------------------------ le filtre
  // Les types réellement présents dans le dossier, et eux seuls.
  const typesPresents = useMemo(() => {
    const vus = new Set(toutes.map((p) => p.kind).filter((k): k is NonNullable<typeof k> => !!k));
    return [...vus];
  }, [toutes]);

  const visibles = useMemo(
    () => (sens === "tous" ? toutes : toutes.filter((p) => p.kind === sens)),
    [toutes, sens],
  );

  // ------------------------------------------------------------------ l'en-tête
  const nombreDeTiers = useMemo(
    () => new Set(visibles.map((p) => p.emetteur).filter((e): e is string => !!e)).size,
    [visibles],
  );

  const f = pme.forfait.ligne;

  /*
   * ================================================= LE PLAFOND, QUAND IL MORD
   *
   * Pas « quand l'offre est Basic » : quand des pièces sont RÉELLEMENT
   * bloquées. Le motif vient de la base (`plafond_atteint`) et se lit par le
   * même chemin que la liste des pièces — `motifDeLEtat` dérive aussi le cas
   * de la pièce privée, qui n'attend rien et ne compte donc pas ici.
   */
  const auPlafond = useMemo(
    () =>
      toutes.filter((p) => {
        const motif = motifDeLEtat(p.lectureRefusee, p.vis);
        return motif !== null && refusDuPlafond(motif);
      }).length,
    [toutes],
  );

  // --------------------------------------------------------------- les groupes
  const cleDe = (p: PieceLue): string => {
    if (axe === "mois") return moisDe(p);
    if (axe === "dossier") return dossierParPiece.get(p.id) ?? "";
    if (axe === "tiers") return p.emetteur ?? "";
    return p.kind ?? "";
  };

  const groupes = useMemo<Groupe[]>(() => {
    const carte = new Map<string, Groupe>();
    for (const p of visibles) {
      const cle = cleDe(p);
      let g = carte.get(cle);
      if (!g) {
        g = {
          cle,
          pieces: [],
          achats: [],
          ventes: [],
          nonLues: 0,
          mois: new Set<number>(),
          ops: new Set<string>(),
          queDesVentes: true,
        };
        carte.set(cle, g);
      }
      g.pieces.push(p);
      if (p.status === "capturee") g.nonLues += 1;
      if (p.total !== null) {
        if (p.kind === "facture_vente") g.ventes.push(p.total);
        else g.achats.push(p.total);
      }
      if (p.kind !== "facture_vente") g.queDesVentes = false;
      const colonne = colonneDe(moisDe(p));
      if (colonne >= 0) g.mois.add(colonne);
      if (p.kind) g.ops.add(p.kind);
    }

    const sortie = [...carte.values()];
    // Par mois, le plus récent devant ; sur les autres axes, le plus gros.
    if (axe === "mois") sortie.sort((a, b) => b.cle.localeCompare(a.cle));
    else sortie.sort((a, b) => poids(b) - poids(a));
    return sortie;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibles, axe, dossierParPiece, moisDeLExercice]);

  /*
   * ------------------------------------------------------------- la cadence
   *
   * Une pièce manquante n'a de sens que si on sait à quel rythme elle vient.
   * On lit l'écart le plus fréquent entre deux présences : 1 = mensuel,
   * 2 = bimestriel, 3 = trimestriel. Un rythme irrégulier n'attend rien, et
   * on ne réclame JAMAIS ce qui n'était pas attendu.
   *
   * Quatre présences au minimum, et sept écarts sur dix qui s'accordent : en
   * dessous, « il en manque un » serait une accusation sans preuve.
   */
  const cadence = (g: Groupe): { pas: number; premier: number } | null => {
    const mois = [...g.mois].filter((i) => i <= colonneCourante).sort((a, b) => a - b);
    if (mois.length < 4) return null;
    const ecarts = mois.slice(1).map((v, i) => v - mois[i]!);
    const vus = new Map<number, number>();
    let mode = ecarts[0]!;
    for (const e of ecarts) {
      const n = (vus.get(e) ?? 0) + 1;
      vus.set(e, n);
      if (n > (vus.get(mode) ?? 0)) mode = e;
    }
    if (vus.get(mode)! / ecarts.length < 0.7 || mode > 3) return null;
    return { pas: mode, premier: mois[0]! };
  };

  const attendu = (g: Groupe, colonne: number) => {
    const c = cadence(g);
    if (c === null) return false;
    return colonne > c.premier && colonne <= colonneCourante && (colonne - c.premier) % c.pas === 0;
  };

  /**
   * Il en manque un : le groupe était attendu ce mois-ci, et rien n'est venu.
   *
   * Jamais sur l'axe des mois — un mois absent de la liste n'est pas un mois
   * qui manque, c'est un mois sans pièce, et il le dit déjà en n'étant pas là.
   */
  const manquant = (g: Groupe) =>
    axe !== "mois" && attendu(g, colonneCourante) && !g.mois.has(colonneCourante);

  const titreDuGroupe = (cle: string): string => {
    if (cle === "") return t("pme.doc.type.autre");
    if (axe === "mois") return `${nomDuMois(cle)} ${cle.slice(0, 4)}`;
    if (axe === "dossier") return nomDuDossier(cle);
    if (axe === "op") return nomDuType(cle);
    return cle;
  };

  const sousTitre = (g: Groupe): string => {
    const morceaux: string[] = [];
    if (axe === "tiers" && g.cle !== "") {
      const nature = natureDe(g.cle);
      if (nature !== null) morceaux.push(t(`plan.nature.${nature}` as never));
    }
    for (const op of g.ops) morceaux.push(nomDuType(op));
    if (g.nonLues > 0) morceaux.push(t("pme.doc.lead.nonLues", { count: g.nonLues }));
    return morceaux.join(" · ");
  };

  const moisCourantLisible = nomDuMois(moisDeLExercice[colonneCourante]?.periode ?? periode);

  // ------------------------------------------------------------ la vue annuelle
  /*
   * Les totaux de l'exercice. Ils additionnent ce qui est CONNU — en décimal
   * exact, jamais en flottant — et la phrase d'à côté dit combien de pièces
   * n'ont pas encore de montant. Un total qui compte l'absence pour zéro
   * serait un mensonge, pas une approximation.
   */
  const montantsConnus = useMemo(
    () => toutes.filter((p) => p.total !== null).map((p) => p.total!),
    [toutes],
  );
  const totalExercice = montantsConnus.length === 0 ? null : sommeDecimale(montantsConnus);
  const sansMontant = toutes.length - montantsConnus.length;

  // -------------------------------------------------------------- les gestes
  const choisirAxe = (suivant: Axe) => {
    setAxe(suivant);
    setOuvert(null);
    setTout(false);
  };

  const choisirVue = (suivante: Vue) => {
    setVue(suivante);
    setOuvert(null);
    // En vue annuelle, les mois SONT les colonnes : on ne regroupe pas par mois.
    if (suivante === "annee" && axe === "mois") setAxe("dossier");
  };

  const groupeOuvert = ouvert === null ? null : (groupes.find((g) => g.cle === ouvert) ?? null);
  const vusDansLaListe = tout ? groupes : groupes.slice(0, PREMIERS);
  const manquent = groupeOuvert === null ? groupes.filter(manquant) : [];

  const axes: Array<{ cle: Axe; nom: string }> = [
    { cle: "mois", nom: t("pme.vue.mois") },
    { cle: "dossier", nom: TEXTES.axeDossier },
    { cle: "tiers", nom: TEXTES.axeTiers },
    { cle: "op", nom: TEXTES.axeOperation },
  ];

  return (
    /*
     * `data-ecran="bibliotheque"` : le marqueur qui fait descendre sur cet arbre
     * les règles du dessin. Les marges négatives annulent le `px-4 py-5` du
     * layout — `.top` et `.pad` portent les leurs, et le dessin ne veut pas de
     * double gouttière.
     */
    <div data-ecran="bibliotheque" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      {/*
       * La barre du dessin : le retour, le nom de l'écran, le millésime de
       * l'exercice. Elle ne redit pas ce que l'en-tête du layout porte — le
       * dossier et ses portes — elle nomme l'ÉCRAN, et le millésime vient de
       * la fiche du dossier, pas de l'horloge.
       */}
      <div className="top">
        {/*
         * `t("pme.regler.retour")` et non `TEXTES.retour`.
         *
         * Le retour de cet ecran portait « Retour » en dur, en francais
         * seulement : en arabe et en anglais, un lecteur d'ecran annoncait
         * « Retour ». C'est la cle que portent deja les neuf autres `.bk` du
         * produit, et elle est traduite dans les trois langues.
         *
         * `TEXTES.retour` reste employe plus bas, sur le bouton qui replie un
         * GROUPE — un autre geste, dans le corps de l'ecran, et une autre
         * dette ; celle-ci n'est pas aggravee ici.
         */}
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <Chevron gauche />
        </button>
        <span className="ttl">{t("pme.list.title")}</span>
        <span className="per">{millesime}</span>
      </div>

      <div className="pad">
        <h1>{t("pme.doc.titre")}</h1>

        {/*
         * Deux lignes, et rien de fabriqué : ce que le dossier contient, et ce
         * que le forfait laisse. Les deux bornes du compteur s'écrivent « — »
         * tant qu'on ne les sait pas — chargement, échec ou licence absente
         * sont la même chose à l'écran, et l'écran le dit d'une seule façon.
         */}
        <p className="sub">
          {t("pme.doc.compte", { count: visibles.length })}
          {nombreDeTiers > 0 ? ` · ${nombreDeTiers} ${TEXTES.tiers}` : ""}
          <br />
          {compte(f?.lectures_restantes)} / {compte(f?.lectures_droit)} · {t("pme.home.lectures")}
        </p>

        <TransmettreCeQuiReste pieces={toutes} />

        {/* --------------------------------------------- l'axe et les deux formes */}
        <p className="lab">{TEXTES.regrouperPar}</p>
        <div className="axe">
          <span className="ch">
            {axes
              .filter((a) => !(vue === "annee" && a.cle === "mois"))
              .map((a) => (
                <button
                  key={a.cle}
                  type="button"
                  className={cn(axe === a.cle && "on")}
                  aria-pressed={axe === a.cle}
                  onClick={() => choisirAxe(a.cle)}
                >
                  {a.nom}
                </button>
              ))}
          </span>
          <span className="vu">
            <button
              type="button"
              className={cn(vue === "liste" && "on")}
              aria-label={TEXTES.vueListe}
              aria-pressed={vue === "liste"}
              onClick={() => choisirVue("liste")}
            >
              <IconeListe />
            </button>
            <button
              type="button"
              className={cn(vue === "annee" && "on")}
              aria-label={t("pme.vue.annee")}
              aria-pressed={vue === "annee"}
              onClick={() => choisirVue("annee")}
            >
              <IconeCalendrier />
            </button>
          </span>
        </div>

        {/*
         * ===================================== L'IMPORT DE FICHIERS, TOUJOURS LÀ
         *
         * 11 octobre 2026 : « et l'upload plusieurs doc pdf ? » Le chemin
         * existait dans le code et aucun écran ne l'appelait. Le dessin de la
         * bibliothèque ne le montre pas — il n'a pas été dessiné — mais c'est
         * l'écran du rattrapage, celui où l'on vient quand un mois est en
         * retard, et le retirer rendrait les PDF de nouveau inatteignables.
         *
         * Il prend donc la forme du dessin : une pastille de la rangée des
         * filtres, à sa place, sans une classe utilitaire par-dessus.
         */}
        <div className="fil">
          <button type="button" disabled={pme.capturing} onClick={() => pme.capture("pdf")}>
            {t("pme.doc.importer")}
          </button>
        </div>

        {/* Les types réellement présents dans le dossier, et « tous » devant. */}
        {typesPresents.length > 1 ? (
          <div className="fil">
            {(["tous", ...typesPresents] as Sens[]).map((c) => (
              <button
                key={c}
                type="button"
                className={cn(c === sens && "on")}
                aria-pressed={c === sens}
                onClick={() => {
                  setSens(c);
                  setOuvert(null);
                  setTout(false);
                }}
              >
                {c === "tous" ? t("pme.doc.type.tous") : nomDuType(c)}
              </button>
            ))}
          </div>
        ) : null}

        {/*
         * ===================================================== LE PLAFOND DE LECTURES
         *
         * Il ne paraît que lorsqu'il MORD : des pièces capturées, refusées
         * pour cause de plafond, et rangées. Le compte vient des pièces
         * elles-mêmes, le droit vient du forfait, et la phrase vient du
         * dictionnaire — c'est la même qu'au dossier d'une pièce, parce que
         * c'est le même fait.
         */}
        {auPlafond > 0 ? (
          <div className="ceil" role="status">
            <i aria-hidden />
            <p>
              <b>{t("pme.doc.lead.nonLues", { count: auPlafond })}</b>{" "}
              {t("pme.refus.plafond_atteint")}
            </p>
          </div>
        ) : null}

        {/* ------------------------------------------------------------- le corps */}
        {pieces.isPending ? (
          <p className="sub">{t("common.loading")}</p>
        ) : toutes.length === 0 ? (
          <p className="sub">{t("pme.list.empty")}</p>
        ) : groupeOuvert !== null ? (
          <>
            <div className="sec">
              <h2>{titreDuGroupe(groupeOuvert.cle)}</h2>
              <button type="button" className="ret" onClick={() => setOuvert(null)}>
                {TEXTES.retour}
              </button>
            </div>
            <p className="sub">
              {t("pme.doc.compte", { count: groupeOuvert.pieces.length })}
              {groupeOuvert.achats.length > 0
                ? ` · ${t("pme.doc.type.achats")} ${montant(sommeDecimale(groupeOuvert.achats), locale)}`
                : ""}
              {groupeOuvert.ventes.length > 0
                ? ` · ${t("pme.doc.type.ventes")} ${montant(sommeDecimale(groupeOuvert.ventes), locale)}`
                : ""}
            </p>
            <div className="lines">
              {groupeOuvert.pieces.map((p) => (
                <Link
                  key={p.id}
                  to="/pme/piece/$pieceId"
                  params={{ pieceId: p.id }}
                  className={cn("pc", p.status === "capturee" && "dim")}
                >
                  <span className="hd">
                    {/*
                     * ================================ LE TITRE NE MENT PLUS
                     *
                     * Il valait `p.emetteur ?? "Pas encore lue"` : dès que
                     * l'émetteur manquait, la ligne annonçait une pièce non
                     * lue — y compris quand l'état juste en dessous affichait
                     * « Lue ». Deux phrases contradictoires sur la même ligne,
                     * et c'est celle du haut qu'on croit.
                     */}
                    <span className="nm">
                      {p.emetteur ??
                        (p.status === "capturee"
                          ? t("pme.list.nonLue")
                          : t("pme.list.sansEmetteur"))}
                    </span>
                    {/*
                     * Une pièce non lue n'a pas de montant : elle affiche « — »
                     * et compte quand même dans le groupe, parce qu'elle a bien
                     * été déposée. « 0,000 » serait un fait comptable.
                     */}
                    <span className={cn("vl", p.kind === "facture_vente" && "rec")}>
                      {p.total === null ? "—" : montant(p.total, locale)}
                    </span>
                  </span>
                  <span className="mt">
                    {[
                      dossierParPiece.has(p.id) ? nomDuDossier(dossierParPiece.get(p.id)!) : null,
                      p.kind ? nomDuType(p.kind) : null,
                    ]
                      .filter((x): x is string => !!x)
                      .join(" · ") || "—"}
                  </span>
                  <span className="mt">{jour(p)}</span>
                  {/*
                   * ================= UNE PIÈCE NON LUE N'EST PAS UNE PIÈCE QUI ATTEND
                   *
                   * `capturee` recouvrait deux états que rien ne séparait :
                   * « je vais la lire » et « je ne l'ai PAS lue ». Le dirigeant
                   * au plafond de son forfait voyait le même mot que celui dont
                   * la facture part en lecture dans la seconde.
                   */}
                  {p.status === "capturee" ? (
                    <EtatDeLecture refus={p.lectureRefusee} vis={p.vis} />
                  ) : (
                    <span className={cn("tag", p.status === "retournee" && "ve")}>
                      <i aria-hidden />
                      {t(`pme.status.${p.status}` as never)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </>
        ) : vue === "liste" ? (
          <>
            <div className="sec">
              <h2>{axes.find((a) => a.cle === axe)!.nom}</h2>
              <span>{groupes.length}</span>
            </div>
            {vusDansLaListe.map((g) => (
              <button
                key={g.cle}
                type="button"
                className="grp"
                onClick={() => {
                  setOuvert(g.cle);
                  window.scrollTo(0, 0);
                }}
              >
                <i className={cn(g.queDesVentes && "cli")}>
                  <GlypheDeLAxe axe={axe} vente={g.queDesVentes} />
                </i>
                <span className="bd">
                  <b>{titreDuGroupe(g.cle)}</b>
                  {manquant(g) ? (
                    <span className="miss">{TEXTES.pasEncoreRecu(moisCourantLisible)}</span>
                  ) : (
                    <span className="k">{sousTitre(g)}</span>
                  )}
                  <span className="v">
                    {g.achats.length === 0 && g.ventes.length === 0 ? "—" : null}
                    {g.achats.length > 0
                      ? `${t("pme.doc.type.achats")} ${montant(sommeDecimale(g.achats), locale)}`
                      : null}
                    {g.achats.length > 0 && g.ventes.length > 0 ? " · " : null}
                    {g.ventes.length > 0 ? (
                      <u>
                        {t("pme.doc.type.ventes")} {montant(sommeDecimale(g.ventes), locale)}
                      </u>
                    ) : null}
                  </span>
                </span>
                <span className="n">
                  <b>{g.pieces.length}</b>
                  <span>{TEXTES.pieces}</span>
                </span>
              </button>
            ))}
            {groupes.length > PREMIERS ? (
              <button type="button" className="more" onClick={() => setTout(!tout)}>
                {tout ? TEXTES.replier : TEXTES.voirTout(groupes.length)}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="sec">
              <h2>{millesime}</h2>
              <span>
                {groupes.length} × {moisDeLExercice.length}
              </span>
            </div>
            {/*
             * Les totaux de l'exercice, avec ce qu'ils ne contiennent pas :
             * `pme.doc.depuis` nomme le chiffre, `pme.doc.lead.nonLues` dit
             * combien de pièces n'en font pas encore partie.
             */}
            <p className="sub">
              {t("pme.doc.depuis")} ·{" "}
              {totalExercice === null ? "—" : montant(totalExercice, locale)} {pme.currency}
              <br />
              {t("pme.doc.bilan", { count: toutes.length })}
              {sansMontant > 0 ? ` ${t("pme.doc.lead.nonLues", { count: sansMontant })}` : ""}
            </p>
            <div className="yr">
              <table>
                <thead>
                  <tr>
                    {/* La colonne des noms n'a pas d'en-tête : le dessin la laisse vide. */}
                    <th />
                    {moisDeLExercice.map((m) => (
                      <th key={m.periode}>{initialeDuMois(m.periode)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupes.map((g) => (
                    <tr key={g.cle}>
                      <td>{titreDuGroupe(g.cle)}</td>
                      {moisDeLExercice.map((m, i) => (
                        <td key={m.periode}>
                          <span
                            className={cn(
                              "d",
                              m.aVenir
                                ? "fut"
                                : g.mois.has(i)
                                  ? "ok"
                                  : attendu(g, i)
                                    ? "miss"
                                    : "none",
                            )}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Aucune information n'est portée par la seule couleur : la légende. */}
            <div className="lgd">
              <span>
                <i className="d ok" aria-hidden /> {TEXTES.legendeRecue}
              </span>
              <span>
                <i className="d miss" aria-hidden /> {TEXTES.legendeAttendue}
              </span>
              <span>
                <i className="d none" aria-hidden /> {TEXTES.legendeRien}
              </span>
            </div>
          </>
        )}

        {/*
         * ----------------------------------------------- la remarque de Malica
         *
         * Elle ne paraît QUE s'il y a quelque chose à dire : des ensembles
         * récurrents dont le mois courant est vide, nommés un par un. Pas de
         * remarque à vide, pas de nombre inventé — la cadence s'est calculée
         * sur les pièces déjà chargées, et s'est taue là où le rythme n'est
         * pas assez net pour réclamer quoi que ce soit.
         *
         * Le bouton « Me le rappeler le 28 » du dessin n'est pas rendu :
         * aucun dépôt du contrat ne pose un rappel, et un bouton qui ne fait
         * rien apprend à ne plus toucher les boutons.
         */}
        {manquent.length > 0 ? (
          <div className="note">
            <img src={portraitMalica} alt="Malica" width={620} height={620} />
            <span className="bd">
              <p>
                {TEXTES.manquants(
                  manquent.length,
                  moisCourantLisible,
                  manquent.map((g) => titreDuGroupe(g.cle)).join(", "),
                )}
              </p>
            </span>
          </div>
        ) : null}

        <p className="foot">{vue === "annee" ? t("pme.doc.source") : t("pme.doc.note")}</p>

        {/* Ce qui attend de partir, pour ce dossier. Il parle de lui-même. */}
        <FileLocale />
      </div>
    </div>
  );
}

/** Le poids d'un groupe : ce qui décide de son rang hors de l'axe des mois. */
function poids(g: Groupe): number {
  let total = 0;
  for (const v of g.achats) total += Number(v);
  for (const v of g.ventes) total += Number(v);
  return total;
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-bibliotheque.html`. Ils portent
 * `class="g"`, la seule règle d'icône commune aux dix écrans :
 * `stroke:currentColor`, `fill:none`, bouts arrondis. La taille vient
 * toujours du contexte (`.grp i svg`, `.axe .vu button svg`, `.top .bk svg`),
 * jamais de l'icône.
 *
 * ==================================== POURQUOI TROIS GLYPHES, ET PAS QUINZE
 *
 * La maquette porte un dictionnaire de quinze pictogrammes indexé sur des NOMS
 * de dossiers français — « Loyer » → maison, « STEG » → éclair. Ces noms
 * viennent du jeu de démonstration, pas du référentiel : les familles de
 * charges arrivent de `charges.familles` avec un CODE et un libellé traduit, et
 * aucune table du produit ne dit quel pictogramme va avec quel code.
 *
 * Fabriquer cette table ici serait une décision de produit prise dans un
 * écran, et la première juridiction au plan différent la rendrait fausse. Trois
 * glyphes portent donc le même sens que le dessin : le calendrier pour une
 * période, le reçu pour une dépense, le panier pour une vente — et `.cli`,
 * l'accent du dessin, pour un groupe qui n'est QUE des ventes, c'est-à-dire un
 * client.
 */

/** Un groupe, selon l'axe sur lequel on le lit. */
function GlypheDeLAxe({ axe, vente }: { axe: Axe; vente: boolean }) {
  if (axe === "mois") return <IconeCalendrier />;
  if (vente) return <IconePanier />;
  return <IconeRecu />;
}

/** Un calendrier — une période. */
function IconeCalendrier() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/** Un reçu — ce qui porte un montant payé. */
function IconeRecu() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </svg>
  );
}

/** Un panier — une vente. */
function IconePanier() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M3.5 7.5h17l-1.5 11h-14z" />
      <path d="M8.5 7.5a3.5 3.5 0 0 1 7 0" />
    </svg>
  );
}

/** Trois traits — la vue liste. */
function IconeListe() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Le chevron du retour. */
function Chevron({ gauche = false }: { gauche?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d={gauche ? "M14.5 5.5L8 12l6.5 6.5" : "M9.5 5.5L16 12l-6.5 6.5"} />
    </svg>
  );
}
