import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useDecimales } from "@/hooks/use-decimales";
import { useSuperposition } from "@/hooks/use-superposition";

import { useI18n, type MessageKey } from "@/i18n";
import { CommentCEstPaye } from "@/components/malica/comment-c-est-paye";
import { usePme } from "@/components/malica/pme-context";
import { DocumentView } from "@/components/malica/document-view";
import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { RefusDeLecture } from "@/components/malica/lecture-refusee";
import malicaLoin from "@/assets/malica-loin.webp";
import { libelleDuChamp } from "@/lib/champ-lisible";
import { montant, quantite } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { Citation } from "@malica/socle/ports/repositories";
import { leSensResteADemander } from "@malica/socle/sens-de-la-piece";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { codeDuVerdict } from "@malica/socle/verdicts";
import { droitsDeLaPiece } from "@/lib/droits-de-la-piece";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";

export const Route = createFileRoute("/_authenticated/pme/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Ma pièce — Malica Office" },
      {
        name: "description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:title", content: "Ma pièce — Malica Office" },
      {
        property: "og:description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PieceScreen,
});

/** Les raisons MÉTIER pour lesquelles une lecture s'arrête, et leur phrase. */
const MESSAGE_DU_CODE_DE_LECTURE: Record<string, MessageKey> = {
  "lecture.illisible": "pme.lire.illisible",
  "lecture.vide": "pme.lire.vide",
  "lecture.trop_longue": "pme.lire.tropLongue",
  "lecture.trop_dense": "pme.lire.tropDense",
};

/*
 * ================================================= LES MOTS QUI N'ONT PAS ENCORE DE CLÉ
 *
 * Le dessin apporte des libellés que `packages/socle/src/messages.ts` ne porte
 * pas encore. Ils sont rassemblés ICI, en un seul bloc, et nulle part ailleurs
 * dans le fichier : ce sont les seules chaînes en dur de l'écran, et c'est la
 * seule liste à reprendre quand les clés seront ajoutées aux trois langues.
 *
 * Tant qu'ils vivent ici, l'écran n'est juste qu'en français — c'est une dette
 * nommée, pas un oubli. Rien de ce bloc n'est un CHIFFRE : aucune valeur
 * comptable, aucun montant, aucun plafond n'est écrit en dur dans cet écran.
 */
const MOTS = {
  achat: "Achat · fournisseur",
  vente: "Vente · client",
  sensInconnu: "Sens non tranché",
  chaine: "La chaîne",
  pieces: "PIÈCES",
  issueDe: "Issue de cette pièce",
  aRattacher: "À rattacher",
  chaineVide: "Aucun reçu ni justificatif n'est encore rattaché à cette pièce.",
  chaineFoot:
    "Un reçu, un talon, un avis se rattachent depuis le règlement : c'est là qu'ils sont photographiés, et c'est de là qu'ils tiennent à leur facture.",
  reglements: "Les règlements",
  encaissements: "Les encaissements",
  mouvement: "MOUVEMENT",
  mouvements: "MOUVEMENTS",
  verifie: "Ce que j'ai vérifié",
  points: "POINTS",
  lectureRefusee:
    "Je n'ai pas lu cette pièce. Elle est photographiée et rangée — la lecture reste à faire.",
  parcours: "Le parcours",
  etapes: "ÉTAPES",
  etat: { faite: "faite", courante: "en cours", attente: "en attente" },
  foot: "Je signale et j'interroge ; je ne modifie jamais une écriture.",
  revenir: "Revenir dessus",
  libre: "LIBRE",
  avantValidation: "AVANT VALIDATION",
  surAccord: "SUR ACCORD",
  rienNestSorti: "Rien n'est sorti d'ici",
  rienNestSortiTexte:
    "Vous corrigez ce que vous voulez — chaque correction est datée et s'ajoute à la lecture, elle ne l'efface pas. Et vous pouvez la supprimer : personne ne l'a reçue.",
  elleAttend: "Elle attend le dirigeant",
  elleAttendTexte:
    "Tant qu'il n'a pas tranché, corrigez ce que vous voulez : c'est votre saisie. La supprimer lui revient — je lui transmets la demande et je vous préviens.",
  elleEstPartie: "Elle est partie",
  elleEstPartieTexte:
    "Une correction la renvoie en « à revalider » chez votre cabinet — il refait son travail, et c'est normal. Une suppression lui demande son accord, au titre de sa conservation : la décision s'inscrit au journal, quelle qu'elle soit.",
  demanderSuppression: "Demander la suppression",
  mettreAuPrive: "La mettre dans mon espace privé",
  suppressionDemandee: "Suppression demandée. Votre cabinet doit l'accorder.",
  suppressionRefusee: "Suppression refusée par votre cabinet.",
  siege:
    "Vous voyez ce dossier parce que vous y avez versé une pièce. C'est le dirigeant qui transmet au cabinet.",
} as const;

interface ExtractArticle {
  designation: string;
  quantity: string | null;
  unit_price_ht: string | null;
  unit_price_ttc: string | null;
  total_ht: string | null;
  tax_code: string | null;
}

interface ExtractPayload {
  issuer?: string;
  document_date?: string;
  document_kind?: string;
  currency?: string;
  lines?: Array<{
    label: string;
    tax_code: string;
    base_ht: string;
    vat_amount: string;
    ttc: string;
  }>;
  articles?: ExtractArticle[];
  other_charges?: Array<{ code: string; label: string; amount: string }>;
  references?: Record<string, string>;
  totals?: { base_ht: string; vat: string; ttc: string };
}

/**
 * Le dossier d'une pièce — l'écran du dessin `ecrans/malica-dossier.html`.
 *
 * ================================================================= CE QU'IL EST
 *
 * Une facture ne vit jamais seule : une commande l'annonce, une livraison
 * l'atteste, des règlements la soldent, des reçus les prouvent. L'écran montre
 * la chaîne entière, le maillon absent, et ce qu'on peut encore faire.
 *
 * ===================================================== CE QUI NE SE NÉGOCIE PAS
 *
 * Quatre comportements ont coûté cher et sont portés par le câblage, pas par le
 * balisage. Les voici, et où ils sont dans ce fichier :
 *
 *   1. UNE CORRECTION EST UNE ÉCRITURE NOUVELLE (R7). `capture.preciser`
 *      AJOUTE une précision à côté de la lecture ; jamais un UPDATE. La
 *      lecture garde ce qu'elle a réellement lu.
 *   2. UN RÈGLEMENT NE SE MODIFIE PAS. Il s'annule par une ligne datée et
 *      motivée : `capture.motifsDAnnulation` puis `capture.annulerPaiement`.
 *      Ces deux appels vivent dans `CommentCEstPaye`, monté plus bas, et
 *      l'écran n'en propose aucun autre chemin.
 *   3. UNE PIÈCE TRANSMISE NE REVIENT QUE SUR ACCORD DU CABINET :
 *      `collab.demanderSurPiece(id, 'rappel' | 'suppression')`, et l'état se
 *      lit par `collab.demandesDUnePiece`. Aucun rappel unilatéral.
 *   4. LA CHAÎNE : `capture.piecesIssuesDe` — ce qui est né de cette pièce.
 *
 * ============================================================== LE STYLE VIENT DU CSS
 *
 * `data-ecran="dossier"` sur la racine, et les classes du dessin relevées dans
 * `styles-pme.css` sous `[data-surface="pme"] [data-ecran="dossier"]`. Aucune
 * classe utilitaire par-dessus : les écrans pleins (lecture, soulagement,
 * visionneuse, détail) gardent le leur, le dessin ne les décrit pas.
 */
function PieceScreen() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  // Les décimales de la devise viennent du pack. `null` tant qu'on ne les a
  // pas : on n'en suppose aucune (R4).
  const decimales = useDecimales();
  const [zoom, setZoom] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * La requête de lecture est morte en route — téléphone verrouillé, page
   * rechargée, réseau coupé — mais la lecture continue côté serveur. On
   * attend son résultat au lieu d'annoncer une panne.
   */
  const [attente, setAttente] = useState(false);
  /**
   * Le soulagement n'arrive qu'une fois.
   *
   * Il est porté par un état d'écran, pas par le statut de la pièce : rouvrir
   * une facture comptabilisée trois jours plus tard ne doit pas rejouer la
   * coche. On fête la confirmation, pas la comptabilisation.
   */
  const [regle, setRegle] = useState(false);
  const [montrerPiece, setPiece] = useState(false);
  const [montrerDetail, setDetail] = useState(false);
  // Le bouton retour ferme d'abord ce qui est ouvert par-dessus la pièce.
  useSuperposition(
    montrerPiece,
    useCallback(() => setPiece(false), []),
  );
  useSuperposition(
    montrerDetail,
    useCallback(() => setDetail(false), []),
  );

  // Qui reçoit la pièce. Sans mandat, elle reste au dossier — et l'écran le
  // dit autrement plutôt que d'inventer un destinataire.
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  /**
   * Qui je suis dans ce dossier — `dirigeant` ou `collaborateur`.
   *
   * Le bloc « Revenir dessus » croise le RÔLE et la visibilité de la pièce, et
   * rien d'autre : un siège corrige librement sa propre saisie mais ne la
   * supprime pas, un dirigeant tranche. Sans ce rôle, l'écran offrirait à un
   * siège un geste que la base lui refuse.
   */
  const acces = useQuery({
    queryKey: ["mon-acces", pme.tenantId],
    queryFn: () => office().acces.monAcces(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const navigate = useNavigate();
  const navigateList = () => navigate({ to: "/pme/list" });

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  /*
   * ==================================================== LE SCAN FINAL
   *
   * Ce que la personne voit avant de taper « Lire » est EXACTEMENT ce qui
   * sera lu : les images de page telles qu'elles sont enregistrées dans le
   * PDF, découpées sans les décoder. Un PDF qui ne vient pas de nous (un
   * fichier déposé) n'en porte pas forcément : la visionneuse prend alors
   * le relais.
   */
  const contenuBrut = dossier.data?.contenu ?? null;
  const pagesScan = useMemo(
    () => (contenuBrut ? pagesJpegDuPdf(contenuBrut).map((b) => URL.createObjectURL(b)) : []),
    [contenuBrut],
  );
  useEffect(() => () => pagesScan.forEach((u) => URL.revokeObjectURL(u)), [pagesScan]);

  /*
   * Une lecture tourne-t-elle déjà pour cette pièce ? Demandé au retour sur
   * l'écran, et redemandé tant que c'est le cas : le résultat arrive par le
   * dossier, pas par la requête qui l'a lancée.
   */
  const lue = dossier.data?.extraction != null;
  const etat = useQuery({
    queryKey: ["lecture-en-cours", pieceId],
    queryFn: () => office().malica.etatDeLecture(pieceId),
    enabled: !lue,
    refetchInterval: (q) => (q.state.data?.enCours || attente ? 3_000 : false),
  });
  useEffect(() => {
    if (!etat.data || etat.data.enCours) return;
    if (attente) {
      setAttente(false);
      void qc.invalidateQueries({ queryKey: ["piece", pieceId] });
      void qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    }
  }, [etat.data, attente, qc, pieceId, pme.tenantId]);

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  /**
   * LA CHAÎNE — ce qui est né de cette pièce.
   *
   * Même clé que dans `CommentCEstPaye` : React Query ne fait donc qu'un seul
   * aller-retour pour les deux blocs. « Un écran, une fenêtre de données. »
   */
  const joints = useQuery({
    queryKey: ["joints", pieceId],
    queryFn: () => office().capture.piecesIssuesDe(pieceId),
  });

  /**
   * Les règlements, pour l'état de règlement du chapeau.
   *
   * LECTURE SEULE ici : aucune mutation de paiement ne part de ce bloc. Les
   * gestes — inscrire, annuler avec motif, rattacher la preuve — appartiennent
   * à `CommentCEstPaye`, qui les porte depuis le 13 octobre avec ses gardes.
   * Deux chemins pour la même écriture seraient deux occasions de divergence.
   */
  const paiements = useQuery({
    queryKey: ["paiements", pieceId],
    queryFn: () => office().capture.paiementsDUnePiece(pieceId),
  });

  /** Le nom d'un type de document vient du référentiel traduit, jamais du code. */
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });
  const nomDuType = (code: string | null) =>
    (typesDoc.data ?? []).find((x) => x.code === code)?.libelle ?? null;

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
      qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] }),
    ]);
  };

  /*
   * ================================================ EFFACER UN BROUILLON
   *
   * Une photo ratée, un reçu personnel, un document qui n'a rien à faire là.
   *
   * La base décide, pas cet écran : `capture_piece_supprimer` refuse une pièce
   * transmise, engagée dans une écriture, ou servant de justificatif. On ne
   * propose donc le geste que lorsqu'il a une chance d'aboutir — mais si
   * quelqu'un le tente ailleurs, le refus vient quand même.
   *
   * Deux temps, jamais un seul : un effacement ne se déclenche pas par mégarde.
   */
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  useSuperposition(
    confirmerSuppression,
    useCallback(() => setConfirmerSuppression(false), []),
  );
  const supprimer = useMutation({
    mutationFn: () => office().capture.supprimer(pieceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      void navigate({ to: "/pme/list" });
    },
    onError: (e: unknown) => {
      setConfirmerSuppression(false);
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error")));
    },
  });

  /**
   * Supprimer et reprendre : la page ne convient pas, on la retire et l'on
   * rouvre l'appareil photo. Un scan non lu et non transmis n'engage rien.
   */
  const reprendre = useMutation({
    mutationFn: () => office().capture.supprimer(pieceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      await navigate({ to: "/pme" });
      pme.ouvrirScanner();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * UNE CORRECTION EST UNE ÉCRITURE NOUVELLE (R7).
   *
   * Le sens de la pièce, quand la lecture n'a pas pu le dire : un achat ou
   * une vente. La réponse est une entrée nouvelle — jamais une modification
   * de la lecture ; le dossier la rend ensuite comme si elle avait été lue.
   */
  const preciser = useMutation({
    mutationFn: (valeur: "facture_achat" | "facture_vente") =>
      office().capture.preciser(pieceId, "document_kind", valeur),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /** Transmettre au cabinet — sur décision du dirigeant, jamais toute seule. */
  const transmettre = useMutation({
    mutationFn: () => office().collab.setPieceVis(pieceId, "partage"),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * La remettre dans l'espace privé — le geste du dessin, « LIBRE » seulement.
   *
   * La base tient le mur (R6) : elle refuse dès que la pièce est partie ou
   * comptabilisée. L'écran ne l'offre donc que là où il peut aboutir.
   */
  const remettreAuPrive = useMutation({
    mutationFn: () => office().collab.setPieceVis(pieceId, "personnel"),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * Donner la date que la lecture n'a pas su lire.
   *
   * La base refuse une date a venir : un doigt qui ripe sur un selecteur
   * donne « 2027 » aussi facilement que « 2026 », et une facture rangee dans
   * un exercice qui n'a pas commence disparait de toutes les declarations
   * sans rien signaler.
   */
  const dater = useMutation({
    mutationFn: (date: string) => office().capture.daterLaPiece(pieceId, date),
    onSuccess: async () => {
      setError(null);
      // Les charges changent de mois : leur lecture est a refaire.
      await qc.invalidateQueries({ queryKey: ["charges-sans-date", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["charges-articles", pme.tenantId] });
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * Garder chez soi — l'autre moitié de la décision.
   *
   * Rien ne distinguait « j'ai décidé de la garder » de « je n'ai pas encore
   * répondu », donc la question revenait à chaque visite — et un écran qui
   * redemande ce qu'on vient de lui dire apprend à ne plus répondre.
   */
  const garder = useMutation({
    mutationFn: () => office().collab.garderPiece(pieceId),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * LE GESTE INVERSE SE DEMANDE, IL NE SE PREND PAS.
   *
   * Le 10 octobre 2026 j'avais livré un rappel unilatéral, pour sortir d'un
   * état qu'on n'avait pas choisi. Le commanditaire a tranché le lendemain :
   * « le rappel de la pièce doit être approuvé par le cabinet ».
   *
   * Il a raison : le cabinet travaille sur ce qu'il a reçu, et une pièce qui
   * disparaît de sa file sans un mot est pire que l'état bloqué.
   */
  const rappeler = useMutation({
    mutationFn: () => office().collab.demanderSurPiece(pieceId, "rappel"),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * Et la suppression d'une pièce déjà reçue se demande, elle aussi.
   *
   * Même mécanisme, autre objet : le cabinet la conserve, c'est son métier.
   * La décision s'inscrit au journal, quelle qu'elle soit.
   */
  const demanderSuppression = useMutation({
    mutationFn: () => office().collab.demanderSurPiece(pieceId, "suppression"),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["demandes-piece", pieceId] });
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  // L'état des demandes, s'il y en a : leur dernier fait, par objet.
  const demandes = useQuery({
    queryKey: ["demandes-piece", pieceId],
    queryFn: () => office().collab.demandesDUnePiece(pieceId),
  });
  const dernierFaitDuRappel = demandes.data?.find((d) => d.objet === "rappel") ?? null;
  const demandeDeRappel = dernierFaitDuRappel?.fait ?? null;
  const noteDuRappel = dernierFaitDuRappel?.note ?? null;
  const dernierFaitDeSuppression = demandes.data?.find((d) => d.objet === "suppression") ?? null;
  const demandeDeSuppression = dernierFaitDeSuppression?.fait ?? null;

  const read = useMutation({
    mutationFn: () => office().malica.lirePiece(pieceId),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) => {
      /*
       * La chaîne de lecture parle en CODES, jamais en prose : la fonction
       * serveur ne transmet qu'un message nu, et c'est ici qu'il devient une
       * phrase dans la langue du dirigeant.
       */
      // Une requête morte n'est pas une lecture morte : le serveur continue.
      if (e instanceof TypeError) {
        setAttente(true);
        void etat.refetch();
        return;
      }
      const code = e instanceof Error ? e.message : "";
      const libelle = MESSAGE_DU_CODE_DE_LECTURE[code];
      if (libelle) {
        setError(t(libelle));
        return;
      }
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error")));
    },
  });

  /*
   * ================================ LA DATE QUAND LA PIÈCE N'EN PORTE PAS
   *
   * On propose le JOUR DU SCAN. Mais on ne le glisse pas en douce dans la
   * lecture : il s'affiche, il est modifiable, et il ne devient la date de la
   * pièce qu'au moment où l'utilisateur confirme. L'extraction garde sa date
   * vide — c'est ce qui s'est réellement lu sur le document (R7).
   *
   * Une facture de janvier scannée en mars et datée de mars part dans la
   * mauvaise déclaration de TVA.
   */
  const jourDuScan = (dossier.data?.piece.createdAt ?? new Date().toISOString()).slice(0, 10);
  const [dateSaisie, setDateSaisie] = useState<string | null>(null);
  const dateRetenue = dateSaisie ?? jourDuScan;

  /*
   * Les droits hors TVA, et le pack qui les nomme. Le libellé et la référence
   * légale d'un droit vivent dans `ref.fiscal_charges`, datés et versionnés :
   * on les lit (R4), on ne les écrit pas dans l'écran.
   */
  const packDroits = useQuery({
    queryKey: ["droits-du-pack", pme.packId],
    enabled: !!pme.packId,
    queryFn: () => office().referential.fiscalCharges(pme.packId!, locale),
  });

  const propositionServeur = useQuery({
    queryKey: ["proposition", pieceId, dateRetenue, dossier.data?.extraction?.id ?? null],
    queryFn: () => office().office.propositionDePiece(pieceId, dateRetenue),
    enabled: Boolean(dossier.data?.extraction),
  });
  const proposalAttempt = propositionServeur.data
    ? propositionServeur.data.ok
      ? { ok: true as const, value: propositionServeur.data.proposition }
      : {
          ok: false as const,
          verdict: propositionServeur.data.verdict ?? null,
          verdictCode: propositionServeur.data.verdictCode ?? null,
        }
    : null;
  const proposal = proposalAttempt?.ok ? proposalAttempt.value : null;
  // Le payload dont la proposition est tirée : la lecture, complétée de la
  // précision de la personne si la lecture n'avait pas su.
  const payloadDeLaProposition = dossier.data?.extraction?.payload ?? null;

  const booked = (ecritures.data ?? []).find((e) => e.status === "booked");

  /**
   * Un seul geste : la proposition du Socle et sa comptabilisation s'enchaînent.
   * La PME ne compose jamais l'écriture, elle confirme ce qu'elle a vu cité.
   */
  const confirm = useMutation({
    mutationFn: async () => {
      // Une proposition calculable prime toujours sur une proposition ancienne :
      // le Socle a pu changer d'avis (droit du pack, résidu). Le RPC remplace la
      // proposition existante ; une écriture non équilibrée n'est jamais confirmée.
      let ecritureId: string | null = null;
      if (proposal) {
        if (!pme.packId || !proposal.pivot.approvable) throw new Error(t("pme.confirm.review"));
        /*
         * Le « Oui » vaut pour tout ce qui est à l'écran, le sens de la pièce
         * compris. Tant que le type n'a été que lu, la personne le confirme
         * ici, avant l'écriture : c'est ce que le verrou R2 attend, et la
         * précision reste datée et signée à côté de la lecture (R7).
         */
        const pieceLue = dossier.data?.piece;
        const type = (payloadDeLaProposition as { document_kind?: string } | null)?.document_kind;
        if (
          pieceLue &&
          pieceLue.documentKindStatut !== "confirme" &&
          (type === "facture_achat" || type === "facture_vente")
        ) {
          await office().capture.preciser(pieceId, "document_kind", type);
        }
        // Le serveur recalcule et enregistre : aucune ligne ne part d'ici.
        ecritureId = await office().office.proposerDepuisPiece(pieceId, dateRetenue);
      } else {
        // Jamais de repli sur une proposition ancienne : sans calcul du Socle,
        // il n'y a rien à confirmer. La raison rendue est celle de l'écran,
        // traduite — jamais la prose du serveur, qui parle au cabinet.
        throw new Error(raisonDuBlocage);
      }
      if (!ecritureId) throw new Error(t("pme.confirm.review"));
      await office().office.book(ecritureId);
    },
    onSuccess: async () => {
      setError(null);
      setRegle(true);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  if (dossier.isPending)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!dossier.data) return <p className="text-sm text-signal-warn">{t("common.error")}</p>;

  const { piece, contenu, extraction, citations, lectureRefusee } = dossier.data;

  /*
   * ================================ LE SENS SE DEMANDE UNE FOIS, PAS DEUX
   *
   * 13 octobre 2026 : « il y a une deuxième fois où l'app demande achat ou
   * vente ». La réponse était là, dans le même objet, à deux champs de
   * distance : la personne avait répondu à la capture, la lecture ne tranchait
   * pas — ce qui est normal sur un achat tunisien — et l'écran reposait la
   * question. Une déclaration qui n'est ni un achat ni une vente — un relevé
   * bancaire, un ticket — ne répond pas à la question et ne la clôt donc pas.
   */
  const sensIndetermine =
    extraction != null &&
    leSensResteADemander({
      sensLu: (extraction.payload as { document_kind?: string | null } | null)?.document_kind,
      typeDeclare: piece.documentKind,
    });
  // Une citation par champ : la dernière écrite est celle qui fait foi.
  const byField = new Map(citations.map((c) => [c.field, c]));
  const payload = extraction?.payload as ExtractPayload | undefined;
  const confirmable = Boolean(proposal?.pivot.approvable);

  /**
   * Un montant du Socle, dans la langue du lecteur — ou rien s'il n'y en a pas.
   *
   * Le type disait `string | undefined` ; le serveur rend `null`. C'est ce
   * mensonge qui a planté l'écran le 4 octobre 2026.
   */
  const lisible = (valeur: string | null | undefined) => {
    const rendu = montant(valeur, locale);
    return rendu === "" ? null : rendu;
  };

  /** « 2026-08-31 » se lit mal ; « 31/08/2026 » se lit. */
  const jourLisible = (iso: string | undefined | null) => {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  /**
   * « Classé dans … » — le libellé du compte principal que le Socle a retenu.
   *
   * Pas une catégorie d'écran : la première ligne de l'écriture proposée, donc
   * exactement ce qui sera comptabilisé.
   */
  const classement = proposal?.lignes[0]?.libelle ?? t("pme.regle.classe.inconnu");

  /** La TVA du document, telle que la lecture l'a relevée. */
  const tvaDuDoc = payload?.totals?.vat ? montant(payload.totals.vat, locale) : null;

  /**
   * Le parcours de la pièce, étape par étape.
   *
   * L'ordre est le NÔTRE : une pièce est comptabilisée avant d'être vue par
   * le cabinet. Reprendre l'ordre de la maquette aurait dessiné un circuit
   * qui n'existe pas dans le produit.
   */
  const rang: Record<string, number> = {
    capturee: 1,
    lue: 2,
    proposee: 3,
    comptabilisee: 4,
    supervisee: 5,
    retournee: 3,
  };
  const atteint = rang[piece.status] ?? 1;
  const etapes = (
    [
      ["recue", 1],
      ["lue", 2],
      ["confirmee", 3],
      ["comptee", 4],
      ["vue", 5],
      ["declaree", 6],
    ] as const
  ).map(([cle, seuil]) => ({
    cle,
    label: t(`pme.parcours.${cle}` as MessageKey),
    // « Déclarée » n'a pas encore d'état dans le produit : elle reste en
    // attente plutôt que de laisser croire que le parcours s'arrête avant.
    etat: seuil > atteint ? "attente" : seuil === atteint ? "courante" : "faite",
  }));

  /** Les articles relevés sur la pièce. Le contrat les porte ; l'écran les montre. */
  const articles = payload?.articles ?? [];
  const droits = droitsDeLaPiece(payload?.other_charges, packDroits.data ?? []);

  /** Le numéro porté par le document, s'il en porte un. */
  const reference = payload?.references
    ? (Object.values(payload.references).find((v) => v && v.trim().length > 0) ?? null)
    : null;

  /*
   * ============================== ON BRANCHE SUR UN CODE, PAS SUR UNE PHRASE
   *
   * La conversion vit au Socle, en un seul endroit, avec son épreuve : un
   * verdict est un code, même quand il s'écrit en français, et le comparer
   * accent par accent depuis un autre paquet tombait en silence le jour d'une
   * reformulation.
   */
  const verdictBloquant =
    proposalAttempt && !proposalAttempt.ok
      ? (proposalAttempt.verdictCode ?? codeDuVerdict(proposalAttempt.verdict ?? null))
      : null;
  const raisonDuBlocage =
    verdictBloquant === "rejet"
      ? t("pme.bloque.rejet")
      : verdictBloquant === "anomalie"
        ? t("pme.bloque.anomalie")
        : verdictBloquant === "rapprocher"
          ? t("pme.bloque.rapprocher")
          : t("pme.confirm.review");

  /**
   * Trois lignes, chacune pointant sa source.
   *
   * L'émetteur, la date, et LA TVA — parce que c'est la seule des trois qui
   * soit de l'argent pour le dirigeant. Le total, lui, est déjà au chapeau.
   */
  const lignesCitees: Array<{ cle: string; label: string; valeur: string | null; champ: string }> =
    [
      {
        cle: "issuer",
        label: t("pme.extract.issuer"),
        valeur: payload?.issuer ?? null,
        champ: "issuer",
      },
      {
        cle: "date",
        label: t("pme.extract.date"),
        valeur: jourLisible(payload?.document_date),
        champ: "document_date",
      },
      {
        cle: "tva",
        label:
          payload?.document_kind === "facture_vente"
            ? t("pme.verifie.tvaCollectee")
            : t("pme.verifie.tvaRecuperee"),
        valeur: lisible(payload?.totals?.vat),
        champ: "totals.vat",
      },
    ];

  const voirLaSource = (champ: string) => {
    const c = byField.get(champ);
    if (!c) return;
    setZoom(c);
    setPiece(true);
  };

  /* ============================================================== JE LIS
   *
   * Plein écran, sans la barre basse : ce sont les deux seuls moments où le
   * produit demande qu'on ne fasse rien d'autre. Le dessin du dossier ne
   * décrit pas ces écrans ; ils gardent leur propre balisage.
   *
   * Une barre de progression mentirait — la lecture n'a pas d'étapes connues
   * d'avance. Un souffle dit la vérité : je travaille, et je ne sais pas
   * encore pour combien de temps.
   */
  if (read.isPending || attente || etat.data?.enCours) {
    return (
      <div className="pt-safe rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-11 text-center">
        <MalicaAvatar size={66} alt="Malica" rond />
        <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
          {t("pme.lecture.titre")}
        </p>
        <p className="mt-2 text-[14px] leading-[1.6] text-text-2">{t("pme.lecture.sous")}</p>
        <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
        {/*
         * La lecture continue sans l'écran : le serveur la mène à son terme et
         * le dossier le dira. Rester devant n'est pas une obligation.
         */}
        <Link
          to="/pme/list"
          className="mt-8 inline-flex min-h-[44px] items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t("pme.lecture.arrierePlan")}
        </Link>
        {dossier.data && dossier.data.tokens.length > 0 ? (
          <p className="mt-[26px] font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("pme.lecture.releve", { mots: dossier.data.tokens.length })}
          </p>
        ) : null}
      </div>
    );
  }

  /* ========================================================== C'EST RÉGLÉ
   *
   * Le pic de soulagement, plein écran lui aussi, et il n'arrive qu'UNE fois
   * — à la confirmation. Rouvrir une facture comptabilisée trois jours plus
   * tard ne rejoue pas la coche : on fête la confirmation, pas l'état.
   */
  if (regle) {
    return (
      <div className="pt-safe rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-10 text-center">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 12.5l5 5L20 6.5" strokeDasharray="34" className="rg-draw" />
        </svg>
        <p className="mt-5 text-[27px] font-semibold tracking-[-0.03em]">{t("pme.regle.titre")}</p>
        <p className="mt-2.5 max-w-[280px] text-[15px] leading-[1.55] text-text-2">
          {/*
           * On ne dit « transmis » que si la pièce l'est VRAIMENT. Promettre la
           * transmission sans qu'elle ait eu lieu est un mensonge — et sur une
           * pièce comptable, un mensonge qui coûte cher à découvrir.
           */}
          {cabinet.data && piece.vis === "partage"
            ? t("pme.regle.classe.cabinet", { classe: classement, cabinet: cabinet.data.name })
            : t("pme.regle.classe", { classe: classement })}
        </p>
        {tvaDuDoc ? (
          <span className="mt-6 inline-flex items-center gap-2 border border-signal-ok px-3.5 py-2 text-[13px] font-semibold text-signal-ok">
            <span aria-hidden className="h-[5px] w-[5px] bg-current" />
            {payload?.document_kind === "facture_vente"
              ? t("pme.regle.tva.collectee", { montant: tvaDuDoc, devise: pme.currency })
              : t("pme.regle.tva.recuperable", { montant: tvaDuDoc, devise: pme.currency })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setRegle(false)}
          className="mt-[34px] border-b border-line-strong pb-[3px] text-[13px] font-medium text-muted-foreground"
        >
          {t("pme.regle.voir")}
        </button>
      </div>
    );
  }

  /* ============================================================ LA PIÈCE
   *
   * La visionneuse s'ouvre par « Voir la facture », ou par une source citée —
   * et c'est alors la zone exacte qui s'affiche, ce qui est tout l'intérêt.
   */
  if (montrerPiece) {
    return (
      <div className="pt-safe fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setPiece(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          {/*
           * Le NOM du champ, pas son chemin. Cette ligne rendait `zoom.field`
           * — le chemin machine — en capitales anglaises : la personne lisait
           * « ISSUER » sous la photo de sa facture. C'est la dette D42.
           */}
          {zoom ? (
            <span className="ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
              {libelleDuChamp(zoom.field, t)}
            </span>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-[22px]">
          {contenu ? (
            <DocumentView contenu={contenu} highlight={zoom} label={t("pme.piece.title")} />
          ) : (
            <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
              {t("pme.doc.error")}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ====================================================== LE DÉTAIL DES LIGNES
   *
   * Ce que le dirigeant reconnaît. Il se souvient d'avoir acheté trois cents
   * ramettes, pas d'un total hors taxe — et c'est en relisant les
   * désignations et les prix unitaires qu'il repère une erreur de lecture que
   * les totaux, eux, ne trahissent pas.
   */
  if (montrerDetail) {
    return (
      <div className="pt-safe fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setDetail(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("pme.detail.compte", { count: articles.length })}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-4">
          <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {t("pme.detail.titre")}
          </p>
          {articles.length === 0 ? (
            <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
              {t("pme.detail.aucun")}
            </p>
          ) : (
            <div className="mt-4">
              {articles.map((a, i) => (
                <div key={i} className="border-t border-border py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium">{a.designation}</span>
                    <span className="num flex-none text-[13.5px] font-medium">
                      {lisible(a.total_ht ?? undefined) ?? "—"}
                    </span>
                  </div>
                  <p className="num mt-1 text-[11.5px] text-muted-foreground">
                    {a.quantity
                      ? t("pme.detail.qte", { q: quantite(a.quantity, locale) })
                      : t("pme.detail.sansQte")}
                    {a.unit_price_ht
                      ? " · " + t("pme.detail.pu", { pu: lisible(a.unit_price_ht) ?? "—" })
                      : ""}
                    {a.tax_code ? " · " + a.tax_code : ""}
                  </p>
                </div>
              ))}
              {/*
               * LE PIED DE FACTURE EN ENTIER, et pas seulement la base. Montrer
               * une base sans sa TVA et sans son total laisse la personne
               * incapable de vérifier que le produit a bien lu — ce qui est la
               * seule chose qu'on lui demande.
               */}
              <div className="flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
                <span className="text-[13.5px] font-semibold">{t("pme.extract.base")}</span>
                <span className="num text-[13.5px] font-semibold">
                  {lisible(payload?.totals?.base_ht) ?? "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-1.5">
                <span className="text-[13.5px]">{t("pme.extract.vat")}</span>
                <span className="num text-[13.5px]">{lisible(payload?.totals?.vat) ?? "—"}</span>
              </div>
              {droits.map((d, i) => (
                <div
                  key={`${d.code}-${i}`}
                  className="flex items-baseline justify-between gap-3 pt-1.5"
                >
                  <span className="text-[13.5px]">
                    {d.libelle}
                    {d.connu ? "" : ` · ${t("pme.extract.droitInconnu")}`}
                  </span>
                  <span className="num text-[13.5px]">{lisible(d.montant) ?? "—"}</span>
                </div>
              ))}
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
                <span className="text-[14px] font-semibold">{t("pme.verifie.total")}</span>
                <span className="num text-[15px] font-semibold">
                  {lisible(payload?.totals?.ttc) ?? "—"} {payload?.currency ?? pme.currency}
                </span>
              </div>
            </div>
          )}
          <p className="mt-4 text-[11.5px] leading-[1.5] text-muted-foreground">
            {t("pme.detail.provenance")}
          </p>
        </div>
      </div>
    );
  }

  /* ========================================================= PAS ENCORE LUE
   *
   * Le scan final, en grand, AVANT le geste : c'est lui qui sera lu, pas
   * l'aperçu de l'appareil photo. Deux gestes seulement — lire, ou retirer
   * et reprendre. Rien ne part tant que la personne n'a pas vu.
   */
  if (!extraction) {
    return (
      <div className="rg-rise flex flex-col gap-4 px-1 pt-2">
        <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.piece.title")}
        </p>
        <p className="text-[13.5px] leading-[1.55] text-text-2">{t("pme.scan.final")}</p>
        {/*
         * ============================ POURQUOI ELLE N'A PAS ÉTÉ LUE, ÉCRIT ICI
         *
         * La base inscrit le motif depuis le 19 octobre, et aucun écran ne le
         * lisait : le dirigeant au plafond de son forfait voyait cet écran
         * exactement comme celui d'une pièce qui attend son tour. Il tapait
         * « Lire », et rien ne se passait.
         *
         * Le bouton reste : c'est la base qui tranche, et un plafond relevé la
         * minute d'après doit pouvoir être essayé sans quitter l'écran.
         */}
        {lectureRefusee ? (
          <RefusDeLecture
            refus={lectureRefusee}
            dateLisible={new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
              new Date(lectureRefusee.le),
            )}
          />
        ) : null}
        {pagesScan.length > 0 ? (
          <div className="flex flex-col gap-3">
            {pagesScan.map((url, i) => (
              <figure key={url} className="border border-border bg-card">
                <img src={url} alt={t("pme.scan.page", { n: i + 1 })} className="block w-full" />
                {pagesScan.length > 1 ? (
                  <figcaption className="num px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("pme.scan.page", { n: i + 1 })}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : contenu ? (
          <DocumentView contenu={contenu} highlight={null} label={t("pme.piece.title")} />
        ) : (
          <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
            {t("pme.doc.error")}
          </p>
        )}
        <button
          type="button"
          onClick={() => read.mutate()}
          className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background"
        >
          {t("pme.read.run")}
        </button>
        <button
          type="button"
          onClick={() => reprendre.mutate()}
          disabled={reprendre.isPending}
          className="h-[48px] w-full border border-border text-[14px] font-medium disabled:opacity-40"
        >
          {t("pme.scan.reprendre")}
        </button>
        {error ? <p className="text-xs text-signal-warn">{error}</p> : null}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * LE DOSSIER
   *
   * À partir d'ici, c'est le dessin. Tout ce qui s'affiche vient d'un appel ;
   * rien n'est fabriqué. Trois états par champ, jamais deux : la valeur, le
   * vide, et l'absence — « — » quand on ne sait pas, jamais « 0 ».
   * ══════════════════════════════════════════════════════════════════════════ */

  const vente = payload?.document_kind === "facture_vente";
  const achat = payload?.document_kind === "facture_achat";
  const devise = payload?.currency ?? pme.currency;

  /**
   * La visibilité, lue large.
   *
   * Le contrat ne connaît aujourd'hui que `personnel` et `partage` ; le
   * câblage annonce `entite` — la pièce versée à la société, pas encore
   * transmise. L'écran sait déjà le rendre : le jour où `Visibility` l'accepte,
   * il n'y a rien à changer ici. Tant qu'il ne l'accepte pas, aucune pièce ne
   * porte cette valeur et la branche reste inerte.
   */
  const vis = piece.vis as "personnel" | "entite" | "partage";
  const role = acces.data?.role ?? null;
  const siege = role === "collaborateur";

  /**
   * Le mois de la pièce, pour la pastille du haut. Rien si la date manque.
   *
   * On ne construit la date que sur une forme VÉRIFIÉE : `new Date("")` puis
   * `Intl.DateTimeFormat` lève, et l'écran entier tomberait pour une pastille.
   */
  const dateDuDoc = /^\d{4}-\d{2}-\d{2}/.test(payload?.document_date ?? "")
    ? payload!.document_date!
    : null;
  const periode = dateDuDoc
    ? new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(
        new Date(dateDuDoc),
      )
    : null;

  const titreDeLaPiece =
    [nomDuType(piece.documentKind), reference].filter(Boolean).join(" ") || t("pme.piece.title");

  /*
   * ---------------------------------------------- L'ÉTAT DE RÈGLEMENT
   *
   * Somme des lignes NON ÉTEINTES : la base répond les deux faces d'un
   * paiement annulé (`eteint`), et « ce qui est payé aujourd'hui » a donc une
   * seule définition, au Socle. L'écran ne choisit rien.
   *
   * Sans les décimales du pack, on ne convertit pas : trois décimales sont
   * tunisiennes, et la première juridiction à deux aurait affiché mille fois
   * le montant payé (R4).
   */
  const paiementsVivants = (paiements.data ?? []).filter((p) => !p.eteint);
  const payeMineur = paiementsVivants.reduce((s, p) => s + (p.montantMineur ?? 0), 0);
  const ttcMineur =
    payload?.totals?.ttc && decimales !== null
      ? Math.round(Number(payload.totals.ttc) * 10 ** decimales)
      : null;
  const payeLisible =
    decimales !== null ? lisible(depuisUniteMineure(payeMineur, decimales)) : null;
  const resteMineur = ttcMineur !== null ? ttcMineur - payeMineur : null;
  const resteLisible =
    resteMineur !== null && decimales !== null
      ? lisible(depuisUniteMineure(Math.max(resteMineur, 0), decimales))
      : null;
  const part =
    ttcMineur !== null && ttcMineur > 0
      ? Math.min(100, Math.max(0, (payeMineur / ttcMineur) * 100))
      : 0;

  /*
   * ---------------------------------------------- CE QUE J'AI VÉRIFIÉ
   *
   * Uniquement des faits que le produit connaît : un refus de lecture, une
   * date absente, un sens non tranché, un verdict qui bloque, un classement
   * retenu. Aucun contrôle inventé — une liste de coches qui ne vient d'aucun
   * appel apprend à ne plus lire la liste.
   *
   * Les signalements de lecture (`extraction.flags`) n'y sont PAS : ils
   * appartiennent à la supervision du cabinet, qui en parle la langue.
   */
  const dateAbsente = !payload?.document_date;
  const controles: Array<{
    cle: string;
    k: "ok" | "q" | "no" | "az";
    p: string;
    sous?: string | null;
    corps?: "sens" | null;
  }> = [];
  if (dossier.data.lectureRefusee) {
    controles.push({ cle: "refus", k: "no", p: MOTS.lectureRefusee });
  }
  if (dateAbsente) {
    // La question est posée ici ; le champ qui y répond est dans le bloc de
    // lecture, à la ligne « Date », là où la personne la cherche.
    controles.push({ cle: "date", k: "q", p: t("pme.date.manque.lede") });
  }
  if (sensIndetermine) {
    controles.push({
      cle: "sens",
      k: "q",
      p: t("pme.sens.pourquoi"),
      corps: "sens",
    });
  }
  if (!confirmable && !sensIndetermine && proposalAttempt && !proposalAttempt.ok) {
    /*
     * LA RAISON PASSE DEVANT LE BOUTON MORT.
     *
     * 10 octobre 2026 : la phrase du serveur — un verdict collé à des motifs
     * techniques — s'affichait en 12,5 px SOUS le bouton, donc hors de
     * l'écran. Quand une action est impossible, la raison est l'information
     * principale ; le bouton n'est qu'un rappel de ce qui viendra après.
     */
    controles.push({
      cle: "bloque",
      k: "no",
      p: raisonDuBlocage,
      sous: t("pme.bloque.geste"),
    });
  }
  if (confirmable) {
    controles.push({
      cle: "classe",
      k: "ok",
      p: `${t("pme.piece.classee")} ${classement}`,
    });
  }
  if (booked) {
    controles.push({ cle: "comptee", k: "ok", p: t("pme.book.done") });
  }

  /** La chaîne : la pièce elle-même, puis ce qui en est né. */
  const nes = joints.data ?? [];

  return (
    <div data-ecran="dossier">
      {/* ── la barre du haut ─────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.piece.retour")}
          onClick={() => void navigateList()}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{titreDeLaPiece}</span>
        {periode ? <span className="per">{periode}</span> : null}
      </div>

      {/* ── le chapeau du dossier ────────────────────────────────────── */}
      <div className="tete">
        <span className={vente ? "kind rec" : "kind"}>
          <i />
          {vente ? MOTS.vente : achat ? MOTS.achat : MOTS.sensInconnu}
        </span>
        <h1>{payload?.issuer ?? t("pme.piece.title")}</h1>
        <p className="obj">
          {nomDuType(piece.documentKind) ?? t("pme.piece.title")}
          {reference ? ` · ${reference}` : ""}
          {payload?.document_date ? ` · ${jourLisible(payload.document_date)}` : ""}
        </p>
        <div className={vente ? "amt vent" : "amt"}>
          {lisible(payload?.totals?.ttc) ?? "—"}{" "}
          <u>
            {devise} {t("pme.extract.ttc")}
          </u>
        </div>
        <p className="decomp">
          {t("pme.extract.base")} {lisible(payload?.totals?.base_ht) ?? "—"} ·{" "}
          {t("pme.extract.vat")} {lisible(payload?.totals?.vat) ?? "—"}
          {droits.map((d, i) => (
            <span key={`${d.code}-${i}`}>
              {" · "}
              {d.libelle} {lisible(d.montant) ?? "—"}
              {d.connu ? "" : ` · ${t("pme.extract.droitInconnu")}`}
            </span>
          ))}
          <br />
          {pme.orgName}
        </p>
      </div>

      {/* ── l'état de règlement ──────────────────────────────────────── */}
      <div className="solde">
        <span className="hd">
          <b>
            {resteMineur !== null && resteMineur <= 0
              ? t("pme.paiement.solde")
              : t("pme.paiement.reste")}
          </b>
          <span>
            {payeLisible ?? "—"} / {lisible(payload?.totals?.ttc) ?? "—"}
          </span>
        </span>
        <span className="bar">
          <i style={{ width: `${part}%` }} />
        </span>
        {/*
         * Trois états, pas deux. La valeur : ce qui reste dû. Le vide : rien ne
         * reste. L'absence : sans total lu ou sans décimales du pack, on ne
         * sait pas — et on le dit, plutôt que d'écrire « 0 ».
         */}
        <p className="ech">
          {resteMineur === null ? (
            "—"
          ) : resteMineur > 0 ? (
            <>
              {t("pme.paiement.reste")}{" "}
              <b>
                {resteLisible ?? "—"} {devise}
              </b>
            </>
          ) : (
            t("pme.paiement.solde")
          )}
        </p>
      </div>

      {/* ── ce que le dirigeant centralise ──────────────────────────────
          Le rôle vient de `acces.monAcces`, pas de l'offre : l'écran du
          dossier ne porte aucune valeur d'abonnement, et n'appelle donc pas
          le forfait. La règle de dégradation le lit UNE fois, au layout. */}
      {siege ? (
        <div className="centr calme">
          <i />
          <p>{MOTS.siege}</p>
        </div>
      ) : null}

      {/* ── la chaîne ────────────────────────────────────────────────── */}
      <div className="sec">
        <h2>{MOTS.chaine}</h2>
        <span>
          {nes.length + 1} {MOTS.pieces}
        </span>
      </div>
      <div className="chain">
        <button type="button" className="doc" onClick={() => setPiece(true)}>
          <span className="bd">
            <span className="tp">{nomDuType(piece.documentKind) ?? t("pme.piece.title")}</span>
            <b>{reference ?? t("pme.piece.title")}</b>
            <span className="mt">
              {jourLisible(payload?.document_date) ?? jourLisible(piece.createdAt) ?? "—"}
            </span>
          </span>
          {lisible(payload?.totals?.ttc) ? (
            <span className="vl">{lisible(payload?.totals?.ttc)}</span>
          ) : null}
        </button>
        {nes.map((p) => (
          <Link
            key={p.id}
            className="doc"
            to="/pme/piece/$pieceId"
            params={{ pieceId: p.id }}
            preload="intent"
          >
            <span className="bd">
              <span className="tp">{MOTS.issueDe}</span>
              <b>{nomDuType(p.documentKind) ?? t("pme.piece.title")}</b>
              <span className="mt">{jourLisible(p.createdAt) ?? "—"}</span>
            </span>
          </Link>
        ))}
        {nes.length === 0 ? (
          <div className="doc miss">
            <span className="bd">
              <span className="tp">{MOTS.aRattacher}</span>
              <span className="ask">{MOTS.chaineVide}</span>
            </span>
          </div>
        ) : null}
      </div>
      {/*
       * Le dessin pose ici « Rattacher un document ». Aucun appel du contrat ne
       * rattache un document quelconque à une pièce : `rattacherJustificatif`
       * lie une PREUVE à un PAIEMENT, et une pièce née d'une autre naît avec
       * son `sourcePieceId` à la capture. Plutôt qu'un bouton qui ne mènerait
       * nulle part, l'écran dit où le geste se trouve.
       */}
      <p className="foot">{MOTS.chaineFoot}</p>

      {/* ── ce que j'ai lu, champ par champ ──────────────────────────── */}
      <div className="sec">
        <h2>{t("pme.piece.jaiLu")}</h2>
      </div>
      <div className="lines">
        {lignesCitees.map((l) =>
          l.cle === "date" && l.valeur === null ? (
            /*
             * La pièce ne porte pas de date lisible. On propose le jour du
             * scan — affiché, modifiable — plutôt que de bloquer. La saisie
             * pose une PRÉCISION, qui reprojette les articles ; l'extraction
             * garde sa date vide, c'est ce qui s'est lu sur le document (R7).
             */
            <div className="rg" key={l.cle}>
              <span className="bd">
                <b>{l.label}</b>
                <span className="mt">
                  {dater.isPending ? t("common.loading") : t("piece.date.duScan")}
                </span>
              </span>
              <input
                type="date"
                value={dateRetenue}
                max={new Date().toISOString().slice(0, 10)}
                disabled={dater.isPending}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateSaisie(v);
                  // Un champ `date` rend une chaîne vide tant que la saisie
                  // est incomplète : on n'enregistre que ce qui est une date.
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) dater.mutate(v);
                }}
                className="vl"
              />
            </div>
          ) : byField.get(l.champ) ? (
            <button
              type="button"
              className="rg"
              key={l.cle}
              onClick={() => voirLaSource(l.champ)}
              aria-label={`${l.label} — ${t("pme.citation.show")}`}
            >
              <span className="bd">
                <b>{l.label}</b>
                <span className="recu">
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <path d="M4.5 12.5l4.5 4.5 10-10" />
                  </svg>
                  {t("pme.citation.source")}
                </span>
              </span>
              <span className="vl">{l.valeur ?? "—"}</span>
            </button>
          ) : (
            <div className="rg" key={l.cle}>
              <span className="bd">
                <b>{l.label}</b>
                <span className="mt">{t("pme.citation.missing")}</span>
              </span>
              <span className="vl">{l.valeur ?? "—"}</span>
            </div>
          ),
        )}
      </div>
      <p className="foot">{t("pme.verifie.source")}</p>
      {articles.length > 0 ? (
        <button type="button" className="add" onClick={() => setDetail(true)}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
          {t("pme.detail.voir")}
        </button>
      ) : null}

      {/* ── les règlements ───────────────────────────────────────────────
          UN RÈGLEMENT NE SE MODIFIE PAS : il s'annule par une ligne datée et
          motivée. `capture.motifsDAnnulation` puis `capture.annulerPaiement`
          vivent dans `CommentCEstPaye`, avec la saisie du montant partiel, la
          date déclarée, la référence et la photo de la preuve. L'écran n'ouvre
          aucun second chemin vers ces écritures : deux chemins pour une même
          écriture seraient deux occasions de divergence. */}
      <div className="sec">
        <h2>{vente ? MOTS.encaissements : MOTS.reglements}</h2>
        <span>
          {paiementsVivants.length} {paiementsVivants.length > 1 ? MOTS.mouvements : MOTS.mouvement}
        </span>
      </div>
      {!booked ? (
        <CommentCEstPaye
          pieceId={pieceId}
          visDeLaPiece={piece.vis === "partage" ? "partage" : "personnel"}
          dateDeLaPiece={payload?.document_date ?? null}
          /*
           * Le facteur vient du PACK, pas d'un « × 1000 » écrit ici. Trois
           * décimales sont tunisiennes ; la première juridiction à deux aurait
           * proposé mille fois le montant payé, et l'écran n'aurait rien
           * signalé. R4 : aucune constante réglementaire dans le code.
           */
          ttcMineur={ttcMineur}
          devise={devise}
          /*
           * Le sens vient du TYPE TRANCHÉ, et de nulle part ailleurs. `null`
           * quand il ne l'est pas, et le reçu ne se propose alors pas : un
           * « reçu de dépense » posé sur une vente est un document faux, et un
           * document faux remis à un tiers est pire qu'un document absent.
           */
          sens={achat ? "depense" : vente ? "revenu" : null}
          tiers={payload?.issuer ?? null}
          reference={reference}
          decimales={decimales}
        />
      ) : null}

      {/* ── ce que j'ai vérifié ──────────────────────────────────────── */}
      {controles.length > 0 ? (
        <>
          <div className="sec">
            <h2>{MOTS.verifie}</h2>
            <span>
              {controles.length} {MOTS.points}
            </span>
          </div>
          <div className="ctrl">
            {controles.map((c) => (
              <div className={`ck ${c.k}`} key={c.cle}>
                <i>
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    {c.k === "ok" ? (
                      <path d="M4.5 12.5l4.5 4.5 10-10" />
                    ) : c.k === "q" ? (
                      <>
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M9.6 9.6a2.5 2.5 0 1 1 3.2 2.6c-.6.2-.8.7-.8 1.3v.4" />
                        <path d="M12 17.2v.3" />
                      </>
                    ) : c.k === "az" ? (
                      <>
                        <path d="M8 6.5L4 10.5l4 4" />
                        <path d="M4 10.5h12a4 4 0 0 1 0 8h-6" />
                      </>
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M9 9l6 6M15 9l-6 6" />
                      </>
                    )}
                  </svg>
                </i>
                <div>
                  <p>{c.p}</p>
                  {c.sous ? <p>{c.sous}</p> : null}
                  {c.corps === "sens" ? (
                    /*
                     * La lecture n'a pas pu dire si la pièce est un achat ou
                     * une vente : ni l'émetteur ni le destinataire n'est ce
                     * dossier. Elle ne devine pas ; elle demande. La réponse
                     * s'inscrit à côté de la lecture, datée et signée (R7).
                     */
                    <span className="rep">
                      <button
                        type="button"
                        disabled={preciser.isPending}
                        onClick={() => preciser.mutate("facture_achat")}
                      >
                        {t("pme.sens.achat")}
                      </button>
                      {/*
                       * Pas de `button.sec` ici, bien que le dessin le pose :
                       * dans `styles-pme.css`, `.sec` est AUSSI le titre de
                       * section (`display:flex; margin:1.875rem 0`), et la
                       * règle `.ck .rep button.sec` ne remet ni la marge ni
                       * l'affichage — le bouton descendrait de trente pixels.
                       * Et deux boutons de même poids sont ici la bonne
                       * réponse : ni l'achat ni la vente n'est le défaut.
                       */}
                      <button
                        type="button"
                        disabled={preciser.isPending}
                        onClick={() => preciser.mutate("facture_vente")}
                      >
                        {t("pme.sens.vente")}
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* ── le parcours ─────────────────────────────────────────────── */}
      <div className="sec">
        <h2>{MOTS.parcours}</h2>
        <span>
          {etapes.length} {MOTS.etapes}
        </span>
      </div>
      <div className="jr">
        {etapes.map((e) => (
          <div key={e.cle} className={e.etat === "courante" ? "now" : undefined}>
            <span>{e.label}</span>
            <u>
              {e.etat === "faite"
                ? MOTS.etat.faite
                : e.etat === "courante"
                  ? MOTS.etat.courante
                  : MOTS.etat.attente}
            </u>
          </div>
        ))}
      </div>

      {/* ── la remarque de Malica ───────────────────────────────────── */}
      <div className="note">
        <img src={malicaLoin} alt="Malica" width={620} height={620} />
        <p>
          {booked
            ? t("pme.doc.note")
            : payload?.totals?.ttc
              ? t("pme.verifie.question", {
                  montant: lisible(payload.totals.ttc) ?? "",
                  devise,
                })
              : t("pme.verifie.question.sansTotal")}
        </p>
      </div>
      <p className="foot">{MOTS.foot}</p>

      {error ? (
        <div className="rev">
          <span className="q lock">
            <i />
            {t("common.error")}
          </span>
          <p>{error}</p>
        </div>
      ) : null}

      {/* ── où elle va : la transmission est une DÉCISION ────────────────
          Le 4 octobre « rien ne partait » : le geste existait, personne ne
          l'avait fait, et une ligne de 12,5 px disait « chez vous ». On a
          alors transmis d'office à la photo, et le 7 octobre une facture
          rejetée était déjà partie. Les deux erreurs ont la même cause : la
          transmission n'était pas une décision. Elle l'est ici, en deux
          boutons de même poids — garder une facture chez soi est un choix
          légitime, l'envoyer aussi, et seul le dirigeant sait lequel. */}
      {cabinet.data && !booked ? (
        piece.vis === "partage" ? (
          <div className="centr calme">
            <i />
            <div>
              <p>{t("pme.transmettre.faite", { cabinet: cabinet.data.name })}</p>
              {demandeDeRappel === "demandee" ? (
                <p>{t("pme.transmettre.rappel.enAttente", { cabinet: cabinet.data.name })}</p>
              ) : demandeDeRappel === "refusee" ? (
                <p>{t("pme.transmettre.rappel.refuse", { note: noteDuRappel ?? "" })}</p>
              ) : (
                <button
                  type="button"
                  disabled={rappeler.isPending}
                  onClick={() => rappeler.mutate()}
                >
                  {rappeler.isPending
                    ? t("common.loading")
                    : t("pme.transmettre.rappeler", { cabinet: cabinet.data.name })}
                </button>
              )}
            </div>
          </div>
        ) : piece.gardeeLe ? (
          /*
           * LA DÉCISION PRISE, ET SON CHEMIN DE RETOUR. On ne repose pas la
           * question : elle a été tranchée, et la date le dit. Mais
           * « Transmettre quand même » reste là — « j'ai classé dans mon
           * coffre, j'aurai toujours la possibilité de transmettre au
           * cabinet ». Ce sens-là ne demande rien à personne et ne doit
           * jamais se fermer.
           */
          <div className="rev">
            <span className="q">
              <i />
              {t("pme.garder.faite")}
            </span>
            <div className="b">
              <button
                type="button"
                disabled={transmettre.isPending}
                onClick={() => transmettre.mutate()}
              >
                {transmettre.isPending
                  ? t("common.loading")
                  : t("pme.garder.quandmeme", { cabinet: cabinet.data.name })}
              </button>
            </div>
          </div>
        ) : (
          <div className="rev">
            {/* `.q` est une étiquette d'état, en capitales et en mono : elle
                porte le nom du cabinet, pas la question — une phrase entière
                en capitales de 10 px ne se lit pas. */}
            <span className="q">
              <i />
              {cabinet.data.name}
            </span>
            <p>
              {t("pme.transmettre.question", { cabinet: cabinet.data.name })}{" "}
              {t("pme.transmettre.chezvous")}
            </p>
            <div className="b">
              <button
                type="button"
                disabled={garder.isPending || transmettre.isPending}
                onClick={() => garder.mutate()}
              >
                {garder.isPending ? t("common.loading") : t("pme.garder.action")}
              </button>
              <button
                type="button"
                disabled={transmettre.isPending || garder.isPending}
                onClick={() => transmettre.mutate()}
              >
                {transmettre.isPending ? t("common.loading") : t("pme.transmettre.action")}
              </button>
            </div>
          </div>
        )
      ) : null}

      {/* ── REVENIR DESSUS ──────────────────────────────────────────────
          Ce bloc lit `vis` et le RÔLE, et rien d'autre :

            personnel            → LIBRE : corriger, supprimer, mettre au privé
            entite · siège       → AVANT VALIDATION : corriger, demander la
                                   suppression au dirigeant
            entite · dirigeant   → LIBRE
            partage              → SUR ACCORD : corriger et renvoyer, demander
                                   la suppression au cabinet

          « Corriger » reprend la PHOTO, comme le prototype : R7 interdit
          d'effacer un relevé, et relancer la lecture serait de toute façon
          refusé. Une correction de champ s'ajoute par `capture.preciser`, que
          l'écran propose là où elle a un sens — le sens de la pièce, dans
          « Ce que j'ai vérifié » juste au-dessus. */}
      <div className="sec">
        <h2>{MOTS.revenir}</h2>
        <span>
          {vis === "partage"
            ? MOTS.surAccord
            : vis === "entite" && siege
              ? MOTS.avantValidation
              : MOTS.libre}
        </span>
      </div>
      {vis === "partage" ? (
        <div className="rev">
          <span className="q lock">
            <i />
            {MOTS.elleEstPartie}
          </span>
          <p>{MOTS.elleEstPartieTexte}</p>
          <div className="b">
            <button type="button" onClick={pme.ouvrirScanner}>
              {t("pme.verifie.corriger")}
            </button>
            {/* Une demande déjà inscrite ne se redemande pas : son dernier
                fait est affiché juste en dessous. */}
            {demandeDeSuppression ? null : (
              <button
                type="button"
                className="sup"
                disabled={demanderSuppression.isPending}
                onClick={() => demanderSuppression.mutate()}
              >
                {demanderSuppression.isPending ? t("common.loading") : MOTS.demanderSuppression}
              </button>
            )}
          </div>
          {demandeDeSuppression === "demandee" ? (
            <p>{MOTS.suppressionDemandee}</p>
          ) : demandeDeSuppression === "refusee" ? (
            <p>{MOTS.suppressionRefusee}</p>
          ) : null}
        </div>
      ) : vis === "entite" && siege ? (
        <div className="rev">
          <span className="q lock">
            <i />
            {MOTS.elleAttend}
          </span>
          <p>{MOTS.elleAttendTexte}</p>
          <div className="b">
            <button type="button" onClick={pme.ouvrirScanner}>
              {t("pme.verifie.corriger")}
            </button>
            {demandeDeSuppression ? null : (
              <button
                type="button"
                className="sup"
                disabled={demanderSuppression.isPending}
                onClick={() => demanderSuppression.mutate()}
              >
                {demanderSuppression.isPending ? t("common.loading") : MOTS.demanderSuppression}
              </button>
            )}
          </div>
          {demandeDeSuppression === "demandee" ? (
            <p>{MOTS.suppressionDemandee}</p>
          ) : demandeDeSuppression === "refusee" ? (
            <p>{MOTS.suppressionRefusee}</p>
          ) : null}
        </div>
      ) : (
        <div className="rev">
          <span className="q">
            <i />
            {MOTS.rienNestSorti}
          </span>
          <p>{MOTS.rienNestSortiTexte}</p>
          {confirmerSuppression ? (
            /* Deux temps, jamais un seul : un effacement ne se déclenche pas
               par mégarde. La base refuse de toute façon une pièce transmise,
               engagée dans une écriture, ou servant de justificatif. */
            <>
              <p>{t("pme.supprimer.sur")}</p>
              <div className="b">
                <button
                  type="button"
                  className="sup"
                  disabled={supprimer.isPending}
                  onClick={() => supprimer.mutate()}
                >
                  {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
                </button>
                <button type="button" onClick={() => setConfirmerSuppression(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </>
          ) : (
            <div className="b">
              <button type="button" onClick={pme.ouvrirScanner}>
                {t("pme.verifie.corriger")}
              </button>
              {/* Effacer : offert seulement tant que la pièce n'est partie
                  nulle part, et seulement sur un brouillon. */}
              {piece.vis === "personnel" &&
              (piece.status === "capturee" || piece.status === "lue") ? (
                <button type="button" className="sup" onClick={() => setConfirmerSuppression(true)}>
                  {t("pme.supprimer.action")}
                </button>
              ) : null}
              {/* La remettre au privé n'a de sens que si elle n'y est pas. */}
              {piece.vis !== "personnel" ? (
                <button
                  type="button"
                  disabled={remettreAuPrive.isPending}
                  onClick={() => remettreAuPrive.mutate()}
                >
                  {remettreAuPrive.isPending ? t("common.loading") : MOTS.mettreAuPrive}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── les actions du bas ──────────────────────────────────────────
          Une seule action principale par écran. Tant que la pièce n'est pas
          comptabilisée, c'est le « Oui » : la raison d'un refus est déjà
          au-dessus, dans « Ce que j'ai vérifié » — le bouton n'est qu'un
          rappel de ce qui viendra après. */}
      <div className="acts">
        <button type="button" onClick={() => setPiece(true)}>
          {t("pme.piece.voir")}
        </button>
        {booked ? (
          <button type="button" className="pr" onClick={() => setDetail(true)}>
            {t("pme.detail.voir")}
          </button>
        ) : (
          <button
            type="button"
            className="pr"
            disabled={confirm.isPending || !confirmable}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? t("pme.confirm.pending") : t("pme.verifie.oui")}
          </button>
        )}
      </div>
    </div>
  );
}
