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
import { libelleDuChamp } from "@/lib/champ-lisible";
import { droitsDeLaPiece } from "@/lib/droits-de-la-piece";
import { montant, quantite } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { Citation } from "@malica/socle/ports/repositories";
import { leSensResteADemander } from "@malica/socle/sens-de-la-piece";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { codeDuVerdict } from "@malica/socle/verdicts";

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

/**
 * Du nom métier d'un champ vers son libellé d'écran.
 *
 * La correspondance vit ICI, et non dans le cas d'usage : le Socle nomme ses
 * champs, il n'a pas à connaître les clés de traduction. Et le compilateur
 * vérifie chaque clé — un libellé oublié ne passe pas.
 */
/** Les raisons MÉTIER pour lesquelles une lecture s'arrête, et leur phrase. */
const MESSAGE_DU_CODE_DE_LECTURE: Record<string, MessageKey> = {
  "lecture.illisible": "pme.lire.illisible",
  "lecture.vide": "pme.lire.vide",
  "lecture.trop_longue": "pme.lire.tropLongue",
  "lecture.trop_dense": "pme.lire.tropDense",
};

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
 * Écran PME. Le geste cœur : voir la zone source, confirmer en un tap.
 * L'écriture proposée et les signalements de lecture n'apparaissent pas ici :
 * ils appartiennent à la supervision du cabinet.
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
   * Une photo ratée, un reçu personnel, un document qui n'a rien à faire là :
   * il n'existait aucun moyen de l'effacer, et le coffre accumulait.
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
   * Le sens de la pièce, quand la lecture n'a pas pu le dire : un achat ou
   * une vente. La réponse est une entrée nouvelle (jamais une modification
   * de la lecture) ; le dossier la rend ensuite comme si elle avait été lue.
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
   * Elle manquait. Le commentaire d'à côté affirmait « deux boutons de même
   * poids » et il n'y en avait qu'un ; garder était ce qui arrivait quand on
   * ne faisait rien. Pire : rien ne distinguait « j'ai décidé de la garder »
   * de « je n'ai pas encore répondu », donc la question revenait à chaque
   * visite — et un écran qui redemande ce qu'on vient de lui dire apprend à
   * ne plus répondre.
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
   * Le geste inverse SE DEMANDE, il ne se prend pas.
   *
   * Le 10 octobre j'avais livré un rappel unilatéral, pour sortir d'un état
   * qu'on n'avait pas choisi. Le commanditaire a tranché le lendemain : « le
   * rappel de la pièce doit être approuvé par le cabinet ».
   *
   * Il a raison, et j'avais corrigé un défaut par un autre : le cabinet
   * travaille sur ce qu'il a reçu, et une pièce qui disparaît de sa file sans
   * un mot est pire que l'état bloqué qu'on voulait défaire.
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

  // L'état de la demande, s'il y en a une : son dernier fait.
  const demandes = useQuery({
    queryKey: ["demandes-piece", pieceId],
    queryFn: () => office().collab.demandesDUnePiece(pieceId),
  });
  const dernierFaitDuRappel = demandes.data?.find((d) => d.objet === "rappel") ?? null;
  const demandeDeRappel = dernierFaitDuRappel?.fait ?? null;
  const noteDuRappel = dernierFaitDuRappel?.note ?? null;

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
       * phrase dans la langue du dirigeant. Un message qui n'est pas un code
       * connu est technique : il va au journal, l'écran dit seulement qu'il
       * n'a pas pu.
       */
      // Une requête morte n'est pas une lecture morte : le serveur continue.
      // On attend, et le dossier dira quand c'est lu.
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
   * ================================================ LA DATE QUAND LA PIÈCE N'EN PORTE PAS
   *
   * Certaines pièces n'affichent aucune date lisible : un ticket effacé, un
   * bon de livraison, un coin plié. Sans date, aucun taux de TVA n'est
   * applicable et rien ne peut être comptabilisé — la pièce restait bloquée.
   *
   * On propose donc le JOUR DU SCAN. Mais on ne le glisse pas en douce dans la
   * lecture : il s'affiche, il est modifiable, et il ne devient la date de la
   * pièce qu'au moment où l'utilisateur confirme. L'extraction, elle, garde sa
   * date vide — c'est ce qui s'est réellement lu sur le document.
   *
   * La distinction n'est pas une subtilité : une facture de janvier scannée en
   * mars et datée de mars part dans la mauvaise déclaration de TVA. C'est à
   * l'utilisateur de dire quelle est la vraie date ; nous ne faisons que la
   * pré-remplir avec la seule que nous connaissions.
   */
  const jourDuScan = (dossier.data?.piece.createdAt ?? new Date().toISOString()).slice(0, 10);
  const [dateSaisie, setDateSaisie] = useState<string | null>(null);
  const dateRetenue = dateSaisie ?? jourDuScan;

  /*
   * La proposition d'écriture est calculée par le SERVEUR (3B-6) : depuis les
   * montants imprimés et normalisés, seulement si le verdict de la pièce la
   * déclare comptabilisable. L'écran ne compose plus rien ; il montre ce que le
   * serveur propose, ou la raison pour laquelle il ne propose rien. La date
   * saisie ne complète qu'une date non lue.
   */
  /*
   * Les droits hors TVA, et le pack qui les nomme.
   *
   * Le libellé et la référence légale d'un droit vivent dans `ref.fiscal_charges`,
   * datés et versionnés : on les lit (R4), on ne les écrit pas dans l'écran.
   * Si le pack n'a pas encore répondu, le droit s'affiche quand même sous son
   * code, signalé — c'est l'ABSENCE du timbre qui a coûté le 4 octobre, pas un
   * libellé imparfait.
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
         * précision reste datée et signée à côté de la lecture.
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

  const { piece, contenu, extraction, citations } = dossier.data;
  /*
   * ================================ LE SENS SE DEMANDE UNE FOIS, PAS DEUX
   *
   * 13 octobre 2026 : « il y a une deuxième fois où l'app demande achat ou
   * vente ». C'est exact, et c'est systématique sur le cas le plus courant de
   * la facture d'achat tunisienne. Le fil :
   *
   *   1. à la capture, la personne répond « une facture que j'ai reçue », et
   *      la réponse est inscrite sur la PIÈCE ;
   *   2. la lecture ne tranche pas — le fournisseur n'imprime pas le matricule
   *      du client, ce qui est normal sur un achat — donc la lecture rend un
   *      sens nul ;
   *   3. cette condition ne regardait QUE la lecture, et reposait la question.
   *
   * Vérifié en base le 13 octobre : deux pièces du dirigeant portent à la fois
   * le type déclaré « facture_achat » ET une précision enregistrée. Il a bien
   * répondu deux fois, à quelques secondes d'intervalle.
   *
   * La réponse était pourtant là, dans le même objet, à deux champs de
   * distance — ce fichier lit déjà le statut de ce type, un peu plus haut.
   *
   * Une déclaration qui n'est ni un achat ni une vente — un relevé bancaire,
   * un ticket — ne répond pas à la question et ne la clôt donc pas.
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
  const jourLisible = (iso: string | undefined) => {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  /**
   * « Classé dans … » — le libellé du compte principal que le Socle a retenu.
   *
   * Pas une catégorie d'écran : la première ligne de l'écriture proposée, donc
   * exactement ce qui sera comptabilisé. Dire autre chose ici serait promettre
   * un classement que le grand livre ne confirmerait pas.
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
  /**
   * Pourquoi la confirmation est impossible, DIT À LA PERSONNE.
   *
   * Le serveur rend deux choses : un `verdict` — qui est un code, même s'il
   * s'écrit en français — et une `raison` en prose, faite pour le cabinet.
   * L'écran de la PME ne rend que le premier, traduit. La prose reste au
   * cabinet, qui en parle la langue.
   *
   * Le repli n'est pas un défaut caché : un verdict inconnu donne la phrase
   * générique, et le dirigeant sait quand même qu'il doit attendre.
   */
  /*
   * ============================== ON BRANCHE SUR UN CODE, PAS SUR UNE PHRASE
   *
   * Cette comparaison était `verdict === "à rejeter"` : un code écrit en
   * français, comparé accent par accent, dans un autre paquet que celui qui le
   * produit. Le jour où quelqu'un reformule « à rejeter », l'écran tombait
   * silencieusement sur sa phrase générique — et aucune épreuve ne l'aurait vu,
   * parce que la comparaison compile et que le repli est légitime.
   *
   * La conversion vit au Socle, en un seul endroit, avec son épreuve.
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
   * Le prototype ne montre ni base ni TTC dans le détail : l'émetteur, la
   * date, et LA TVA — parce que c'est la seule des trois qui soit de l'argent
   * pour le dirigeant. Le total, lui, est déjà encadré au-dessus.
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
   * Plein écran, sans la barre basse : le prototype la retire pendant la
   * lecture et pendant le soulagement. Ce sont les deux seuls moments où le
   * produit demande qu'on ne fasse rien d'autre.
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
         * le dossier le dira. Rester devant n'est pas une obligation — c'est
         * le geste natif attendu, et une lecture dure des minutes.
         */}
        <Link
          to="/pme/list"
          className="mt-8 inline-flex min-h-[44px] items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t("pme.lecture.arrierePlan")}
        </Link>
        {/*
         * Le prototype annonce « Relevé · 312 mots situés ». On ne l'affiche
         * que lorsqu'un relevé existe déjà — à la relecture d'une pièce. En
         * première lecture le compte n'existe pas encore, et l'inventer
         * contredirait la phrase juste au-dessus.
         */}
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
           * On ne dit « transmis » que si la pièce l'est VRAIMENT.
           *
           * Cette phrase annonçait la transmission au cabinet dans tous les
           * cas, parce que la capture partageait tout d'office. Maintenant que
           * la transmission est un geste, la promettre sans qu'elle ait eu
           * lieu serait un mensonge — et sur une pièce comptable, un mensonge
           * qui coûte cher à découvrir.
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
   * La visionneuse n'occupe plus la moitié de l'écran en permanence : le
   * prototype ne la montre nulle part dans le parcours. Elle s'ouvre par
   * « Voir la facture », ou par une source citée — et c'est alors la zone
   * exacte qui s'affiche, ce qui est tout l'intérêt.
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
           * Le NOM du champ, pas son chemin.
           *
           * Cette ligne rendait `zoom.field` — le chemin machine dans
           * l'extraction — avec la classe `uppercase`. La personne lisait donc
           * « ISSUER » sous la photo de sa facture, en capitales anglaises,
           * alors que `pme.extract.issuer` existe dans les trois langues.
           *
           * Le traducteur de chemins était écrit, testé, et utilisé par l'écran
           * du cabinet. Il n'était simplement pas importé ici. Et rien
           * n'interdisait d'afficher un identifiant machine : ni test, ni règle
           * de lint — c'est la dette D42.
           *
           * `num` est retiré avec le chemin : cette classe sert aux chiffres.
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
   *
   * Les articles viennent du contrat de lecture, jamais d'une saisie.
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
               * LE PIED DE FACTURE EN ENTIER, et pas seulement la base.
               *
               * Le 7 octobre 2026, le commanditaire signale : « la TVA n'est
               * pas affichée ». Elle était bien lue — 2,347 sur la facture
               * CASA-ELECT — mais ce pied ne montrait QUE la base HT. Ni TVA,
               * ni droits, ni total.
               *
               * C'est le même défaut que le timbre invisible du 4 octobre : la
               * valeur existe, le contrat la porte, et l'écran s'arrête avant.
               * Montrer une base sans sa TVA et sans son total laisse la
               * personne incapable de vérifier que le produit a bien lu — ce
               * qui est la seule chose qu'on lui demande.
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

  /* ============================================== JE VÉRIFIE  /  LA PIÈCE LUE
   *
   * Une seule colonne, comme le prototype. Avant confirmation c'est une
   * question ; après, c'est le parcours de la pièce en une ligne.
   */
  return (
    <div className="rg-rise flex flex-col gap-0 px-1 pt-2">
      {booked ? (
        <>
          <button
            type="button"
            onClick={() => void navigateList()}
            className="self-start text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <p className="mt-3 text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {payload?.issuer ?? t("pme.piece.title")}
          </p>
          <p className="num mt-[5px] text-[13.5px] font-medium text-text-2">
            {reference ? reference + " · " : ""}
            {lisible(payload?.totals?.ttc) ?? "—"} {payload?.currency ?? pme.currency}
          </p>
          <Parcours etapes={etapes} />
        </>
      ) : (
        <p className="text-[25px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.verifie.titre.1")}
          <br />
          {t("pme.verifie.titre.2")}
        </p>
      )}

      {/* Ce que la lecture a relevé, brut, tel que la pièce le dit. */}
      <div className="mt-4 border border-border bg-card">
        <div className="border-b border-border px-4 py-3.5 font-mono text-[11px] leading-[1.85] text-text-2">
          {payload?.issuer ?? "—"}
          {reference ? " · " + reference : ""}
          <br />
          {t("pme.extract.base")} {lisible(payload?.totals?.base_ht) ?? "—"}
          <br />
          {t("pme.extract.vat")} {lisible(payload?.totals?.vat) ?? "—"}
          {/*
           * Les droits hors TVA — le timbre, surtout.
           *
           * Le 4 octobre 2026, le timbre de la facture de loyer était lu,
           * exact, en base, et invisible : `other_charges` n'apparaissait
           * qu'une fois dans ce fichier, dans la déclaration de type. C'est
           * aussi lui qui fait la différence entre HT + TVA et le TTC imprimé :
           * ne pas le montrer rendait l'écart inexplicable à l'écran.
           *
           * Le libellé vient du pack (R4), avec sa référence légale quand il la
           * porte : « d'où vient ce chiffre » doit avoir une réponse ici.
           */}
          {droits.map((d, i) => (
            <span key={`${d.code}-${i}`}>
              <br />
              {d.libelle} {lisible(d.montant) ?? "—"}
              {d.reference ? ` · ${d.reference}` : ""}
              {d.connu ? "" : ` · ${t("pme.extract.droitInconnu")}`}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-3.5">
          <span className="text-[13px] font-semibold">{t("pme.verifie.total")}</span>
          <span className="num border border-foreground px-2.5 py-[3px] text-[17px] font-medium">
            {lisible(payload?.totals?.ttc) ?? "—"}
          </span>
        </div>
      </div>

      <div className="mt-[22px] flex items-baseline justify-between gap-3 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {booked ? t("pme.piece.jaiLu") : t("pme.verifie.source")}
        </p>
        {articles.length > 0 ? (
          <button
            type="button"
            onClick={() => setDetail(true)}
            className="border-b border-dotted border-current text-[11px] font-medium text-signal-info"
          >
            {t("pme.detail.voir")}
          </button>
        ) : null}
      </div>

      {lignesCitees.map((l) => (
        <div
          key={l.cle}
          className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
        >
          <span className="text-[13.5px] text-text-2">{l.label}</span>
          {l.cle === "date" && l.valeur === null ? (
            /*
             * La pièce ne porte pas de date lisible. On propose le jour du
             * scan — affiché, modifiable — plutôt que de bloquer. Il ne
             * devient la date de l'écriture qu'à la confirmation.
             */
            <span className="flex flex-col items-end gap-1">
              {/*
               * ============================== ET LA DATE S'ENREGISTRE, ENFIN
               *
               * Ce champ existait et ne servait QU'À la proposition
               * d'écriture : l'écriture était datée, et la pièce restait sans
               * mois. Elle continuait donc de figurer dans « ces pièces
               * attendent leur date », après que la personne ait répondu —
               * et son montant restait hors des charges du mois.
               *
               * La saisie pose désormais une PRÉCISION, qui reprojette les
               * articles. L'extraction, elle, garde sa date vide : c'est ce
               * qui s'est réellement lu sur le document (R7).
               */}
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
                className="num border border-border bg-card px-2 py-1 text-[13.5px] font-medium disabled:opacity-50"
              />
              <span className="text-[11px] text-muted-foreground">
                {dater.isPending ? t("common.loading") : t("piece.date.duScan")}
              </span>
            </span>
          ) : (
            <span className="num text-[13.5px] font-medium">
              {l.valeur ?? "—"}
              {byField.get(l.champ) ? (
                <button
                  type="button"
                  onClick={() => voirLaSource(l.champ)}
                  className="ms-2 border-b border-dotted border-current text-[11px] font-medium text-signal-info"
                >
                  {t("pme.citation.source")}
                </button>
              ) : null}
            </span>
          )}
        </div>
      ))}

      {booked ? (
        <div className="flex items-center justify-between gap-3 border-t border-foreground py-3">
          <span className="text-[13.5px] font-semibold">{t("pme.piece.classee")}</span>
          <span className="text-[13.5px]">{classement}</span>
        </div>
      ) : null}

      {/* Sa question, pas un ordre : c'est le dirigeant qui tranche. */}
      {!booked ? (
        <div className="mt-5 flex gap-3">
          <MalicaAvatar size={32} alt="Malica" rond />
          <p className="text-[15px] leading-[1.5]">
            {payload?.totals?.ttc
              ? t("pme.verifie.question", {
                  montant: lisible(payload.totals.ttc) ?? "",
                  devise: payload.currency ?? pme.currency,
                })
              : t("pme.verifie.question.sansTotal")}
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-signal-warn">{error}</p> : null}

      <div className="mt-6 flex flex-col gap-0.5 pb-2">
        {booked ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPiece(true)}
              className="h-12 bg-foreground text-[14px] font-semibold text-background"
            >
              {t("pme.piece.voir")}
            </button>
            <button
              type="button"
              onClick={() => setDetail(true)}
              className="h-12 border border-foreground text-[14px] font-semibold"
            >
              {t("pme.detail.voir")}
            </button>
          </div>
        ) : (
          <>
            {/*
             * ============================ LA RAISON PASSE DEVANT LE BOUTON MORT
             *
             * 10 octobre 2026. Le commanditaire surligne ce que l'écran lui
             * montrait sous un bouton gris :
             *
             *   « Aucune écriture ne se propose : la pièce est « anomalie à
             *     signaler ». Aucun montant n'est retenu — ils sont à saisir :
             *     montant illisible : « 514,700 514,700 ». »
             *
             *   « Le texte sélectionné ne doit pas apparaître aux PME. »
             *
             * Il a raison deux fois. Cette phrase est construite côté serveur
             * en collant un VERDICT — qui est une chaîne française servant de
             * code — à des motifs techniques ; elle ne se traduit pas, et elle
             * parle le vocabulaire de l'outil, pas celui du dirigeant.
             *
             * Et sa place était fausse : 12,5 px, centrée, SOUS le bouton,
             * donc hors de l'écran. Ce que le dirigeant voyait, c'était le
             * plus gros élément de la page, gris, sans explication.
             *
             * Quand une action est impossible, la RAISON est l'information
             * principale. Le bouton n'est qu'un rappel de ce qui viendra
             * après.
             */}
            {!confirmable && !sensIndetermine ? (
              <div className="mb-3 border-s-[3px] border-signal-warn bg-accent px-3.5 py-3">
                <p className="text-[14.5px] font-medium leading-[1.45]">{raisonDuBlocage}</p>
                <p className="mt-1.5 text-[13px] leading-[1.45] text-text-2">
                  {t("pme.bloque.geste")}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={confirm.isPending || !confirmable}
              onClick={() => confirm.mutate()}
              className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background disabled:opacity-50"
            >
              {confirm.isPending ? t("pme.confirm.pending") : t("pme.verifie.oui")}
            </button>
            {/*
             * « Corriger » reprend la PHOTO, comme le prototype. Relancer la
             * lecture serait de toute façon refusé : R7 interdit d'effacer un
             * relevé, et c'est par là que commence `capture_read_persist`.
             */}
            <button
              type="button"
              onClick={pme.ouvrirScanner}
              className="h-[50px] w-full text-[16px] font-medium"
            >
              {t("pme.verifie.corriger")}
            </button>
            {sensIndetermine ? (
              /*
               * La lecture n'a pas pu dire si la pièce est un achat ou une
               * vente : ni l'émetteur ni le destinataire n'est ce dossier.
               * Elle ne devine pas ; elle demande. La réponse est enregistrée
               * à côté de la lecture, datée et signée.
               */
              <div className="mt-2 border border-border bg-card p-4">
                <p className="text-[14px] font-medium">{t("pme.sens.question")}</p>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
                  {t("pme.sens.pourquoi")}
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => preciser.mutate("facture_achat")}
                    disabled={preciser.isPending}
                    className="min-h-[46px] border border-foreground px-3 text-[14px] font-medium disabled:opacity-40"
                  >
                    {t("pme.sens.achat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => preciser.mutate("facture_vente")}
                    disabled={preciser.isPending}
                    className="min-h-[46px] border border-foreground px-3 text-[14px] font-medium disabled:opacity-40"
                  >
                    {t("pme.sens.vente")}
                  </button>
                </div>
              </div>
            ) : null}

            {/*
             * ============================ LE PAIEMENT, AVANT LE RANGEMENT
             *
             * Il descend sous les montants, sur la MÊME page : quatre écrans
             * font quatre occasions d'abandonner. Et il vient avant « où ça
             * va », parce qu'une pièce qui part au cabinet doit partir avec
             * la façon dont elle a été réglée.
             */}
            <CommentCEstPaye
              pieceId={pieceId}
              visDeLaPiece={piece.vis === "partage" ? "partage" : "personnel"}
              dateDeLaPiece={payload?.document_date ?? null}
              /*
               * Le facteur vient du PACK, pas d'un « × 1000 » écrit ici.
               * Trois décimales sont tunisiennes ; la première juridiction à
               * deux aurait proposé mille fois le montant payé, et l'écran
               * n'aurait rien signalé. R4 : aucune constante réglementaire
               * dans le code.
               */
              ttcMineur={
                payload?.totals?.ttc && decimales !== null
                  ? Math.round(Number(payload.totals.ttc) * 10 ** decimales)
                  : null
              }
              devise={payload?.currency ?? pme.currency}
              /*
               * Le sens vient du TYPE TRANCHÉ, et de nulle part ailleurs.
               * `null` quand il ne l'est pas, et le reçu ne se propose alors
               * pas : un « reçu de dépense » posé sur une vente est un
               * document faux, et un document faux remis à un tiers est pire
               * qu'un document absent.
               */
              sens={
                payload?.document_kind === "facture_achat"
                  ? "depense"
                  : payload?.document_kind === "facture_vente"
                    ? "revenu"
                    : null
              }
              tiers={payload?.issuer ?? null}
              reference={reference}
              decimales={decimales}
            />

            {/*
             * ==================================== LA TRANSMISSION EST UN GESTE
             *
             * Toute pièce photographiée partait au cabinet automatiquement —
             * un reçu personnel, une photo ratée, un document sans rapport.
             * Personne ne l'avait décidé.
             *
             * Elle reste maintenant chez le dirigeant jusqu'à ce qu'il appuie.
             * Et l'écran dit toujours où elle en est : chez vous, ou partie.
             */}
            {cabinet.data ? (
              <div className="mt-4 border-t border-border pt-4">
                {piece.vis === "partage" ? (
                  /*
                   * ======================================== ET ON PEUT REVENIR
                   *
                   * 10 octobre 2026 : « facture transmise au comptable sans
                   * autorisation ». La pièce avait été photographiée par une
                   * version antérieure, qui partageait à la prise de vue — ce
                   * qui est corrigé depuis le 7 octobre.
                   *
                   * Mais l'écran n'offrait RIEN. Il annonçait « Transmise à
                   * AUDICORP » et s'arrêtait là : aucune manière de revenir,
                   * pour une pièce que personne n'avait décidé d'envoyer.
                   *
                   * Un état qu'on n'a pas choisi et dont on ne peut pas sortir
                   * est le pire des deux. Le geste inverse existait déjà au
                   * coffre ; il manquait seulement ici, là où la question se
                   * pose.
                   *
                   * Une pièce déjà comptabilisée, elle, ne se rappelle pas —
                   * la base le refuse, et c'est juste : on ne retire pas une
                   * pièce sur laquelle une écriture s'appuie.
                   */
                  <div className="text-center">
                    <p className="text-[13px] text-signal-ok">
                      {t("pme.transmettre.faite", { cabinet: cabinet.data.name })}
                    </p>
                    {demandeDeRappel === "demandee" ? (
                      <p className="mt-2 text-[12.5px] text-text-2">
                        {t("pme.transmettre.rappel.enAttente", { cabinet: cabinet.data.name })}
                      </p>
                    ) : demandeDeRappel === "refusee" ? (
                      <p className="mt-2 text-[12.5px] text-signal-warn">
                        {t("pme.transmettre.rappel.refuse", { note: noteDuRappel ?? "" })}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => rappeler.mutate()}
                        disabled={rappeler.isPending}
                        className="mt-2 h-[40px] px-3 text-[13.5px] font-medium underline underline-offset-4 disabled:opacity-40"
                      >
                        {t("pme.transmettre.rappeler", { cabinet: cabinet.data.name })}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/*
                     * LA QUESTION, POSÉE — pas une mention qu'on peut manquer.
                     *
                     * Le 4 octobre, « rien ne partait » : le geste existait,
                     * personne ne l'avait fait, et une ligne de 12,5 px disait
                     * « chez vous ». On a alors transmis d'office à la photo, et
                     * le 7 octobre une facture rejetée était déjà partie.
                     *
                     * Les deux erreurs ont la même cause : la transmission
                     * n'était pas une DÉCISION. Elle l'est ici, en deux boutons
                     * de même poids. Aucun n'est présenté comme le bon : garder
                     * une facture chez soi est un choix légitime, l'envoyer
                     * aussi, et seul le dirigeant sait lequel.
                     */}
                    {piece.gardeeLe ? (
                      /*
                       * LA DÉCISION PRISE, ET SON CHEMIN DE RETOUR.
                       *
                       * On ne repose pas la question : elle a été tranchée, et
                       * la date le dit. Mais « Transmettre quand même » reste
                       * là, parce que c'est l'exemple même du commanditaire —
                       * « j'ai classé dans mon coffre, j'aurai toujours la
                       * possibilité de transmettre au cabinet ». Ce sens-là ne
                       * demande rien à personne et ne doit jamais se fermer.
                       */
                      <div className="text-center">
                        <p className="text-[13px] text-text-2">{t("pme.garder.faite")}</p>
                        <button
                          type="button"
                          disabled={transmettre.isPending}
                          onClick={() => transmettre.mutate()}
                          className="mt-2 h-[40px] px-3 text-[13.5px] font-medium underline underline-offset-4 disabled:opacity-40"
                        >
                          {transmettre.isPending
                            ? t("common.loading")
                            : t("pme.garder.quandmeme", { cabinet: cabinet.data.name })}
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="pb-3 text-[13.5px] font-semibold leading-[1.4]">
                          {t("pme.transmettre.question", { cabinet: cabinet.data.name })}
                        </p>
                        {/*
                         * DEUX BOUTONS DE MÊME POIDS — et cette fois ils sont
                         * deux.
                         *
                         * Le 11 octobre : « et le choix entre transmettre au
                         * cabinet ou espace privé ? » Il n'existait pas :
                         * « Transmettre » tenait toute la largeur, et garder
                         * se lisait dans une ligne de 12,5 px qu'on ne tape
                         * pas. Aucun des deux n'est présenté comme le bon —
                         * garder une facture chez soi est un choix légitime,
                         * l'envoyer aussi, et seul le dirigeant sait lequel.
                         */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={garder.isPending || transmettre.isPending}
                            onClick={() => garder.mutate()}
                            className="h-[50px] border border-foreground text-[14.5px] font-medium disabled:opacity-50"
                          >
                            {garder.isPending ? t("common.loading") : t("pme.garder.action")}
                          </button>
                          <button
                            type="button"
                            disabled={transmettre.isPending || garder.isPending}
                            onClick={() => transmettre.mutate()}
                            className="h-[50px] border border-foreground bg-foreground text-[14.5px] font-medium text-background disabled:opacity-50"
                          >
                            {transmettre.isPending
                              ? t("common.loading")
                              : t("pme.transmettre.action")}
                          </button>
                        </div>
                        <p className="pt-2.5 text-center text-[12.5px] text-text-2">
                          {t("pme.transmettre.chezvous")}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {/* Effacer : offert seulement tant que la pièce n'est partie nulle
                part. La base refuse de toute façon dans les autres cas. */}
            {piece.vis === "personnel" &&
            (piece.status === "capturee" || piece.status === "lue") ? (
              <div className="mt-3">
                {confirmerSuppression ? (
                  <div className="space-y-2 border border-signal-warn p-3">
                    <p className="text-center text-[12.5px] text-signal-warn">
                      {t("pme.supprimer.sur")}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={supprimer.isPending}
                        onClick={() => supprimer.mutate()}
                        className="h-[44px] flex-1 bg-signal-warn text-[14px] font-semibold text-background disabled:opacity-50"
                      >
                        {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmerSuppression(false)}
                        className="h-[44px] flex-1 border border-border text-[14px] font-medium"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmerSuppression(true)}
                    className="w-full py-2 text-center text-[12.5px] text-muted-foreground underline underline-offset-4"
                  >
                    {t("pme.supprimer.action")}
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Le parcours d'une pièce, en une ligne.
 *
 * Les six étapes sont celles du prototype, dans NOTRE ordre : chez nous une
 * pièce est comptabilisée avant d'être vue par le cabinet, pas l'inverse.
 * Garder l'ordre de la maquette aurait dessiné un circuit qui n'existe pas.
 *
 * « Déclarée » reste toujours en attente : rien dans le produit ne marque
 * encore qu'une pièce est partie avec une déclaration. Une étape grise qui
 * dit « pas encore » vaut mieux qu'une étape absente qui laisse croire que le
 * parcours s'arrête là.
 */
function Parcours({ etapes }: { etapes: Array<{ cle: string; label: string; etat: string }> }) {
  return (
    <div className="relative mt-[22px] grid grid-cols-6 items-start">
      <span aria-hidden className="absolute inset-x-[8%] top-[5px] h-px bg-line-strong" />
      {etapes.map((e) => (
        <span key={e.cle} className="relative flex flex-col items-center gap-2">
          <span
            aria-hidden
            className={
              e.etat === "courante"
                ? "h-[13px] w-[13px] -mt-px bg-marigold"
                : e.etat === "faite"
                  ? "h-[11px] w-[11px] bg-foreground"
                  : "h-[11px] w-[11px] border-[1.5px] border-line-strong bg-background"
            }
          />
          <span
            className={
              "text-center text-[8.5px] font-semibold uppercase tracking-[0.06em] " +
              (e.etat === "courante"
                ? "text-marigold"
                : e.etat === "faite"
                  ? ""
                  : "text-muted-foreground")
            }
          >
            {e.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
  zoomLabel: string;
  missingLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="text-end">
        <span className={props.mono ? "num" : ""}>{props.value ?? "—"}</span>
        <button
          type="button"
          onClick={() => props.onZoom(props.citation)}
          disabled={!props.citation}
          className="ms-3 min-h-[44px] text-[11px] uppercase tracking-wide text-muted-foreground underline disabled:no-underline"
        >
          {props.citation ? props.zoomLabel : props.missingLabel}
        </button>
      </dd>
    </div>
  );
}

function Amount(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onZoom(props.citation)}
      disabled={!props.citation}
      className="min-h-[48px] min-w-0 border border-border px-3 py-2 text-start disabled:opacity-60"
    >
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <span className="num block break-words">{props.value ?? "—"}</span>
    </button>
  );
}
