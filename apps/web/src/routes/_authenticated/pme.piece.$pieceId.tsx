/**
 * La fiche d'une pièce (PME) — lecture citée, règlement et suivi d'une facture ou d'un reçu.
 *
 * Route `/pme/piece/$pieceId`, l'écran du dirigeant ou de son collaborateur. Une carte de
 * décision, puis trois onglets — Lecture, Règlement, Suivi — que `?onglet=` peut ouvrir.
 * Les données viennent du dossier de la pièce (`capture.dossier`), des gestes du circuit
 * (envoyer, garder, renvoyer, supprimer, demander au cabinet) et des droits de la personne :
 * l'écran propose ce que la base accepte, il ne devine pas un rôle.
 *
 * Ce qui est sensible ici : une correction ajoute une précision à côté de la lecture sans la
 * réécrire (R7) ; un règlement ne se modifie pas, il s'annule par une ligne motivée ; une pièce
 * transmise ne revient que sur accord du cabinet. Une pièce absente se dit calmement, sans
 * message de panne. `remountDeps` remonte l'écran à chaque pièce.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { totalDesPaiements } from "@/lib/total-des-paiements";

import { useDecimales } from "@/hooks/use-decimales";
import { useSuperposition } from "@/hooks/use-superposition";

import { useI18n, type MessageKey } from "@/i18n";
import { AffichageSignale } from "@/components/malica/affichage-signale";
import { CommentCEstPaye } from "@/components/malica/comment-c-est-paye";
import { QuestionDuType } from "@/components/malica/question-du-type";
import { NomDeLEmetteur } from "@/components/malica/nom-de-l-emetteur";
import { usePme } from "@/components/malica/pme-context";
import { DocumentView } from "@/components/malica/document-view";
import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { Aide } from "@/components/malica/aide";
import { PieceQuiAccompagneFiche } from "@/components/malica/piece-qui-accompagne";
import { RattacherUnDocument } from "@/components/malica/rattacher-un-document";
import { CarteDuRetour } from "@/components/malica/retour-du-cabinet";
import { DemandeDuSiege } from "@/components/malica/demande-du-siege";
import { RetournerAuClient } from "@/components/malica/retourner-au-client";
import { ConfirmationSurPlace, EcranEnvoye, PasEncoreParti } from "@/components/malica/envoye";
import { RefusDeLecture } from "@/components/malica/lecture-refusee";
import { LignesAVerifier } from "@/components/malica/lignes-a-verifier";
import { VersionPrecedente } from "@/components/malica/version-precedente";
import {
  libelleDuChamp,
  libelleDuRefus,
  motifDeLEtat,
  motifDeRefusConnu,
} from "@/lib/champ-lisible";
import { jourEtMois, momentDeLEnvoi, montant, quantite } from "@/lib/lisible";
import { pieceSuivanteATransmettre } from "@/lib/envoi";
import { office } from "@/verticals/malica-office/composition";
import type { Citation, EnvoiDUnePiece, GesteDeRetour } from "@malica/socle/ports/repositories";
import { STATUTS_PRECISABLES } from "@malica/socle/statut-de-la-piece";
import { estIntrouvable, texteDeLErreur } from "@/lib/erreur-lisible";
import { codeDuVerdict } from "@malica/socle/verdicts";
import { droitsDeLaPiece } from "@/lib/droits-de-la-piece";
import { depuisUniteMineure, enUnitesExactes } from "@malica/socle/somme-decimale";
import { clePiecesLues, usePiecesLues } from "@/hooks/use-pieces-lues";
import { useDossiers } from "@/hooks/use-dossiers";
import { useMonCabinet } from "@/hooks/use-mon-cabinet";
import { aLeDroit, useMonAcces } from "@/hooks/use-mon-acces";
import { useDestinationDeLEnvoi } from "@/hooks/use-destination-de-l-envoi";
import {
  useDemander,
  useEnvoyer,
  useGarder,
  useGestesDuCircuit,
  useMettreAuPrive,
  useRenvoyer,
  useResteAEnvoyer,
  useSupprimer,
} from "@/hooks/use-gestes-du-circuit";
import { dossierDeLaPiece } from "@/lib/dossiers";
import { RAISON_LONGUE } from "@/lib/lecture";
import { cn } from "@/lib/utils";
import {
  dateAEnregistrer,
  etiquetteDeLecture,
  noteDeSuppression,
  ouEnEstLaPiece,
  partageeAvecLeCabinet,
} from "@/lib/fiche-de-la-piece";
import { motDuStatut as motDeStatut } from "@/lib/statut";
import { carteDuRecu, demandeDuSiegeATrancher, etatDeMaDemande } from "@malica/socle/circuit";
import {
  statutDuCircuit,
  TON_PME,
  type StatutDuCircuit,
  type TonDuStatut,
} from "@malica/socle/statut-d-envoi";
import { codeDeLecture, demandeUnGeste, issueDeLecture } from "@malica/socle/issue-de-lecture";
import { useRevenir } from "@/hooks/use-revenir";
import { estUnIdentifiant } from "@/lib/identifiant";

export const Route = createFileRoute("/_authenticated/pme/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Ma pièce — Malica Office" },
      {
        name: "description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source ; où elle en est chez votre comptabilité.",
      },
      { property: "og:title", content: "Ma pièce — Malica Office" },
      {
        property: "og:description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source ; où elle en est chez votre comptabilité.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  /*
   * L'onglet à ouvrir : « Produire un nouveau reçu », depuis la fiche d'un
   * reçu qui ne compte plus, ouvre la facture sur ses règlements. Un
   * paramètre inconnu est ignoré, jamais une erreur.
   */
  validateSearch: (s: Record<string, unknown>): { onglet?: Onglet } =>
    ONGLETS.includes(s["onglet"] as Onglet) ? { onglet: s["onglet"] as Onglet } : {},
  /*
   * Une autre pièce, un autre écran : sans cela, le routeur garde le
   * composant et son état d'une pièce à l'autre (« Validée » affiché sur la
   * suivante, boutons disparus — audit du 27 octobre 2026).
   */
  remountDeps: ({ params }) => params,
  component: PieceScreenDeLaPiece,
});

const ONGLETS = ["lecture", "reglement", "suivi"] as const;
type Onglet = (typeof ONGLETS)[number];

/**
 * Une pièce, un écran : passer d'une pièce à une autre (la mère d'un reçu, le
 * reçu d'une facture) remonte l'écran, au lieu de garder l'onglet, la feuille
 * ou l'erreur de la précédente.
 */
function PieceScreenDeLaPiece() {
  const { pieceId } = Route.useParams();
  // Une adresse qui ne porte pas d'identifiant n'interroge pas la base.
  if (!estUnIdentifiant(pieceId)) return <PieceIntrouvable />;
  return <PieceScreen key={pieceId} />;
}

/**
 * UNE PIÈCE QUI N'EST PLUS LÀ N'EST PAS UNE PANNE (audit du 25 octobre 2026).
 *
 * Une suppression accordée par le cabinet efface la pièce ; la notification,
 * un lien gardé ou une adresse mal copiée y mènent encore. L'écran le dit
 * calmement, avec son chemin de retour — jamais « Une erreur est survenue ».
 */
function PieceIntrouvable() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const revenir = useRevenir();
  return (
    <div data-ecran="dossier">
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme/list")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.piece.title")}</span>
      </div>
      <div className="centr calme" role="status">
        <i />
        <div>
          <p>{t("pme.piece.supprimee")}</p>
          <button type="button" onClick={() => void navigate({ to: "/pme/list" })}>
            {t("pme.regler.retour")}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * ================================ LES MOTS DE CET ÉCRAN SONT AU DICTIONNAIRE
 *
 * Le bloc `MOTS` qui vivait ici rassemblait trente-deux libellés en dur, en
 * français, assumés en commentaire comme une dette nommée. Ils sont entrés au
 * dictionnaire le 18 octobre 2026 sous `pme.piece.*`, dans les trois langues,
 * et chaque site d'affichage appelle `t()`.
 *
 * Les quatre compteurs de la page — pièces, mouvements, points, étapes —
 * passent par la variable `count` : `Intl.PluralRules` accorde, là où un
 * `n > 1 ? "s" : ""` n'accordait qu'en français et laissait l'arabe faux.
 */

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
   * « Envoyé » : la transmission vient d'aboutir (maquette du 27 octobre
   * 2026). Un état d'écran — rouvrir une pièce transmise ne
   * rejoue pas l'écran.
   */
  const [envoye, setEnvoye] = useState<EnvoiDUnePiece | null>(null);
  /**
   * Le même écran après « Renvoyer », à l'heure du renvoi que la base a
   * posée, et chez qui : le propriétaire (le siège renvoie) ou le cabinet.
   */
  const [renvoye, setRenvoye] = useState<{ le: string; chez: EnvoiDUnePiece["chez"] } | null>(null);
  /** La feuille « Retourner à {prénom} » du propriétaire. */
  const [retournerOuvert, setRetournerOuvert] = useState(false);
  const [montrerPiece, setPiece] = useState(false);
  const [montrerDetail, setDetail] = useState(false);
  /**
   * L'onglet ouvert, et la feuille « Ajouter un règlement ».
   *
   * 24 octobre 2026, maquette validée par Wissem (« encore trop d'écriture,
   * il faut une séparation de section ») : une carte de décision, puis trois
   * onglets — Lecture, Règlement, Suivi — au lieu de quinze blocs empilés.
   */
  const ongletDemande = Route.useSearch().onglet;
  const [onglet, setOnglet] = useState<Onglet>(ongletDemande ?? "lecture");
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
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
  const cabinet = useMonCabinet(pme.tenantId);

  /**
   * Qui je suis dans ce dossier — `dirigeant` ou `collaborateur`.
   *
   * Le bloc « Revenir dessus » croise le RÔLE et la visibilité de la pièce, et
   * rien d'autre : un siège corrige librement sa propre saisie mais ne la
   * supprime pas, un dirigeant tranche. Sans ce rôle, l'écran offrirait à un
   * siège un geste que la base lui refuse.
   */
  const acces = useMonAcces(pme.tenantId);
  const envoiVers = useDestinationDeLEnvoi(pme.tenantId);

  const navigate = useNavigate();
  const navigateList = () => navigate({ to: "/pme/list" });
  const revenir = useRevenir();

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

  /**
   * Une pièce qui en ACCOMPAGNE une autre — un reçu, un justificatif — ne se
   * lit jamais : elle a sa propre fiche (maquette du 25 octobre 2026). La
   * base dit si c'est le cas ; `null` pour toute autre pièce.
   */
  const accompagne = useQuery({
    queryKey: ["piece-qui-accompagne", pieceId, locale],
    queryFn: () => office().capture.pieceQuiAccompagne(pieceId, locale),
    enabled: !lue,
  });

  /**
   * LA CHAÎNE — ce qui est né de cette pièce (reçu, talons), puis ce qui lui a
   * été RATTACHÉ après la lecture (bon de livraison, avoir, devis).
   *
   * `CommentCEstPaye` invalide `joints` quand il produit un reçu : la liste de
   * l'onglet Suivi le montre aussitôt.
   */
  const joints = useQuery({
    queryKey: ["joints", pieceId],
    queryFn: () => office().capture.piecesIssuesDe(pieceId),
  });
  const rattachees = useQuery({
    queryKey: ["rattachees", pieceId],
    queryFn: () => office().capture.piecesRattachees(pieceId),
  });
  /*
   * Ce que la comptabilité a dit en retournant la pièce : motif, note, geste,
   * et si le geste est fait. Sous la clé de la pièce : tout ce qui la relit
   * (rattacher, préciser la date, répondre) relit aussi le retour.
   */
  /*
   * Le statut, du Socle (`statutDuCircuit`) : le même que la liste. Le retour
   * se lit quand il y en a un — du cabinet, ou du propriétaire au siège.
   */
  const leStatut: StatutDuCircuit | null = dossier.data
    ? statutDuCircuit({
        vis: dossier.data.piece.vis,
        status: dossier.data.piece.status,
        gardeeLe: dossier.data.piece.gardeeLe,
        suivi: dossier.data.suivi,
        circuit: dossier.data.circuit,
      })
    : null;
  const retour = useQuery({
    queryKey: ["piece", pieceId, "retour", locale],
    queryFn: () => office().capture.retourDeLaPiece(pieceId, locale),
    enabled: leStatut?.statut === "retour",
  });
  /*
   * Le nom de l'émetteur des documents rattachés : la lecture que la
   * bibliothèque a déjà faite, sous sa clé. « Facture achat » seul ne dit pas
   * QUEL bon de livraison est là.
   */
  /*
   * La même liste dit aussi où en est la LECTURE de cette pièce
   * (`issueDeLecture`) : un échec se voit ici comme sur l'accueil et à la
   * capture, par la même règle et la même source.
   */
  // « Pièce suivante » de l'écran Envoyé se choisit dans la même liste.
  const luesDuDossier = usePiecesLues({
    enabled: !lue || (rattachees.data ?? []).length > 0 || envoye !== null || renvoye !== null,
  });
  const cettePiece = (luesDuDossier.data ?? []).find((x) => x.id === pieceId) ?? null;
  const issue = cettePiece ? issueDeLecture(cettePiece) : null;
  // Une pièce lue n'est jamais en échec, même si la liste en cache le croit
  // encore : la relecture vient de réussir sur cet écran.
  const echecDeLecture = !lue && issue && demandeUnGeste(issue) ? issue : null;
  const [rattacherOuvert, setRattacherOuvert] = useState(false);
  /** Le document dont on a ouvert le détachement, et le motif saisi. */
  const [aDetacher, setADetacher] = useState<string | null>(null);
  const [motifDetache, setMotifDetache] = useState("");
  const detacher = useMutation({
    mutationFn: (autreId: string) => office().capture.detacher(pieceId, autreId, motifDetache),
    onSuccess: async () => {
      setADetacher(null);
      setMotifDetache("");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["rattachees", pieceId] });
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
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
  const sept = useDossiers();
  const nomDuType = (code: string | null) =>
    sept.types.find((x) => x.code === code)?.libelle ?? null;
  /*
   * La fiche dit le DOSSIER puis le type précis : « Tickets et reçus · Reçu de
   * paiement » (maquette du 25 octobre 2026). Le même dossier que la tuile
   * choisie à la capture et que la carte de l'accueil.
   */
  const dossierEtType = (code: string | null, vente: boolean) => {
    const d = sept.parCode(
      dossierDeLaPiece({ typeDeDocument: code, kind: vente ? "facture_vente" : null }, sept.types),
    );
    const type = nomDuType(code);
    return [d?.libelle, type].filter(Boolean).join(" · ") || null;
  };

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] }),
      // La liste dit l'issue de la lecture à l'accueil, à la capture et ici.
      qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) }),
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

  /*
   * LES GESTES DU CIRCUIT — par leur seule porte (`use-gestes-du-circuit.ts`).
   *
   * Chaque hook rend `null` quand le Socle ne propose pas le geste : la fiche
   * ne peut pas dessiner « Transmettre », « Garder », « Rappeler » ou
   * « Supprimer » sur une pièce où il échouerait (revue Codex de #146 : le
   * Suivi offrait « Transmettre » sur une pièce retournée au siège).
   */
  const faitsDuCircuit = dossier.data
    ? {
        id: pieceId,
        vis: dossier.data.piece.vis,
        status: dossier.data.piece.status,
        gardeeLe: dossier.data.piece.gardeeLe ?? null,
        suivi: dossier.data.suivi,
        circuit: dossier.data.circuit,
        // Ce que la base dit de sa lecture : un reçu ne se lit jamais, et au
        // plafond une pièce part non lue (`gestesDuCircuit`).
        accompagne: Boolean(accompagne.data),
        lectureRefusee: dossier.data.lectureRefusee ?? null,
      }
    : null;
  const gestes = useGestesDuCircuit(pme.tenantId, faitsDuCircuit);
  /** À qui elle reste à envoyer, par moi : le seul prédicat (`resteAEnvoyer`). */
  const resteAEnvoyerDe = useResteAEnvoyer(pme.tenantId);
  const resteIci = faitsDuCircuit ? resteAEnvoyerDe(faitsDuCircuit) : null;

  const supprimer = useSupprimer(pme.tenantId, faitsDuCircuit, {
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      // L'accueil montre les pièces lues : sans cela, la pièce effacée y restait.
      await qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) });
      // `replace` : le retour de la bibliothèque ne ramène pas à la pièce effacée.
      void navigate({ to: "/pme/list", replace: true });
    },
    onError: (e: unknown) => {
      setConfirmerSuppression(false);
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error")));
    },
  });

  /**
   * LA DIRE À LA SOCIÉTÉ — la sortie de l'espace privé, sans mandat.
   *
   * `entite` n'est pas une transmission : la base ne pose `transmise_le` que
   * pour `partage`, et seul `partage` prévient le cabinet. La pièce entre dans
   * la bibliothèque de la société, devient lisible (B6 ne vise que
   * `personnel`), et la transmission reste la décision séparée qu'elle doit
   * être.
   *
   * Et le retour est libre : `capture_piece_set_vis` n'exige un accord que
   * pour quitter `partage`. On ne ferme donc rien en ouvrant ceci.
   */
  const versLaSociete = useMutation({
    mutationFn: () => office().collab.setPieceVis(pieceId, "entite"),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * UNE CORRECTION EST UNE ÉCRITURE NOUVELLE (R7).
   *
   * Le type de la pièce, corrigé après la lecture (la feuille « Qu'est-ce que
   * c'est ? »). La réponse est une entrée nouvelle — jamais une modification
   * de la lecture ; le dossier la rend ensuite comme si elle avait été lue.
   * Dans un dossier dont le cabinet tient les livres, le sens (achat ou
   * vente) n'est pas à la PME : la feuille ne le propose pas, la base le
   * refuse (29 octobre 2026).
   */
  const preciser = useMutation({
    mutationFn: async (valeur: string) => {
      await office().capture.preciser(pieceId, "document_kind", valeur);
      // Le jugement suit la réponse : sans nouvelle analyse, le verdict
      // d'avant (« sens à confirmer ») resterait affiché.
      await office().capture.analyser(pieceId);
    },
    onSuccess: async () => {
      setError(null);
      setCorrigerType(false);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });
  /** La feuille « Qu'est-ce que c'est ? », rouverte pour corriger le type. */
  const [corrigerType, setCorrigerType] = useState(false);

  /**
   * LE NOM DE L'ÉMETTEUR SE CORRIGE (3 novembre 2026).
   *
   * Recette, facture MyTek : la lecture a pris le logo, lu « MITEK », pour le
   * nom. Le crayon devant le nom ouvre la saisie ; la réponse est une
   * précision (R7), la lecture reste telle qu'elle a été faite. Le jugement
   * suit, comme pour le type : le tiers et le libellé de l'écriture portent
   * le nom retenu.
   */
  const [corrigerNom, setCorrigerNom] = useState(false);
  const corrigerLeNom = useMutation({
    mutationFn: async (nom: string) => {
      await office().capture.preciser(pieceId, "issuer", nom);
      await office().capture.analyser(pieceId);
    },
    onSuccess: async () => {
      setError(null);
      setCorrigerNom(false);
      await invalidate();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /**
   * « Envoyer » — un seul geste, deux passages (lot 4) : le siège au
   * propriétaire, le propriétaire au comptable. La base choisit d'après les
   * droits de la personne, jamais d'après l'écran, et rend chez qui c'est parti.
   */
  const transmettre = useEnvoyer(pme.tenantId, faitsDuCircuit, {
    onSuccess: async (r) => {
      setError(null);
      // Relire d'abord : l'écran dit « depuis 10:42 » avec l'heure posée par
      // la base, pas celle du téléphone.
      await invalidate();
      setEnvoye(r);
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
  const remettreAuPrive = useMettreAuPrive(pme.tenantId, faitsDuCircuit, {
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
    mutationFn: async (date: string) => {
      await office().capture.daterLaPiece(pieceId, date);
      // Le jugement suit la date, comme il suit le sens : sans nouvelle
      // analyse, il resterait celui d'une pièce « date à saisir ».
      await office().capture.analyser(pieceId);
    },
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
  const garder = useGarder(pme.tenantId, faitsDuCircuit, {
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
  const rappeler = useDemander(pme.tenantId, faitsDuCircuit, "rappel", {
    onSuccess: async () => {
      setError(null);
      // La demande se lit dans `demandes-piece` : sans elle, le bouton restait
      // et rien ne disait que la demande était partie (audit du 27 octobre).
      await qc.invalidateQueries({ queryKey: ["demandes-piece", pieceId] });
      await invalidate();
    },
    // « Pas encore parti » se dit sur place ; seul un refus rédigé (4xx) a
    // une phrase à ajouter. Une panne reste au journal.
    onError: (e: unknown) => {
      const refus = texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", "");
      if (refus) setError(refus);
    },
  });

  /**
   * Et la suppression d'une pièce déjà reçue se demande, elle aussi.
   *
   * Même mécanisme, autre objet : le cabinet la conserve, c'est son métier.
   * La décision s'inscrit au journal, quelle qu'elle soit.
   */
  const demanderSuppression = useDemander(pme.tenantId, faitsDuCircuit, "suppression", {
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["demandes-piece", pieceId] });
      await invalidate();
    },
    // « Pas encore parti » se dit sur place ; seul un refus rédigé (4xx) a
    // une phrase à ajouter. Une panne reste au journal.
    onError: (e: unknown) => {
      const refus = texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", "");
      if (refus) setError(refus);
    },
  });

  // L'état des demandes, par objet et par étape, tel que la base le lit.
  const demandes = useQuery({
    queryKey: ["demandes-piece", pieceId],
    queryFn: () => office().collab.etatDesDemandes(pieceId),
  });
  const mesDroits = acces.data?.droits ?? [];
  // MA demande, à l'étape où je la fais : au propriétaire (siège), au cabinet.
  const dernierFaitDuRappel = etatDeMaDemande(
    demandes.data ?? [],
    "rappel",
    gestes?.demanderA ?? null,
  );
  const demandeDeRappel = dernierFaitDuRappel?.fait ?? null;
  const noteDuRappel = dernierFaitDuRappel?.note ?? null;
  /**
   * Le refus du rappel, dit UNE fois et visible quel que soit l'onglet ou l'état
   * de la pièce (lue ou non) : avant, il ne se lisait que dans « Suivi », et pas
   * du tout sur une pièce encore chez le cabinet sans lecture.
   */
  const refusDuRappel =
    demandeDeRappel === "refusee" ? (
      <p className="f-note" role="status">
        {t("pme.transmettre.rappel.refuse", { note: noteDuRappel ?? "" })}
      </p>
    ) : null;
  const dernierFaitDeSuppression = etatDeMaDemande(
    demandes.data ?? [],
    "suppression",
    gestes?.demanderA ?? null,
  );
  const demandeDeSuppression = dernierFaitDeSuppression?.fait ?? null;
  // La demande d'un siège qui attend le propriétaire.
  const aTrancher = demandeDuSiegeATrancher(demandes.data ?? [], mesDroits);
  // Les motifs gouvernés de « Retourner à {prénom} » : le référentiel, comme au cabinet.
  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
    enabled: gestes?.retournerAuSiege ?? false,
  });

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
      const codeConnu = codeDeLecture(code);
      if (codeConnu) {
        setError(t(RAISON_LONGUE[codeConnu]));
        return;
      }
      /*
       * ======================== ET LE MOTIF DE REFUS A SON TRADUCTEUR, LUI AUSSI
       *
       * `RAISON_LONGUE` ne connaît que les quatre codes
       * `lecture.*`. Un MOTIF de refus — `piece_personnelle`,
       * `plafond_atteint`, `licence_suspendue` — tombait donc dans
       * `texteDeLErreur`, qui affiche le message brut de l'API. Relevé au
       * rendu le 18 octobre, textuellement, sous les yeux du dirigeant :
       *
       *     piece_personnelle
       *
       * `libelleDuRefus` existe, est testé, et traduit exactement ces motifs.
       * C'est la quatrième fois dans ce dépôt qu'un traducteur juste n'est pas
       * importé par l'écran qui en a besoin.
       *
       * `motifDeRefusConnu` garde l'appel : `libelleDuRefus` a un repli
       * attrape-tout (« je ne sais pas pourquoi »), et l'appeler sans garde
       * aurait avalé les pannes de réseau dans une phrase rassurante.
       */
      if (motifDeRefusConnu(code)) {
        setError(libelleDuRefus(code, t));
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
  // La date déjà donnée par la personne (une précision) : c'est elle que le
  // champ rouvre, jamais le jour du scan.
  const datePrecisee = dossier.data?.precisions["document_date"] ?? null;
  const dateRetenue = dateSaisie ?? datePrecisee ?? jourDuScan;
  /** Enregistre la valeur du champ — y compris le jour proposé, gardé tel quel. */
  const enregistrerLaDate = (v: string) => {
    const date = dateAEnregistrer(
      v,
      datePrecisee,
      dater.isPending ? (dater.variables ?? null) : null,
    );
    if (date) dater.mutate(date);
  };

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
          controlesEnDefaut: propositionServeur.data.controlesEnDefaut ?? [],
        }
    : null;
  const proposal = proposalAttempt?.ok ? proposalAttempt.value : null;
  /** Le jugement dit que les montants lus ne ferment pas le total (`coherence_arithmetique`). */
  const totalNeFermePas =
    proposalAttempt != null &&
    !proposalAttempt.ok &&
    proposalAttempt.controlesEnDefaut.includes("coherence_arithmetique");
  /*
   * ANO-025 : un champ lu sous le seuil de réserve n'affiche pas la coche
   * « source », qui dirait une certitude. Le jugement déterministe le nomme ;
   * l'écran le dit « à vérifier », et la zone source reste à un toucher.
   */
  const aVerifier = new Set(propositionServeur.data?.champsAVerifier ?? []);
  // Tant que le jugement n'est pas arrivé (chargement, échec), la confiance est
  // INCONNUE : ni coche « source », ni « à vérifier » — on ne dit rien de faux.
  const confianceConnue = propositionServeur.isSuccess;
  // Le payload dont la proposition est tirée : la lecture, complétée de la
  // précision de la personne si la lecture n'avait pas su.
  const payloadDeLaProposition = dossier.data?.extraction?.payload ?? null;

  /**
   * « Renvoyer » une pièce retournée : elle repart au cabinet, son retour
   * clos, et RIEN ne s'inscrit ici (« Malica sans blocage », 28 octobre 2026).
   * Le renvoi passait par le « Oui » ci-dessous et inscrivait l'écriture — après
   * une contre-passation, celle de l'ancienne lecture, avec ses montants faux.
   * Le cabinet propose sur la lecture courante, ou force. L'écran « Envoyé. »
   * dit l'heure de la base.
   */
  const renvoyer = useRenvoyer(pme.tenantId, faitsDuCircuit, {
    onSuccess: async ({ le }) => {
      setError(null);
      // Renvoyée là d'où elle est revenue : au propriétaire, ou au cabinet.
      const chez = leStatut?.chez === "proprietaire" ? "proprietaire" : "cabinet";
      await invalidate();
      setRenvoye({ le, chez });
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", t("common.error"))),
  });

  /*
   * OUVRIR, C'EST VOIR (lot 4). Le propriétaire qui ouvre la pièce qu'un siège
   * lui a envoyée la « voit » : le siège lit « Vue par {prénom} ». Une fois
   * par envoi ; deux propriétaires qui ouvrent ensemble n'en écrivent qu'une
   * (la base tranche). Un refus rédigé se dit ; une panne va au journal.
   */
  const voir = useMutation({
    mutationFn: () => office().supervision.voir(pieceId),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => {
      const refus = texteDeLErreur(e, "routes/_authenticated/pme.piece.$pieceId", "");
      if (refus) setError(refus);
    },
  });
  const aVoir = gestes?.voirALOuverture ?? false;
  const { mutate: marquerVue, isIdle: pasEncoreVue } = voir;
  useEffect(() => {
    if (aVoir && pasEncoreVue) marquerVue();
  }, [aVoir, pasEncoreVue, marquerVue]);

  if (dossier.isPending)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!dossier.data) {
    /*
     * UNE PIÈCE SUPPRIMÉE N'EST PAS UNE PANNE (audit du 25 octobre 2026).
     *
     * Une suppression accordée par le cabinet efface la pièce ; la
     * notification, un lien gardé, y menaient encore — et l'écran disait
     * « Une erreur est survenue », sans chemin de retour.
     */
    if (estIntrouvable(dossier.error)) return <PieceIntrouvable />;
    return <p className="text-sm text-signal-warn">{t("common.error")}</p>;
  }

  const { piece, contenu, extraction, citations, lectureRefusee } = dossier.data;

  /** Reprendre la photo REMPLACE cette pièce : le scanner le sait. */
  const reprendreLaPhoto = () =>
    pme.reprendreLaPhoto({ id: piece.id, vis: piece.vis, ensuite: "fiche" });

  /**
   * Où la pièce est — et c'est ce qui décide si elle peut être lue.
   *
   * Les trois valeurs existent en base depuis le 18 octobre, et le type du
   * socle les porte depuis le 19 : plus de conversion à faire ici. `entite`
   * est la bibliothèque de la société — lue, rangée, pas transmise.
   */
  const vis = piece.vis;

  /**
   * Pourquoi cette pièce n'est pas lue, ou `null` si rien ne s'y oppose.
   *
   * Le refus INSCRIT d'abord ; à défaut, celui que la visibilité implique.
   * Trente pièces privées n'avaient aucun refus au journal — l'inscription
   * est récente — et l'écran les montrait comme des pièces qui attendent leur
   * tour. Elles n'attendent rien, et cela se DÉRIVE plutôt que de s'écrire
   * (R7 : on ne réécrit pas un fait).
   */
  const motifNonLue = motifDeLEtat(lectureRefusee, vis);

  // Une citation par champ : la dernière écrite est celle qui fait foi.
  const byField = new Map(citations.map((c) => [c.field, c]));
  const payload = extraction?.payload as ExtractPayload | undefined;
  // Le Socle propose une écriture : sinon la lecture est « à corriger ».
  const proposable = Boolean(proposal?.pivot.approvable);

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
   * Le statut de la pièce, un mot et une couleur (« Malica sans blocage »,
   * §2) — le même que dans la liste, dérivé au Socle des faits de la base.
   * La PME ne voit aucune écriture : « Prise en charge » le dit à sa place.
   */
  const statutComplet = leStatut!;
  const statut = statutComplet.statut;
  const priseEnCharge = statut === "prise_en_charge";
  /** Le cabinet, nommé quand on le connaît : « Vue par CABINET D’ESSAI ». */
  const nomDuCabinet = dossier.data.suivi?.vuePar ?? cabinet.data?.name ?? null;
  const motDuStatut = (s: StatutDuCircuit) => motDeStatut(s, nomDuCabinet, t);

  /** Les articles relevés sur la pièce. Le contrat les porte ; l'écran les montre. */
  const articles = payload?.articles ?? [];
  /*
   * LES MONTANTS QUI FONT FOI — le cabinet décide (1er novembre 2026).
   *
   * Relevé sur staging le 30 octobre : le cabinet avait forcé l'écriture
   * (HT 1 663,000, TVA 306,610), et la fiche disait encore « TVA 5,460 ·
   * Droit de timbre 2,000 », la lecture fausse. Prise en charge, la pièce
   * montre les montants de l'écriture du cabinet — jamais l'écriture
   * elle-même ; avant, ceux de la lecture.
   */
  const duCabinet = dossier.data.montantsDuCabinet ?? null;
  const totaux = duCabinet
    ? { base_ht: duCabinet.baseHt, vat: duCabinet.tva, ttc: duCabinet.ttc }
    : payload?.totals;
  const droits = droitsDeLaPiece(
    duCabinet ? duCabinet.droits : payload?.other_charges,
    packDroits.data ?? [],
  );
  // Le sens, la date et la devise aussi : ceux de l'écriture, quand elle fait foi.
  const sensDeLaPiece = duCabinet?.documentKind ?? payload?.document_kind;
  const dateDeLaPiece = duCabinet?.dateEcriture ?? payload?.document_date;
  const deviseDeLaPiece = duCabinet?.devise ?? payload?.currency ?? pme.currency;

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
  const lignesCitees: Array<{
    cle: string;
    label: string;
    valeur: string | null;
    champ: string;
    /** Le montant vient de l'écriture du cabinet : il n'a pas de source sur la pièce. */
    parLeCabinet?: boolean;
    /** Corrigé à la main (une précision, R7) : la source montre ce qui avait été lu. */
    corrige?: boolean;
  }> = [
    {
      cle: "issuer",
      label: t("pme.extract.issuer"),
      valeur: payload?.issuer ?? null,
      champ: "issuer",
      corrige: Boolean(dossier.data?.precisions["issuer"]),
    },
    {
      cle: "date",
      label: t("pme.extract.date"),
      valeur: jourLisible(dateDeLaPiece),
      champ: "document_date",
      parLeCabinet: duCabinet !== null,
    },
    {
      cle: "tva",
      label:
        sensDeLaPiece === "facture_vente"
          ? t("pme.verifie.tvaCollectee")
          : t("pme.verifie.tvaRecuperee"),
      valeur: lisible(totaux?.vat),
      champ: "totals.vat",
      parLeCabinet: duCabinet !== null,
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
      <div className="pt-safe rg-rise fixed inset-0 z-40 flex w-full flex-col items-center justify-center bg-background px-11 text-center">
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

  /* ============================================================== ENVOYÉ
   *
   * La transmission vient d'aboutir : plein écran, dans le style de « C'est
   * réglé » (maquette « Écran Envoyé », validée le 27 octobre 2026). Qui l'a
   * reçue, depuis quand — l'heure de la base —, ce qui se passe ensuite, et
   * la trace que la pièce garde.
   */
  const envoi = renvoye ?? envoye;
  if (envoi && (envoi.chez === "proprietaire" || piece.vis === "partage")) {
    // Le même écran aux deux passages : chez le propriétaire, ou au cabinet,
    // nommés comme partout (`useDestinationDeLEnvoi`).
    const qui = envoiVers.quiPour(envoi.chez);
    // L'heure que la base a posée pour cet envoi.
    const parti = envoi.le;
    const depuis = momentDeLEnvoi(parti, locale);
    const suivanteADecider = pieceSuivanteATransmettre(
      luesDuDossier.data ?? [],
      pieceId,
      (p) => resteAEnvoyerDe(p) !== null,
    );
    const fermer = () => {
      setEnvoye(null);
      setRenvoye(null);
    };
    return (
      <EcranEnvoye
        titre={t("envoi.titre")}
        quoi={t("envoi.piece.chez", {
          piece: payload?.issuer ?? t("envoi.piece.sansNom"),
          qui,
          quand: depuis.quand,
        })}
        suite={envoiVers.suite(envoi.chez)}
        trace={envoiVers.trace(envoi.chez, jourEtMois(parti, locale))}
        principale={
          suivanteADecider
            ? {
                libelle: t("envoi.suivante"),
                action: () =>
                  void navigate({
                    to: "/pme/piece/$pieceId",
                    params: { pieceId: suivanteADecider.id },
                  }),
              }
            : { libelle: t("envoi.lot.revenir"), action: () => void navigateList() }
        }
        secondaire={{
          libelle: t("envoi.voir"),
          action: () => {
            fermer();
            setOnglet("suivi");
          },
        }}
        lien={
          rappeler
            ? {
                libelle: t("envoi.rappel"),
                action: () => {
                  fermer();
                  rappeler.mutate();
                },
              }
            : null
        }
      />
    );
  }

  /* ============================================================ LA PIÈCE
   *
   * La visionneuse s'ouvre par « Voir la facture », ou par une source citée —
   * et c'est alors la zone exacte qui s'affiche, ce qui est tout l'intérêt.
   */
  if (montrerPiece) {
    return (
      <div className="pt-safe fixed inset-0 z-40 flex w-full flex-col bg-background">
        {/*
         * Le retour est le bouton rond du produit, comme partout ailleurs
         * (7 novembre 2026, demande du dirigeant) : plus de « ‹ Vos documents »
         * en texte.
         */}
        <div className="top border-b border-border">
          <button
            type="button"
            className="bk"
            aria-label={t("pme.piece.retour")}
            onClick={() => setPiece(false)}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
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

  /*
   * ============================================== UNE VERSION PRÉCÉDENTE
   *
   * Une nouvelle photo a remplacé celle-ci (« Reprendre la photo ») : elle
   * n'est plus dans les listes, jamais effacée, et ne se traite plus — c'est
   * la nouvelle qui porte le retour, les rattachements et la file. On la
   * montre, et le chemin vers la version courante — la dernière de la chaîne.
   */
  if (piece.remplaceePar) {
    const courante = piece.versionCourante;
    return (
      <div data-ecran="dossier">
        <div className="top">
          <button
            type="button"
            className="bk"
            aria-label={t("pme.regler.retour")}
            onClick={() => revenir("/pme/list")}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
          </button>
          <span className="ttl">{t("piece.versionPrecedente.titre")}</span>
        </div>
        <div className="f-id">
          <button
            type="button"
            className="f-vign"
            aria-label={t("pme.piece.voir")}
            onClick={() => setPiece(true)}
          >
            <ApercuDePiece pieceId={pieceId} />
          </button>
        </div>
        <VersionPrecedente
          className="centr calme"
          onVoir={() => void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: courante } })}
        />
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
      <div className="pt-safe fixed inset-0 z-40 flex w-full flex-col bg-background">
        {/*
         * Le retour est le bouton rond du produit, comme partout ailleurs
         * (7 novembre 2026, demande du dirigeant) : plus de « ‹ Vos documents »
         * en texte.
         */}
        <div className="top border-b border-border">
          <button
            type="button"
            className="bk"
            aria-label={t("pme.piece.retour")}
            onClick={() => setDetail(false)}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
          </button>
          <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("pme.detail.compte", { count: articles.length })}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-4">
          <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {t("pme.detail.titre")}
          </p>
          <LignesAVerifier pieceId={pieceId} />
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
                      : a.unit_price_ttc
                        ? " · " + t("pme.detail.puTtc", { pu: lisible(a.unit_price_ttc) ?? "—" })
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
                  {lisible(totaux?.base_ht) ?? "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-1.5">
                <span className="text-[13.5px]">{t("pme.extract.vat")}</span>
                <span className="num text-[13.5px]">{lisible(totaux?.vat) ?? "—"}</span>
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
                <span className="text-[14px] font-semibold">
                  {duCabinet ? t("pme.verifie.totalTtc") : t("pme.verifie.total")}
                </span>
                <span
                  className={cn(
                    "num text-[15px] font-semibold",
                    totalNeFermePas && "text-[color:var(--ve)]",
                  )}
                >
                  {lisible(totaux?.ttc) ?? "—"} {deviseDeLaPiece}
                </span>
              </div>
              {/*
               * Un total que la somme des montants lus ne donne pas (2 novembre
               * 2026 : « 510,000 » relevé « 810,000 ») : le jugement le refuse,
               * et l'écran ne l'affiche plus comme s'il était juste.
               */}
              {totalNeFermePas ? (
                <p
                  role="alert"
                  className="mt-1.5 text-[12px] leading-[1.45] text-[color:var(--ve)]"
                >
                  {t("pme.detail.totalNeFermePas")}
                </p>
              ) : null}
            </div>
          )}
          <p className="mt-4 text-[11.5px] leading-[1.5] text-muted-foreground">
            {t("pme.detail.provenance")}
          </p>
        </div>
      </div>
    );
  }

  // Une demande ne se suit qu'où elle se fait : au propriétaire, ou au cabinet.
  const noteSuppression = demanderSuppression
    ? demandeDeSuppression === "demandee" || demandeDeSuppression === "refusee"
      ? demandeDeSuppression
      : null
    : noteDeSuppression(demandeDeSuppression, vis);
  /** À qui je demande : mon propriétaire (le siège), ou le cabinet. */
  const aQuiJeDemande = envoiVers.quiPour(demanderSuppression?.a ?? "cabinet");
  /**
   * « Demander la suppression », quand elle peut l'être : une demande déjà
   * inscrite ne se redemande pas ; une demande retirée (la pièce était revenue
   * au privé) ou accordée peut l'être. La fiche lue et la pièce partie sans
   * avoir été lue l'offrent toutes deux, par ce seul calcul.
   */
  const demanderLaSuppression =
    demanderSuppression &&
    (!demandeDeSuppression ||
      demandeDeSuppression === "retiree" ||
      demandeDeSuppression === "accordee")
      ? demanderSuppression
      : null;
  /** Où en est ma demande de suppression : dite une fois, lue aux deux endroits. */
  const suiviDeLaSuppression =
    noteSuppression === "demandee" && dernierFaitDeSuppression ? (
      <ConfirmationSurPlace
        titre={
          dernierFaitDeSuppression.transmise
            ? t("circuit.demande.transmise", { cabinet: aQuiJeDemande })
            : t("envoi.suppression.fait", { qui: aQuiJeDemande })
        }
        detail={t("envoi.demande.detail", {
          qui: dernierFaitDeSuppression.transmise ? envoiVers.quiPour("cabinet") : aQuiJeDemande,
          quand: momentDeLEnvoi(dernierFaitDeSuppression.createdAt, locale).quand,
        })}
      />
    ) : demanderSuppression?.isError ? (
      <PasEncoreParti
        qui={aQuiJeDemande}
        reessayer={() => demanderSuppression.mutate()}
        enCours={demanderSuppression.isPending}
      />
    ) : noteSuppression === "refusee" ? (
      <p className="f-note">{t("pme.piece.suppressionRefusee")}</p>
    ) : null;

  /**
   * Chez le cabinet, pas encore lue, et plus supprimable d'ici : la seule
   * sortie est de le demander. Une pièce RENDUE par le cabinet (retournée,
   * sa photo reprise) se supprime encore sans rien demander (`gestesDuCircuit`) :
   * elle n'est pas dans ce cas.
   */
  const chezLeCabinetNonLue = vis === "partage" && piece.status === "capturee" && !supprimer;

  /* ========================================================= PAS ENCORE LUE
   *
   * Le scan final, en grand, AVANT le geste : c'est lui qui sera lu, pas
   * l'aperçu de l'appareil photo. Deux gestes seulement — lire, ou reprendre
   * la photo (elle remplace celle-ci). Rien ne part tant que la personne n'a pas vu.
   */
  if (!extraction && accompagne.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!extraction && accompagne.data) {
    return (
      <PieceQuiAccompagneFiche
        pieceId={pieceId}
        typeDeDocument={piece.documentKind}
        donnees={accompagne.data}
        onAgrandir={() => setPiece(true)}
      />
    );
  }

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
        {refusDuRappel}
        {motifNonLue === null ? null : (
          <RefusDeLecture
            motif={motifNonLue}
            dateLisible={
              lectureRefusee
                ? new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
                    new Date(lectureRefusee.le),
                  )
                : null
            }
          />
        )}
        {echecDeLecture ? (
          <div className="echec-lecture" role="alert">
            <p className="tt">{t("pme.lecture.echec.titre")}</p>
            <p>
              {t(
                echecDeLecture.code
                  ? RAISON_LONGUE[echecDeLecture.code]
                  : "pme.lecture.court.echec",
              )}
            </p>
            <p className="nd">{t("pme.lecture.echec.nonDecomptee")}</p>
            <button type="button" className="pr" onClick={reprendreLaPhoto}>
              {t("pme.verifie.corriger")}
            </button>
            <button
              type="button"
              className="sc"
              onClick={() => read.mutate()}
              disabled={read.isPending}
            >
              {t("pme.lecture.relireMeme")}
            </button>
          </div>
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
        {/*
         * ================================== LA SORTIE DE L'ESPACE PRIVÉ, SANS CABINET
         *
         * Une pièce `personnel` n'est jamais lue (B6), et « Lire la pièce »
         * sur une pièce privée ne pouvait donc QUE échouer. Le message disait
         * la sortie — « tant que vous ne la transmettez pas » — mais le seul
         * bouton qui l'offrait était gardé par `cabinet.data` : sans mandat de
         * cabinet, il n'y avait aucun bouton, donc aucune sortie. Le dirigeant
         * qui essaie seul était dans une impasse fermée.
         *
         * « La dire à la société » n'est pas une transmission : `entite` est
         * la bibliothèque de la société — lue, rangée, et elle ne part chez
         * personne. Elle n'a besoin d'aucun mandat, et la transmission reste
         * la décision séparée qu'elle doit être.
         *
         * Le bouton de lecture ne disparaît pas pour autant : c'est la base
         * qui tranche, et un plafond relevé la minute d'après doit pouvoir
         * être essayé sans quitter l'écran. Il passe seulement SECOND quand
         * on sait qu'il ne peut pas aboutir.
         */}
        {vis === "personnel" ? (
          <div className="manque" data-k="attente">
            <p className="t-body">{t("pme.piece.versLaSociete.sous")}</p>
            <button
              type="button"
              disabled={versLaSociete.isPending}
              onClick={() => versLaSociete.mutate()}
              className="mt-3 h-[54px] w-full bg-foreground text-[16px] font-semibold text-background disabled:opacity-50"
            >
              {t("pme.piece.versLaSociete")}
            </button>
          </div>
        ) : null}
        {/*
         * ============================ CHEZ LE CABINET, PAS ENCORE LUE
         *
         * Plus aucune pièce ne part sans être lue (`une_piece_non_lue_ne_part_pas`).
         * Deux cas restent : celles parties avant le 3 novembre, et la nouvelle
         * photo d'une pièce déjà partie, qui hérite de son partage. L'écran les
         * montrait comme une pièce qui attend chez soi, sans « Supprimer » ni
         * raison : la personne restait devant deux boutons sans comprendre. Il
         * dit maintenant où elle est, garde la lecture, et offre la seule
         * sortie qui existe : la demander au cabinet.
         */}
        {chezLeCabinetNonLue ? (
          <div className="manque" data-k="attente">
            <p className="t-body font-semibold">
              {t("pme.piece.partieNonLue", { cabinet: envoiVers.quiPour("cabinet") })}
            </p>
            <p className="t-body mt-1">
              {t("pme.piece.partieNonLue.sous", { qui: aQuiJeDemande })}
            </p>
          </div>
        ) : null}
        {/* Après un échec, ses deux gestes sont dans la carte d'échec, au-dessus. */}
        {echecDeLecture ? null : (
          <>
            <button
              type="button"
              onClick={() => read.mutate()}
              className={
                vis === "personnel"
                  ? "h-[48px] w-full border border-border text-[14px] font-medium"
                  : "h-[54px] w-full bg-foreground text-[16px] font-semibold text-background"
              }
            >
              {t("pme.read.run")}
            </button>
            <button
              type="button"
              onClick={reprendreLaPhoto}
              className="h-[48px] w-full border border-border text-[14px] font-medium"
            >
              {t("pme.verifie.corriger")}
            </button>
          </>
        )}
        {chezLeCabinetNonLue && demanderLaSuppression ? (
          <button
            type="button"
            disabled={demanderLaSuppression.isPending}
            onClick={() => demanderLaSuppression.mutate()}
            className="h-[48px] w-full text-[14px] font-medium text-signal-stop disabled:opacity-50"
          >
            {demanderLaSuppression.isPending
              ? t("common.loading")
              : t("pme.piece.demanderSuppression")}
          </button>
        ) : null}
        {chezLeCabinetNonLue ? suiviDeLaSuppression : null}
        {/*
         * Supprimer, tout court (26 octobre 2026) : « Reprendre » efface ET
         * rouvre l'appareil photo ; une photo prise par erreur n'avait aucune
         * sortie sans en reprendre une autre. Offert quand le circuit le
         * permet (`gestesDuCircuit`) : la sienne, ou toutes pour qui en a le
         * droit — pas la pièce que le siège a déjà envoyée au propriétaire.
         */}
        {supprimer ? (
          confirmerSuppression ? (
            <div className="flex flex-col gap-2 border border-border bg-card p-4">
              <p className="text-[14px]">{t("pme.supprimer.sur")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmerSuppression(false)}
                  className="h-[48px] border border-border text-[14px] font-medium"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={supprimer.isPending}
                  onClick={() => supprimer.mutate()}
                  className="h-[48px] border border-signal-stop text-[14px] font-semibold text-signal-stop disabled:opacity-40"
                >
                  {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmerSuppression(true)}
              className="h-[48px] w-full text-[14px] font-medium text-signal-stop"
            >
              {t("pme.supprimer.action")}
            </button>
          )
        ) : null}
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

  const vente = sensDeLaPiece === "facture_vente";
  const achat = sensDeLaPiece === "facture_achat";
  const devise = deviseDeLaPiece;

  /*
   * `vis` est lue plus haut, avant la branche « pas encore lue » : c'est elle
   * qui décide si la pièce peut être lue, et donc ce que cet écran propose.
   *
   * La branche `entite` n'est plus inerte : `Visibility` porte les trois
   * valeurs depuis le 19 octobre, et l'écran de capture y met les pièces
   * destinées à la société avant de les faire lire.
   */
  // Le siège envoie au propriétaire : le référentiel le dit, pas un nom de rôle.
  const siege = aLeDroit(acces.data, "envoi.proprietaire");

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
  const payeMineur = paiements.isSuccess ? totalDesPaiements(paiements.data) : null;
  // En unités exactes de la devise, jamais par un flottant.
  const ttcMineur = (() => {
    if (!totaux?.ttc || decimales === null) return null;
    try {
      return Number(enUnitesExactes(totaux.ttc, decimales));
    } catch {
      return null;
    }
  })();
  const resteMineur = ttcMineur !== null && payeMineur !== null ? ttcMineur - payeMineur : null;
  const resteLisible =
    resteMineur !== null && decimales !== null
      ? lisible(depuisUniteMineure(Math.max(resteMineur, 0), decimales))
      : null;

  /*
   * ---------------------------------------------- CE QUE J'AI VÉRIFIÉ
   *
   * Uniquement des faits que le produit connaît : un refus de lecture, une
   * date absente, un verdict qui bloque, un classement
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
  }> = [];
  if (dossier.data.lectureRefusee) {
    controles.push({ cle: "refus", k: "no", p: t("pme.piece.lectureRefusee") });
  }
  if (dateAbsente) {
    // La question est posée ici ; le champ qui y répond est dans le bloc de
    // lecture, à la ligne « Date », là où la personne la cherche.
    controles.push({ cle: "date", k: "q", p: t("pme.date.manque.lede") });
  }
  /*
   * LE SENS N'EST PAS UNE QUESTION POUR LA PME (décision du dirigeant, 29
   * octobre 2026). Un achat ou une vente que la lecture ne tranche pas, ou
   * qu'elle contredit, se tranche au cabinet ; l'écran ne demandait « Oui,
   * c'est bien une vente de ma société » qu'à quelqu'un qui ne confirme rien.
   * Une pièce qui n'attend que cela n'est pas bloquée pour la PME : elle
   * l'envoie, c'est tout.
   */
  const sensAuCabinet =
    proposalAttempt != null &&
    !proposalAttempt.ok &&
    proposalAttempt.controlesEnDefaut.length > 0 &&
    proposalAttempt.controlesEnDefaut.every((c) => c === "sens_de_la_piece");
  if (!proposable && !sensAuCabinet && proposalAttempt && !proposalAttempt.ok) {
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

  /** La chaîne : la pièce elle-même, puis ce qui en est né. */
  const nes = joints.data ?? [];
  const lesRattachees = rattachees.data ?? [];

  /*
   * ══════════════════════════════════════════ UNE DÉCISION, TROIS ONGLETS
   *
   * 24 octobre 2026, Wissem, sur les captures de la fiche : « encore trop
   * d'écriture, il faut une séparation de section, ultra intuitif, avec des
   * boutons et des actions ». Maquette validée (« C bon ») : la pièce en tête,
   * UNE carte de décision, l'avancement, puis Lecture · Règlement · Suivi.
   *
   * La carte pose une seule question à la fois, dans cet ordre : la date si
   * elle manque, l'envoi au cabinet, le reste à payer — puis elle devient une ligne calme, le statut
   * de la pièce. Elle ne demande jamais de confirmer une écriture : la PME
   * n'en voit aucune (« Malica sans blocage », 28 octobre 2026). Aucun geste
   * n'est perdu : chacun a aussi sa place dans un onglet.
   */
  /*
   * Retournée par la comptabilité : la carte du retour remplace la décision.
   * Une pièce retournée n'est jamais prise en charge (son écriture est
   * contre-passée), et rien ne s'y confirme.
   */
  const retourEnCours = statut === "retour" ? (retour.data ?? null) : null;
  /** Le prénom du siège, pour « Retourner à Sami ». */
  const leSiege = dossier.data.circuit?.auteur ?? t("circuit.siege");
  /*
   * Retournée, la pièce est RENDUE au client : il la supprime ou la garde sans
   * rien demander, et les demandes au cabinet ne se proposent plus
   * (« Malica sans blocage ») — c'est `gestesDuCircuit` qui le dit.
   */
  // Tant que le retour se lit, aucune carte (relecture de #114).
  const retourSeLit = statut === "retour" && retour.isPending;
  // Où elle en est chez le cabinet : envoyée, vue, prise en charge.
  const ouEnEst = ouEnEstLaPiece(dossier.data.suivi);
  const derniereFaite = ouEnEst.map((e) => e.le !== null).lastIndexOf(true);
  /*
   * La décision d'envoyer : le geste de la fiche (`useEnvoyer`), quand la pièce
   * reste à envoyer — une pièce gardée ne se propose plus ici ; elle garde
   * « Transmettre quand même » dans le Suivi.
   */
  const envoyerIci = transmettre && resteIci === transmettre.vers ? transmettre : null;
  const aTransmettre = envoyerIci?.vers === "cabinet" ? envoyerIci : null;
  const auProprietaire = envoyerIci?.vers === "proprietaire" ? envoyerIci : null;
  const recu = carteDuRecu(gestes, resteIci);
  /** La carte d'une pièce reçue porte l'envoi au comptable : avec un cabinet. */
  const recuAuComptable = recu?.envoyerAuComptable && cabinet.data ? aTransmettre : null;
  /** L'envoi au comptable, gardée ou non : le Suivi y porte « Transmettre quand même ». */
  const versLeComptable = transmettre?.vers === "cabinet" ? transmettre : null;
  /** « Garder » sur la décision d'envoyer — pas la sortie d'une carte de retour. */
  const garderIci = gestes?.garder ? garder : null;
  /** « Garder » sur la carte d'un retour du comptable. */
  const garderLeRetour = gestes?.garderLeRetour ? garder : null;
  const resteAPayer = resteMineur !== null && resteMineur > 0;
  const bloquee = !proposable && !sensAuCabinet && proposalAttempt != null && !proposalAttempt.ok;

  const constats = controles.filter((c) => c.k === "ok" || c.cle === "refus");

  const ouvrirLeReglement = () => {
    setOnglet("reglement");
    setAjoutOuvert(true);
  };
  const allerA = (o: "lecture" | "reglement" | "suivi") => {
    setOnglet(o);
    document.getElementById("onglets-de-la-piece")?.scrollIntoView({ behavior: "smooth" });
  };

  /*
   * Le geste propre au motif, branché sur ce qui existe déjà sur la fiche : la
   * feuille « Rattacher un document », l'onglet Lecture pour la date, le
   * Règlement. Reprendre la photo, répondre et supprimer sont des sorties de
   * la carte elle-même (`sortiesDuRetour`).
   */
  const faireLeGesteDuRetour = (geste: GesteDeRetour) => {
    if (geste === "joindre_document" || geste === "joindre_facture_conforme") {
      allerA("suivi");
      setRattacherOuvert(true);
    } else if (geste === "corriger_date") allerA("lecture");
    else if (geste === "voir_reglement") allerA("reglement");
  };

  type Geste = { libelle: string; action: () => void; principal?: boolean; eteint?: boolean };
  const decision: {
    ton: "ve" | TonDuStatut;
    titre: string;
    sous?: string;
    gestes: Geste[];
  } =
    !priseEnCharge && dateAbsente
      ? {
          ton: "am",
          titre: t("pme.date.manque.lede"),
          gestes: [
            {
              libelle: t("pme.piece.decision.date"),
              action: () => allerA("lecture"),
              principal: true,
            },
          ],
        }
      : !priseEnCharge && demandeDeRappel === "demandee"
        ? {
            /*
             * Rappeler et inscrire se contredisent : tant que le cabinet n'a
             * pas tranché le rappel, la base refuse toute inscription. On le
             * dit au lieu d'offrir un bouton qui échouerait.
             */
            ton: "az",
            titre: t("refus.piece.rappelEnAttente"),
            gestes: [],
          }
        : !priseEnCharge && bloquee
          ? {
              // La raison passe devant le bouton mort (10 octobre 2026).
              ton: "ve",
              titre: raisonDuBlocage,
              sous: t("pme.bloque.geste"),
              gestes: [
                ...(envoyerIci
                  ? [
                      {
                        libelle: auProprietaire
                          ? t("circuit.envoyer")
                          : t("pme.transmettre.action"),
                        action: () => envoyerIci.mutate(),
                        eteint: envoyerIci.isPending || Boolean(garderIci?.isPending),
                        principal: true,
                      },
                    ]
                  : []),
                { libelle: t("pme.verifie.corriger"), action: reprendreLaPhoto },
              ],
            }
          : auProprietaire
            ? {
                // Le siège envoie au propriétaire : un geste, jamais « Garder ».
                ton: "am",
                titre: t("circuit.envoyer.question"),
                sous: t("circuit.envoyer.aide"),
                gestes: [
                  {
                    libelle: auProprietaire.isPending ? t("common.loading") : t("circuit.envoyer"),
                    action: () => auProprietaire.mutate(),
                    eteint: auProprietaire.isPending,
                    principal: true,
                  },
                ],
              }
            : recu
              ? {
                  /*
                   * La pièce d'un siège, reçue : le propriétaire l'envoie au
                   * comptable s'il y en a un et qu'il ne l'a pas gardée — et
                   * la retourne au siège dans tous les cas (lot 4, revue
                   * Codex de #146).
                   */
                  ton: TON_PME[statut],
                  titre:
                    recuAuComptable && cabinet.data
                      ? t("circuit.recue.question", { qui: leSiege, cabinet: cabinet.data.name })
                      : t("circuit.recue.titre", { qui: leSiege }),
                  sous: recuAuComptable
                    ? t("circuit.recue.aide", { qui: leSiege })
                    : t("circuit.recue.aide.sansEnvoi", { qui: leSiege }),
                  gestes: [
                    ...(recuAuComptable
                      ? [
                          {
                            libelle: recuAuComptable.isPending
                              ? t("common.loading")
                              : t("pme.transmettre.action"),
                            action: () => recuAuComptable.mutate(),
                            eteint: recuAuComptable.isPending,
                            principal: true,
                          },
                        ]
                      : []),
                    {
                      libelle: t("circuit.retourner", { qui: leSiege }),
                      action: () => setRetournerOuvert(true),
                      eteint: Boolean(recuAuComptable?.isPending),
                      principal: !recuAuComptable,
                    },
                  ],
                }
              : aTransmettre && cabinet.data
                ? {
                    /*
                     * La transmission est une DÉCISION (4 et 7 octobre) : deux
                     * boutons de même poids — garder chez soi est légitime.
                     */
                    ton: "az",
                    titre: t("pme.transmettre.question", { cabinet: cabinet.data.name }),
                    sous: t("pme.transmettre.chezvous"),
                    gestes: [
                      {
                        libelle: aTransmettre.isPending
                          ? t("common.loading")
                          : t("pme.transmettre.action"),
                        action: () => aTransmettre.mutate(),
                        eteint: aTransmettre.isPending || Boolean(garderIci?.isPending),
                        principal: true,
                      },
                      ...(garderIci
                        ? [
                            {
                              libelle: garderIci.isPending
                                ? t("common.loading")
                                : t("pme.garder.action"),
                              action: () => garderIci.mutate(),
                              eteint: garderIci.isPending || aTransmettre.isPending,
                            },
                          ]
                        : []),
                    ],
                  }
                : resteAPayer
                  ? {
                      ton: "az",
                      titre: t("pme.piece.decision.reste", {
                        montant: resteLisible ?? "",
                        devise,
                      }),
                      gestes: [
                        {
                          libelle: t("pme.paiement.ajouterUn"),
                          action: ouvrirLeReglement,
                          principal: true,
                        },
                      ],
                    }
                  : // Rien à faire : la carte dit où la pièce en est, un mot.
                    { ton: TON_PME[statut], titre: motDuStatut(statutComplet), gestes: [] };

  return (
    <div data-ecran="dossier">
      {/* ── la barre du haut ─────────────────────────────────────────── */}
      <div className="top">
        {/* Le retour dit « Retour », comme les neuf autres écrans. */}
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme/list")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{titreDeLaPiece}</span>
        {periode ? <span className="per">{periode}</span> : null}
        <button
          type="button"
          className="bk"
          aria-label={t("pme.piece.plusDActions")}
          onClick={() => allerA("suivi")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="19" cy="12" r="1.2" />
          </svg>
        </button>
      </div>

      {/* ── 1 · la pièce : la vraie page, qui, combien ─────────────────── */}
      <div className="f-id">
        <button
          type="button"
          className="f-vign"
          aria-label={t("pme.piece.voir")}
          onClick={() => setPiece(true)}
        >
          <ApercuDePiece pieceId={pieceId} />
        </button>
        <div className="f-qui">
          <span className={`f-etat ${TON_PME[statut]}`}>
            <i />
            {motDuStatut(statutComplet)}
          </span>
          {corrigerNom ? (
            <NomDeLEmetteur
              actuel={payload?.issuer ?? ""}
              enCours={corrigerLeNom.isPending}
              onEnregistrer={(nom) =>
                nom === (payload?.issuer ?? "").trim()
                  ? setCorrigerNom(false)
                  : corrigerLeNom.mutate(nom)
              }
              onAnnuler={() => setCorrigerNom(false)}
            />
          ) : (
            <h1 className="f-nom">
              <span>{payload?.issuer ?? t("pme.piece.title")}</span>
              {/*
               * Le nom se corrige tant que la pièce n'est pas engagée — la
               * base le redit (`capture_precision_persist`).
               */}
              {STATUTS_PRECISABLES.has(piece.status) ? (
                <button
                  type="button"
                  className="f-crayon"
                  onClick={() => setCorrigerNom(true)}
                  aria-label={t("pme.piece.nom.modifier")}
                  title={t("pme.piece.nom.modifier")}
                >
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <path d="M4 20h4L19 9l-4-4L4 16z" />
                  </svg>
                </button>
              ) : null}
            </h1>
          )}
          <div className="f-typ">
            {/*
             * Le type se corrige après la lecture (23 octobre 2026), tant que
             * la pièce n'est pas engagée — la base le redit.
             */}
            {STATUTS_PRECISABLES.has(piece.status) ? (
              <button
                type="button"
                className={vente ? "puce vent" : "puce"}
                disabled={preciser.isPending}
                onClick={() => setCorrigerType(true)}
                aria-label={`${dossierEtType(piece.documentKind, vente) ?? t("pme.piece.sens.inconnu")} — ${t("pme.piece.type.modifier")}`}
              >
                {dossierEtType(piece.documentKind, vente) ?? t("pme.piece.sens.inconnu")}
                <svg viewBox="0 0 24 24" className="g" aria-hidden>
                  <path d="M4 20h4L19 9l-4-4L4 16z" />
                </svg>
              </button>
            ) : (
              <span className={vente ? "puce vent" : "puce"}>
                {dossierEtType(piece.documentKind, vente) ?? t("pme.piece.sens.inconnu")}
              </span>
            )}
            {payload?.document_date ? (
              <span className="dt">{jourLisible(payload.document_date)}</span>
            ) : null}
          </div>
        </div>
      </div>
      {corrigerType ? (
        <QuestionDuType
          documents={[nomDuType(piece.documentKind) ?? t("pme.piece.title")]}
          actuel={{ typeDeDocument: piece.documentKind, kind: vente ? "facture_vente" : null }}
          sensAuCabinet={cabinet.data?.tientLesLivres ?? false}
          mode="correction"
          onRepondre={(code) =>
            code === piece.documentKind ? setCorrigerType(false) : preciser.mutate(code)
          }
          onAnnuler={() => setCorrigerType(false)}
        />
      ) : null}

      <div className="f-mt">
        <AffichageSignale
          pieceId={pieceId}
          ecran="pme"
          source={duCabinet ? "cabinet" : "lecture"}
          valeurs={{ ttc: totaux?.ttc, base_ht: totaux?.base_ht, tva: totaux?.vat }}
        />
        <div className={vente ? "amt vent" : "amt"}>
          {lisible(totaux?.ttc) ?? "—"}{" "}
          <u>
            {devise} {t("pme.extract.ttc")}
          </u>
        </div>
        <div className="f-puces">
          <span>
            {t("pme.extract.base")} <b>{lisible(totaux?.base_ht) ?? "—"}</b>
          </span>
          <span>
            {t("pme.extract.vat")} <b>{lisible(totaux?.vat) ?? "—"}</b>
          </span>
          {droits.map((d, i) => (
            <span key={`${d.code}-${i}`}>
              {d.libelle} <b>{lisible(d.montant) ?? "—"}</b>
              {d.connu ? null : <em> · {t("pme.extract.droitInconnu")}</em>}
            </span>
          ))}
        </div>
      </div>

      {/* ── 2 · LA décision du moment ─────────────────────────────────── */}
      {aTrancher ? (
        <DemandeDuSiege
          pieceId={pieceId}
          objet={aTrancher}
          auteur={dossier.data.circuit?.auteur ?? null}
          chezLeComptable={piece.vis === "partage"}
          onTranchee={async () => {
            await qc.invalidateQueries({ queryKey: ["demandes-piece", pieceId] });
            await invalidate();
          }}
        />
      ) : null}
      {retournerOuvert ? (
        <RetournerAuClient
          pieceId={pieceId}
          motifs={motifs.data ?? []}
          destinataire={leSiege}
          onFermer={() => setRetournerOuvert(false)}
          onRetournee={async () => {
            setRetournerOuvert(false);
            await invalidate();
          }}
        />
      ) : null}
      {retourSeLit ? (
        <div className="f-dec az" role="status">
          <p className="f-dec-titre">{t("common.loading")}</p>
        </div>
      ) : retourEnCours ? (
        <CarteDuRetour
          pieceId={pieceId}
          retour={retourEnCours}
          onGeste={() => faireLeGesteDuRetour(retourEnCours.geste)}
          onReprendreLaPhoto={reprendreLaPhoto}
          onVoirLeFait={() => allerA("suivi")}
          renvoyer={
            renvoyer ? { action: () => renvoyer.mutate(), enCours: renvoyer.isPending } : null
          }
          garder={
            garderLeRetour
              ? { action: () => garderLeRetour.mutate(), enCours: garderLeRetour.isPending }
              : null
          }
          supprimer={
            supprimer ? { action: () => supprimer.mutate(), enCours: supprimer.isPending } : null
          }
        />
      ) : (
        <div className={`f-dec ${decision.ton}`}>
          <div className="f-dec-tete">
            <MalicaAvatar size={44} alt="Malica" rond />
            <div>
              <p className="f-dec-titre">
                {decision.titre}
                <Aide
                  titre={t("pme.piece.revenir")}
                  paragraphes={[
                    ...(decision.sous ? [{ texte: decision.sous }] : []),
                    { texte: t("pme.piece.foot") },
                  ]}
                />
              </p>
              {decision.sous && decision.gestes.length === 0 ? (
                <p className="f-dec-sous">{decision.sous}</p>
              ) : null}
            </div>
          </div>
          {decision.gestes.length > 0 ? (
            <div className={decision.gestes.length > 1 ? "f-dec-gestes deux" : "f-dec-gestes"}>
              {/* Le principal plein d'abord : à gauche, à droite en arabe. */}
              {[...decision.gestes]
                .sort((a, b) => Number(Boolean(b.principal)) - Number(Boolean(a.principal)))
                .map((g) => (
                  <button
                    key={g.libelle}
                    type="button"
                    className={g.principal ? "pr" : undefined}
                    disabled={g.eteint}
                    onClick={g.action}
                  >
                    {g.libelle}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      )}

      {error ? (
        <div className="rev">
          <span className="q lock">
            <i />
            {t("common.error")}
          </span>
          <p>{error}</p>
        </div>
      ) : null}

      {/* ── 3 · où elle en est : envoyée, vue, prise en charge — aucune écriture ── */}
      {/* Le siège suit SON passage, au propriétaire : pas le chemin du cabinet. */}
      {piece.vis === "partage" && !siege ? (
        <div className="f-ou">
          <span>{t("pme.piece.ou")}</span>
          <div className="f-carte f-jr">
            {ouEnEst.map((e, i) => (
              <div
                key={e.cle}
                className={
                  i === derniereFaite
                    ? `courante ${TON_PME[statut]}`
                    : e.le !== null
                      ? "faite"
                      : "attente"
                }
              >
                <i />
                <span>{motDuStatut({ statut: e.cle, chez: "cabinet", qui: null })}</span>
                <u>{e.le ? momentDeLEnvoi(e.le, locale).quand : t("pme.piece.ou.avenir")}</u>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {refusDuRappel}

      {/* ── 4 · les onglets ───────────────────────────────────────────── */}
      <div
        id="onglets-de-la-piece"
        className="f-ong"
        role="tablist"
        aria-label={t("pme.piece.onglets")}
      >
        {(
          [
            ["lecture", t("pme.piece.onglet.lecture")],
            [
              "reglement",
              vente ? t("pme.piece.onglet.encaissement") : t("pme.piece.onglet.reglement"),
            ],
            ["suivi", t("pme.piece.onglet.suivi")],
          ] as const
        ).map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            id={`onglet-${cle}`}
            aria-controls={`panneau-${cle}`}
            aria-selected={onglet === cle}
            onClick={() => setOnglet(cle)}
          >
            {libelle}
          </button>
        ))}
      </div>

      {/* ── 4a · Lecture ──────────────────────────────────────────────── */}
      {onglet === "lecture" ? (
        <div
          className="f-pan"
          role="tabpanel"
          id="panneau-lecture"
          aria-labelledby="onglet-lecture"
        >
          <div className="f-carte">
            {lignesCitees.map((l) =>
              l.cle === "date" &&
              (l.valeur === null ||
                (datePrecisee !== null &&
                  !byField.get(l.champ) &&
                  STATUTS_PRECISABLES.has(piece.status))) ? (
                /*
                 * La pièce ne porte pas de date lisible : le jour du scan est
                 * proposé, modifiable, et la saisie pose une PRÉCISION (R7).
                 * Une fois donnée, la date reste modifiable tant que la pièce
                 * n'est pas engagée, et le champ rouvre CETTE date.
                 */
                <div className="f-ligne" key={l.cle}>
                  <span className="bd">
                    <span className="lb">{l.label}</span>
                    {dater.isPending ? (
                      <span className="et am">{t("common.loading")}</span>
                    ) : datePrecisee !== null ? (
                      <span className="et ok">{t("pme.verifie.confirme")}</span>
                    ) : (
                      <span className="et am">{t("piece.date.duScan")}</span>
                    )}
                  </span>
                  <input
                    type="date"
                    aria-label={l.label}
                    value={dateRetenue}
                    max={new Date().toISOString().slice(0, 10)}
                    disabled={dater.isPending}
                    onChange={(e) => {
                      setDateSaisie(e.target.value);
                      // Un champ `date` rend une chaîne vide tant que la saisie
                      // est incomplète : on n'enregistre que ce qui est une date.
                      enregistrerLaDate(e.target.value);
                    }}
                    // Garder le jour proposé est une réponse : quitter le champ
                    // l'enregistre, même sans l'avoir changé.
                    onBlur={(e) => enregistrerLaDate(e.target.value)}
                  />
                </div>
              ) : l.parLeCabinet ? (
                <div className="f-ligne" key={l.cle}>
                  <span className="bd">
                    <span className="lb">{l.label}</span>
                    <span className="et ok">{t("statut.pme.prise_en_charge")}</span>
                  </span>
                  <span className="vl">{l.valeur ?? "—"}</span>
                </div>
              ) : byField.get(l.champ) ? (
                <button
                  type="button"
                  className="f-ligne"
                  key={l.cle}
                  onClick={() => voirLaSource(l.champ)}
                  aria-label={`${l.label} — ${t("pme.citation.show")}`}
                >
                  <span className="bd">
                    <span className="lb">{l.label}</span>
                    {l.corrige ? <span className="et ok">{t("pme.piece.nom.corrige")}</span> : null}
                    {l.corrige
                      ? null
                      : (() => {
                          switch (
                            etiquetteDeLecture({
                              confianceConnue,
                              aVerifier: aVerifier.has(l.champ),
                            })
                          ) {
                            case "inconnue":
                              return <span className="et">{t("pme.citation.show")}</span>;
                            case "aVerifier":
                              return <span className="et am">{t("pme.citation.aVerifier")}</span>;
                            case "source":
                              return <span className="et ok">{t("pme.citation.source")}</span>;
                          }
                        })()}
                  </span>
                  <span className="vl">{l.valeur ?? "—"}</span>
                  <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                    <path d="M9.5 5.5L16 12l-6.5 6.5" />
                  </svg>
                </button>
              ) : (
                <div className="f-ligne" key={l.cle}>
                  <span className="bd">
                    <span className="lb">{l.label}</span>
                    <span className="et">{t("pme.citation.missing")}</span>
                  </span>
                  <span className="vl">{l.valeur ?? "—"}</span>
                </div>
              ),
            )}
          </div>
          <p className="f-note">{t("pme.verifie.source")}</p>
          {articles.length > 0 ? (
            <button type="button" className="f-bouton" onClick={() => setDetail(true)}>
              {t("pme.detail.voir")}
            </button>
          ) : null}

          {/*
           * Les constats que la carte de décision pose déjà (le sens, la date,
           * le blocage) n'y sont pas redits : une phrase, un seul endroit.
           */}
          {constats.length > 0 ? (
            <>
              <div className="f-tit">
                <h2>{t("pme.piece.verifie")}</h2>
                <span>{t("pme.piece.points", { count: constats.length })}</span>
              </div>
              <div className="ctrl">
                {constats.map((c) => (
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
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── 4b · Règlement ─────────────────────────────────────────────
          UN RÈGLEMENT NE SE MODIFIE PAS : il s'annule par une ligne datée et
          motivée, dans `CommentCEstPaye`. Le bloc reste, comptabilisée ou
          non (recette du 20 octobre) : la facture constate la dette, le
          règlement l'éteint, souvent des semaines plus tard. */}
      {onglet === "reglement" ? (
        <div
          className="f-pan"
          role="tabpanel"
          id="panneau-reglement"
          aria-labelledby="onglet-reglement"
        >
          <CommentCEstPaye
            pieceId={pieceId}
            visDeLaPiece={piece.vis === "partage" ? "partage" : "personnel"}
            dateDeLaPiece={payload?.document_date ?? null}
            /* Le facteur vient du PACK, jamais d'un « × 1000 » (R4). */
            ttcMineur={ttcMineur}
            devise={devise}
            /*
             * Le sens vient du TYPE TRANCHÉ : `null` sinon, et le reçu ne se
             * propose pas — un reçu de dépense posé sur une vente est faux.
             */
            sens={achat ? "depense" : vente ? "revenu" : null}
            tiers={payload?.issuer ?? null}
            reference={reference}
            decimales={decimales}
            ajoutOuvert={ajoutOuvert}
            onAjout={setAjoutOuvert}
          />
        </div>
      ) : null}

      {/* ── 4c · Suivi ─────────────────────────────────────────────────── */}
      {onglet === "suivi" ? (
        <div className="f-pan" role="tabpanel" id="panneau-suivi" aria-labelledby="onglet-suivi">
          {/* Le rôle vient de `acces.monAcces`, pas de l'offre. */}
          {siege ? (
            <div className="centr calme">
              <i />
              <p>{t("pme.piece.siege")}</p>
            </div>
          ) : null}

          {/* Le cabinet : transmise, gardée, ou à décider. */}
          {/*
           * Une pièce comptée et transmise ne se rappelle plus — mais la
           * réponse à un rappel demandé avant reste lisible ici (audit du
           * 25 octobre 2026 : le refus du cabinet ne se voyait nulle part).
           */}
          {siege ? (
            /*
             * Le siège suit SON passage (lot 4) : chez le propriétaire, ou
             * passée par lui chez le comptable. Il demande au propriétaire ;
             * accordée sur une pièce chez le comptable, la demande y part
             * d'elle-même, et il le lit.
             */
            <div className="f-carte f-cab">
              <p className="f-cab-etat">{motDuStatut(statutComplet)}</p>
              {dernierFaitDuRappel?.transmise && dernierFaitDuRappel.fait === "demandee" ? (
                <ConfirmationSurPlace
                  titre={t("circuit.demande.transmise", {
                    cabinet: envoiVers.quiPour("cabinet"),
                  })}
                  detail={t("envoi.demande.detail", {
                    qui: envoiVers.quiPour("cabinet"),
                    quand: momentDeLEnvoi(dernierFaitDuRappel.createdAt, locale).quand,
                  })}
                />
              ) : demandeDeRappel === "demandee" && dernierFaitDuRappel ? (
                <ConfirmationSurPlace
                  titre={t("envoi.rappel.fait", { qui: envoiVers.quiPour("proprietaire") })}
                  detail={t("envoi.demande.detail", {
                    qui: envoiVers.quiPour("proprietaire"),
                    quand: momentDeLEnvoi(dernierFaitDuRappel.createdAt, locale).quand,
                  })}
                />
              ) : demandeDeRappel === "refusee" ? null : rappeler?.a === "proprietaire" ? (
                rappeler.isError ? (
                  <PasEncoreParti
                    qui={envoiVers.quiPour("proprietaire")}
                    reessayer={() => rappeler.mutate()}
                    enCours={rappeler.isPending}
                  />
                ) : (
                  <button
                    type="button"
                    className="f-bouton"
                    disabled={rappeler.isPending}
                    onClick={() => rappeler.mutate()}
                  >
                    {rappeler.isPending ? t("common.loading") : t("envoi.rappel")}
                  </button>
                )
              ) : null}
            </div>
          ) : cabinet.data &&
            (piece.vis === "partage"
              ? !priseEnCharge || demandeDeRappel === "demandee" || demandeDeRappel === "refusee"
              : versLeComptable) ? (
            <div className="f-carte f-cab">
              {piece.vis === "partage" ? (
                <>
                  <p className="f-cab-etat">
                    {t("pme.transmettre.faite", { cabinet: cabinet.data.name })}
                  </p>
                  {demandeDeRappel === "demandee" && dernierFaitDuRappel ? (
                    /* Un geste court : la confirmation remplace le bouton, et reste. */
                    <ConfirmationSurPlace
                      titre={t("envoi.rappel.fait", { qui: cabinet.data.name })}
                      detail={t("envoi.demande.detail", {
                        qui: cabinet.data.name,
                        quand: momentDeLEnvoi(dernierFaitDuRappel.createdAt, locale).quand,
                      })}
                    />
                  ) : demandeDeRappel === "refusee" ? null : rappeler?.a !==
                    "cabinet" ? null : rappeler.isError ? (
                    <PasEncoreParti
                      qui={cabinet.data.name}
                      reessayer={() => rappeler.mutate()}
                      enCours={rappeler.isPending}
                    />
                  ) : (
                    <button
                      type="button"
                      className="f-bouton"
                      disabled={rappeler.isPending}
                      onClick={() => rappeler.mutate()}
                    >
                      {rappeler.isPending
                        ? t("common.loading")
                        : t("pme.transmettre.rappeler", { cabinet: cabinet.data.name })}
                    </button>
                  )}
                </>
              ) : !versLeComptable ? null : resteIci !== "cabinet" ? (
                /*
                 * Gardée : la décision prise, et son chemin de retour —
                 * « Transmettre quand même » ne se ferme jamais, tant que le
                 * circuit offre l'envoi (pas sur une pièce retournée au siège).
                 */
                <>
                  <p className="f-cab-etat">{t("pme.garder.faite")}</p>
                  <button
                    type="button"
                    className="f-bouton"
                    disabled={versLeComptable.isPending}
                    onClick={() => versLeComptable.mutate()}
                  >
                    {versLeComptable.isPending
                      ? t("common.loading")
                      : t("pme.garder.quandmeme", { cabinet: cabinet.data.name })}
                  </button>
                </>
              ) : (
                <>
                  <p className="f-cab-etat">
                    {t("pme.transmettre.question", { cabinet: cabinet.data.name })}
                  </p>
                  <p className="f-note">{t("pme.transmettre.chezvous")}</p>
                  {/* Le principal plein d'abord : à gauche, à droite en arabe. */}
                  <div className={garderIci ? "f-dec-gestes deux" : "f-dec-gestes"}>
                    <button
                      type="button"
                      className="pr"
                      disabled={versLeComptable.isPending || Boolean(garderIci?.isPending)}
                      onClick={() => versLeComptable.mutate()}
                    >
                      {versLeComptable.isPending
                        ? t("common.loading")
                        : t("pme.transmettre.action")}
                    </button>
                    {garderIci ? (
                      <button
                        type="button"
                        disabled={garderIci.isPending || versLeComptable.isPending}
                        onClick={() => garderIci.mutate()}
                      >
                        {garderIci.isPending ? t("common.loading") : t("pme.garder.action")}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/*
           * Documents liés : ce qui est né de cette pièce (reçus, talons), puis
           * ce qui lui a été rattaché — et le geste pour en rattacher un.
           */}
          <div className="f-tit">
            <h2>
              {t("pme.piece.liees")}
              <Aide
                titre={t("pme.piece.liees")}
                paragraphes={[{ texte: t("pme.piece.chaine.foot") }]}
              />
            </h2>
            <span>
              {t("pme.piece.chaine.pieces", {
                count: nes.length + lesRattachees.length + (piece.remplace ? 2 : 1),
              })}
            </span>
          </div>
          <div className="f-carte">
            {/* La photo que celle-ci a remplacée : gardée, jamais effacée. */}
            {piece.remplace ? (
              <Link
                className="f-ligne"
                to="/pme/piece/$pieceId"
                params={{ pieceId: piece.remplace }}
                preload="intent"
              >
                <span className="bd">
                  <span className="lb">{t("piece.versionPrecedente.titre")}</span>
                  <span className="vl-g">
                    {nomDuType(piece.documentKind) ?? t("pme.piece.title")}
                  </span>
                </span>
                <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                  <path d="M9.5 5.5L16 12l-6.5 6.5" />
                </svg>
              </Link>
            ) : null}
            {nes.map((p) => (
              <Link
                key={p.id}
                className="f-ligne"
                to="/pme/piece/$pieceId"
                params={{ pieceId: p.id }}
                preload="intent"
              >
                <span className="bd">
                  <span className="lb">{t("pme.piece.chaine.issueDe")}</span>
                  <span className="vl-g">{nomDuType(p.documentKind) ?? t("pme.piece.title")}</span>
                </span>
                <span className="dt">{jourLisible(p.createdAt) ?? "—"}</span>
                <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                  <path d="M9.5 5.5L16 12l-6.5 6.5" />
                </svg>
              </Link>
            ))}
            {lesRattachees.map((p) =>
              aDetacher === p.id ? (
                <div key={p.id} className="f-ligne f-detache">
                  <label className="bd">
                    <span className="lb">{t("pme.rattacher.pourquoi")}</span>
                    <input
                      type="text"
                      value={motifDetache}
                      onChange={(e) => setMotifDetache(e.target.value)}
                    />
                  </label>
                  <span className="f-detache-gestes">
                    <button
                      type="button"
                      onClick={() => {
                        setADetacher(null);
                        setMotifDetache("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="sup"
                      disabled={detacher.isPending || motifDetache.trim() === ""}
                      onClick={() => detacher.mutate(p.id)}
                    >
                      {detacher.isPending ? t("common.loading") : t("pme.rattacher.detacher")}
                    </button>
                  </span>
                </div>
              ) : (
                <div key={p.id} className="f-ligne f-liee">
                  <Link
                    className="bd"
                    to="/pme/piece/$pieceId"
                    params={{ pieceId: p.id }}
                    preload="intent"
                  >
                    <span className="lb">
                      {[t("pme.rattacher.rattachee"), nomDuType(p.documentKind)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="vl-g">
                      {(luesDuDossier.data ?? []).find((x) => x.id === p.id)?.emetteur ??
                        nomDuType(p.documentKind) ??
                        t("pme.piece.title")}
                    </span>
                  </Link>
                  {piece.vis !== "personnel" ? (
                    <button
                      type="button"
                      className="f-mini"
                      onClick={() => {
                        setADetacher(p.id);
                        setMotifDetache("");
                      }}
                    >
                      {t("pme.rattacher.detacher")}
                    </button>
                  ) : null}
                </div>
              ),
            )}
            {nes.length === 0 && lesRattachees.length === 0 && !piece.remplace ? (
              <div className="f-ligne">
                <span className="bd">
                  <span className="et">{t("pme.piece.chaine.vide")}</span>
                </span>
              </div>
            ) : null}
            {/*
             * Rattacher : seulement une pièce de la société — la base refuse
             * l'espace privé, et l'écran ne propose pas ce qu'elle refuserait.
             */}
            {piece.vis !== "personnel" ? (
              <button type="button" className="f-ligne" onClick={() => setRattacherOuvert(true)}>
                <span className="bd">
                  <span className="lb-a">{t("pme.rattacher.action")}</span>
                </span>
                <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                  <path d="M12 5.5v13M5.5 12h13" />
                </svg>
              </button>
            ) : null}
            <button type="button" className="f-ligne" onClick={() => allerA("reglement")}>
              <span className="bd">
                <span className="lb-a">{t("pme.piece.joindreAuReglement")}</span>
              </span>
              <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                <path d="M9.5 5.5L16 12l-6.5 6.5" />
              </svg>
            </button>
          </div>

          {/*
           * Joindre par photo ou import (planche 6) passe par la coque : ce
           * qui échoue — sélection, dépôt, rattachement, réseau — se dit ICI,
           * sur la pièce où l'on est revenu (revue de #286).
           */}
          {pme.captureError ? (
            <p role="alert" className="mt-3 text-[13px] leading-snug text-signal-warn">
              {pme.captureError}
            </p>
          ) : null}
          <RattacherUnDocument
            pieceId={pieceId}
            vis={piece.vis}
            dejaLiees={new Set([...nes, ...lesRattachees].map((p) => p.id))}
            ouvert={rattacherOuvert}
            onFermer={() => setRattacherOuvert(false)}
          />

          {/* ── REVENIR DESSUS ────────────────────────────────────────────
              Ce bloc lit `vis` et le RÔLE, et rien d'autre :
                personnel            → libre : corriger, supprimer
                entite · siège       → avant validation : corriger, demander
                entite · dirigeant   → libre : corriger, mettre au privé, supprimer
                partage              → sur accord : corriger, demander
              « Corriger » reprend la PHOTO : R7 interdit d'effacer un relevé. */}
          <div className="f-tit">
            <h2>
              {t("pme.piece.revenir")}
              <Aide
                titre={t("pme.piece.revenir")}
                paragraphes={[
                  {
                    titre:
                      vis === "partage"
                        ? t("pme.piece.elleEstPartie")
                        : vis === "entite" && siege
                          ? t("pme.piece.elleAttend")
                          : t("pme.piece.rienNestSorti"),
                    texte:
                      vis === "partage"
                        ? t("pme.piece.elleEstPartie.texte")
                        : vis === "entite" && siege
                          ? t("pme.piece.elleAttend.texte")
                          : t("pme.piece.rienNestSorti.texte"),
                  },
                ]}
              />
            </h2>
            <span>
              {vis === "partage"
                ? t("pme.piece.revenir.surAccord")
                : vis === "entite" && siege
                  ? t("pme.piece.revenir.avantValidation")
                  : t("pme.piece.revenir.libre")}
            </span>
          </div>
          {confirmerSuppression && supprimer ? (
            /* Deux temps, jamais un seul : un effacement ne part pas par mégarde. */
            <div className="f-carte f-cab">
              <p className="f-cab-etat">{t("pme.supprimer.sur")}</p>
              <div className="f-dec-gestes deux">
                <button type="button" onClick={() => setConfirmerSuppression(false)}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="sup"
                  disabled={supprimer.isPending}
                  onClick={() => supprimer.mutate()}
                >
                  {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
                </button>
              </div>
            </div>
          ) : (
            <div className="f-carte">
              <button type="button" className="f-ligne" onClick={reprendreLaPhoto}>
                <span className="bd">
                  <span className="lb-a">{t("pme.verifie.corriger")}</span>
                </span>
                <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                  <path d="M9.5 5.5L16 12l-6.5 6.5" />
                </svg>
              </button>
              {STATUTS_PRECISABLES.has(piece.status) ? (
                <button
                  type="button"
                  className="f-ligne"
                  disabled={preciser.isPending}
                  onClick={() => setCorrigerType(true)}
                >
                  <span className="bd">
                    <span className="lb-a">{t("pme.piece.type.modifier")}</span>
                  </span>
                  <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
                    <path d="M9.5 5.5L16 12l-6.5 6.5" />
                  </svg>
                </button>
              ) : null}
              {/* La remettre au privé n'a de sens que si elle n'y est pas. */}
              {remettreAuPrive ? (
                <button
                  type="button"
                  className="f-ligne"
                  disabled={remettreAuPrive.isPending}
                  onClick={() => remettreAuPrive.mutate()}
                >
                  <span className="bd">
                    <span className="lb-a">
                      {remettreAuPrive.isPending
                        ? t("common.loading")
                        : t("pme.piece.mettreAuPrive")}
                    </span>
                  </span>
                </button>
              ) : null}
              {demanderLaSuppression ? (
                <button
                  type="button"
                  className="f-ligne sup"
                  disabled={demanderLaSuppression.isPending}
                  onClick={() => demanderLaSuppression.mutate()}
                >
                  <span className="bd">
                    <span className="lb-a">
                      {demanderLaSuppression.isPending
                        ? t("common.loading")
                        : t("pme.piece.demanderSuppression")}
                    </span>
                  </span>
                </button>
              ) : null}
              {/*
               * Effacer : tant que la pièce n'est pas partie au cabinet ni
               * comptée. `entite` est encore « chez le client » — la base le
               * dit (`capture_piece_supprimer`) ; l'écran ne l'offrait qu'au
               * privé, et une pièce de la société restait sans sortie
               * (26 octobre 2026). Le collaborateur, lui, demande. Rendue par
               * le comptable, elle se supprime sans rien demander : le Socle
               * le dit (`gestesDuCircuit`), pas cet écran.
               */}
              {supprimer ? (
                <button
                  type="button"
                  className="f-ligne sup"
                  onClick={() => setConfirmerSuppression(true)}
                >
                  <span className="bd">
                    <span className="lb-a">{t("pme.supprimer.action")}</span>
                  </span>
                </button>
              ) : null}
            </div>
          )}
          {/* Hors partage, une vieille demande ne parle plus : le « Supprimer » ordinaire suffit. */}
          {suiviDeLaSuppression}
        </div>
      ) : null}
    </div>
  );
}
