import type { QualificationDeRetenue } from "@malica/socle/use-cases/retenue-au-reglement";
import type { QueueItem } from "@malica/socle/ports/repositories";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { Download, Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Aide } from "@/components/malica/aide";
import { dansLOrdreVu, ordreDeLaRevue, retenirLOrdre } from "@/lib/ordre-de-revue";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { CeQueLeLecteurALu } from "@/components/malica/ce-que-le-lecteur-a-lu";
import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { DocumentView } from "@/components/malica/document-view";
import { ControlesComptables } from "@/components/malica/controles-comptables";
import { EcritureDuCabinet } from "@/components/malica/ecriture-du-cabinet";
import { PanneauRetourne, type RetourEnvoye } from "@/components/malica/envoye";
import { TelechargerDossierComptable } from "@/components/malica/telecharger-dossier-comptable";
import { VersionPrecedente } from "@/components/malica/version-precedente";
import { nomDeFichierDePiece } from "@/lib/nom-de-fichier";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionRepliable,
  SectionTitle,
  SignalLight,
} from "@/components/malica/office-ui";
import { useLimiteDuMotif } from "@/hooks/use-limite-du-motif";
import { useI18n, type MessageKey } from "@/i18n";
import { dateEnChiffres, montant, quantite } from "@/lib/lisible";
import { saisieDecimale } from "@malica/socle/saisie-decimale";
import { office } from "@/verticals/malica-office/composition";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import type { CompteDuPlan } from "@malica/socle/ports/repositories";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import { composerLibelle } from "@malica/socle/engines/libelle";
import { statutCabinet } from "@malica/socle/statut-d-envoi";
import { faitsDuLibelle } from "@malica/socle/use-cases/libelle-de-piece";
import { leSensResteADemander } from "@malica/socle/sens-de-la-piece";

import {
  libelleDeLAction,
  libelleDuChamp,
  libelleDuCode,
  libelleDuService,
  valeurDuChamp,
  valeurLisible,
} from "@/lib/champ-lisible";
import { feuDuStatut } from "@/lib/file-cabinet";
import { apresLaReponse } from "@/lib/demande-sur-piece";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { MOT_CABINET } from "@/lib/statut";
import { estUnIdentifiant } from "@/lib/identifiant";

export const Route = createFileRoute("/_authenticated/cabinet/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Revue d'une pièce — Malica Office" },
      {
        name: "description",
        content:
          "Pièce à gauche, écriture proposée à droite : citations, verdict, comptabilisation ou retour motivé.",
      },
      { property: "og:title", content: "Revue d'une pièce — Malica Office" },
      {
        property: "og:description",
        content:
          "Pièce à gauche, écriture proposée à droite : citations, verdict, comptabilisation ou retour motivé.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  /*
   * Une autre pièce, un autre écran : sans cela, le routeur garde le
   * composant et son état d'une pièce à l'autre (« Validée » affiché sur la
   * suivante, boutons disparus — audit du 27 octobre 2026).
   */
  remountDeps: ({ params }) => params,
  component: CabinetReview,
});

/** Le libellé que le plan donne à ce compte — officiel, extension, ou du cabinet. */
function libelleDuCompte(plan: readonly CompteDuPlan[], code: string): string | null {
  const propre = code.trim();
  if (!propre) return null;
  const comptes = plan.filter((c) => c.code === propre);
  return comptes.find((c) => c.origine === "cabinet")?.libelle ?? comptes[0]?.libelle ?? null;
}

function CabinetReview() {
  const { pieceId } = Route.useParams();
  // Une adresse qui ne porte pas d'identifiant n'interroge pas la base.
  if (!estUnIdentifiant(pieceId)) return <PieceSansIdentifiant />;
  return <CabinetReviewDeLaPiece />;
}

function PieceSansIdentifiant() {
  const { t } = useI18n();
  return <EmptyState>{t("cab.review.nodoc")}</EmptyState>;
}

function CabinetReviewDeLaPiece() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [vue, setVue] = useState<"ecritures" | "controles">("ecritures");
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const [error, setError] = useState<string | null>(null);
  /**
   * Le retour au client vient de partir : le panneau « Retournée au client »
   * prend la place des écritures (maquette « Écran Envoyé », 27 octobre
   * 2026). Un état de la page — relue, la pièce change de statut, et le
   * composant qui a fait le geste disparaît.
   */
  const [retourEnvoye, setRetourEnvoye] = useState<RetourEnvoye | null>(null);
  // Le motif d'un refus. Exige par la base, et exige ici : un refus sans
  // motif n'apprend rien a celui qui a demande.
  const [noteDeRefus, setNoteDeRefus] = useState<string>("");
  const limiteDuMotif = useLimiteDuMotif();
  const [erreurDeReponse, setErreurDeReponse] = useState<string | null>(null);
  // Dans la coque native il n'y a pas de dossier de téléchargements qu'on
  // puisse ouvrir : on dit OÙ le fichier a été écrit. Un bouton qui semble ne
  // rien faire est pire que pas de bouton.
  const [cheminEnregistre, setCheminEnregistre] = useState<string | null>(null);
  /** La preuve dont l'apercu est ouvert. Une seule a la fois : l'ecran reste lisible. */
  const [preuveOuverte, setPreuveOuverte] = useState<string | null>(null);

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  /**
   * Ce que le Socle propose pour cette pièce — ou la raison de son refus.
   *
   * ============================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
   *
   * 13 octobre 2026. Sous « L'écriture du Socle », le cabinet lisait, sur six
   * pièces réelles sur six : « Aucune écriture comptabilisée sur cette pièce :
   * rien à superviser. » La phrase était vraie — aucune écriture n'était
   * comptabilisée — et sans valeur : le cabinet est là POUR superviser ce qui
   * ne passe pas tout seul.
   *
   * Ce que l'écran taisait existait pourtant, à portée d'un appel : la pièce
   * portait trois motifs, dont « montant illisible : « + 135,183 » ». Rien ne
   * les lisait.
   *
   * Désormais, à défaut d'écriture comptabilisée, l'écran montre celle que le
   * Socle PROPOSE, ou dit pourquoi il n'en propose aucune.
   */
  const proposition = useQuery({
    queryKey: ["proposition", pieceId, dossier.data?.extraction?.id ?? null],
    enabled: Boolean(dossier.data?.extraction),
    queryFn: () => office().office.propositionDePiece(pieceId),
  });

  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

  /*
   * Le pack sert à TRADUIRE les moyens de paiement, et il est lu à la date de
   * la pièce : un cabinet peut retirer un moyen, et les pièces d'avant gardent
   * celui qu'elles portaient. La juridiction est celle du cabinet, faute de
   * mieux sur cet écran — la pièce, elle, ne porte pas la sienne.
   */
  /*
   * Les décimales de la devise viennent du pack, jamais d'un « / 1000 »
   * écrit ici : trois sont tunisiennes, et la première juridiction à deux
   * aurait affiché mille fois le montant payé (R4).
   */
  const packPaiements = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  // Les codes de taxe du même pack, traduits : le taux d'une ligne se choisit là.
  const codesDeTaxe = useQuery({
    queryKey: ["tax-rates", packPaiements.data?.id, locale],
    enabled: Boolean(packPaiements.data),
    queryFn: () => office().referential.taxRates(packPaiements.data!.id, org.jurisdiction, locale),
    select: (taux) => [...new Map(taux.map((r) => [r.code, r])).values()],
  });
  // La date de la pièce quand elle a été lue ; à défaut aujourd'hui, et c'est
  // sans conséquence : cette date ne sert qu'à CHOISIR le libellé traduit d'un
  // moyen de paiement, jamais à ranger ou à calculer quoi que ce soit.
  const piecePourMoyens =
    (dossier.data?.extraction?.payload as { document_date?: string } | undefined)?.document_date ??
    new Date().toISOString().slice(0, 10);

  const audit = useQuery({
    queryKey: ["piece-audit", pieceId],
    queryFn: () => office().supervision.auditForPiece(pieceId),
  });

  // Le plan tel que CE cabinet le voit : le verbatim NC 01, les extensions
  // livrées, et les comptes qu'il a ouverts lui-même. C'est de là que le
  // libellé d'une ligne s'importe — jamais de la frappe de l'expert.
  /*
   * La file entière, pour situer cette pièce : son rang, la précédente, la
   * suivante. C'est l'ordre de la file du jour — le même que sur « Aujourd'hui ».
   */
  const navigate = useNavigate();
  /*
   * ============================================== REVENIR D'OÙ L'ON VIENT
   *
   * La pièce s'ouvre depuis la file du jour, la bibliothèque, les
   * propositions, le rapprochement… Le retour suit l'historique du routeur :
   * on revient à l'écran qui l'a ouverte, avec ses filtres. Sans historique
   * (lien ouvert directement), le lien mène à la file de revue.
   *
   * Précédente et suivante REMPLACENT l'entrée : parcourir la file ne doit
   * pas obliger à revenir pièce par pièce.
   */
  const router = useRouter();
  const peutRevenir = useCanGoBack();
  const file = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  // L'ordre montré : celui que l'expert a vu en ouvrant la revue — gardé d'une
  // pièce à l'autre, sinon la file en cache —, pas celui que la base rend une
  // fois la pièce « Vue ».
  const [ordreVu, setOrdreVu] = useState<readonly string[] | null>(
    () =>
      ordreDeLaRevue(org.id, pieceId) ??
      qc.getQueryData<QueueItem[]>(["cab-queue", org.id])?.map((r) => r.pieceId) ??
      null,
  );
  useEffect(() => {
    if (ordreVu === null && file.data) setOrdreVu(file.data.map((r) => r.pieceId));
  }, [ordreVu, file.data]);
  useEffect(() => {
    if (ordreVu) retenirLOrdre(org.id, ordreVu);
  }, [org.id, ordreVu]);
  const fileDeRevue = useMemo(() => dansLOrdreVu(ordreVu, file.data ?? []), [ordreVu, file.data]);
  const rangDansLaFile = fileDeRevue.findIndex((r) => r.pieceId === pieceId);
  const dansLaFile = rangDansLaFile >= 0 ? (fileDeRevue[rangDansLaFile] ?? null) : null;
  // Ce que le client attend sur cette piece, s'il attend quelque chose. La
  // file le porte deja : pas de seconde requete pour une valeur en main.
  const demandeEnAttente = dansLaFile?.demandeEnAttente ?? null;
  const precedente = rangDansLaFile > 0 ? (fileDeRevue[rangDansLaFile - 1] ?? null) : null;
  const suivante = rangDansLaFile >= 0 ? (fileDeRevue[rangDansLaFile + 1] ?? null) : null;
  const allerA = (id: string) =>
    void navigate({ to: "/cabinet/piece/$pieceId", params: { pieceId: id }, replace: true });

  const plan = useQuery({
    queryKey: ["plan-cabinet", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
    staleTime: 5 * 60 * 1000,
  });

  useMalicaPanel(<MalicaNote>{t("cab.malica.review")}</MalicaNote>, [locale]);

  /**
   * Le cabinet tranche la demande du client, et l'accord FAIT la chose.
   *
   * Un accord de rappel remet la piece chez le dirigeant dans la meme
   * transaction, cote base : deux gestes separes laisseraient une demande
   * accordee sans effet, et personne ne saurait laquelle des deux verites
   * croire.
   */
  /** Ce qui accompagne la pièce : son reçu de paiement, ses justificatifs. */
  const joints = useQuery({
    queryKey: ["pieces-issues", pieceId],
    queryFn: () => office().capture.piecesIssuesDe(pieceId),
  });
  /*
   * Les documents que la PME a JOINTS à la pièce (un bon de livraison
   * demandé, planche 6) : à côté de la facture, sans télécharger l'archive.
   * La base ne rend que ceux qui sont transmis au cabinet.
   */
  const rattachees = useQuery({
    queryKey: ["rattachees", pieceId],
    queryFn: () => office().capture.piecesRattachees(pieceId),
  });
  const tousLesJoints = [
    ...(joints.data ?? []),
    ...(rattachees.data ?? []).filter((r) => !(joints.data ?? []).some((j) => j.id === r.id)),
  ];

  /**
   * COMMENT LA PIÈCE A ÉTÉ PAYÉE — ce que la PME transmet au cabinet.
   *
   * 11 octobre 2026 : « chaque opération ou doc le cabinet doit voir le moyen
   * de paiement et le reçu et peut les télécharger », et « le moyen de
   * paiement, photo ou information, transmis par la PME au cabinet ».
   *
   * La donnée était lisible par le cabinet — sa RLS couvre les dossiers sous
   * mandat — et aucun écran du cabinet ne la demandait. L'expert imputait donc
   * une facture sans savoir si elle avait été réglée en espèces ou par chèque,
   * alors que c'est cela qui décide du compte de trésorerie.
   */
  const parametres = useQuery({
    queryKey: ["socle-params", packPaiements.data?.id],
    queryFn: () => office().referential.socleParams(packPaiements.data!.id),
    enabled: !!packPaiements.data?.id,
    staleTime: 60 * 60 * 1000,
  });

  // `null` tant qu'on ne les a pas : on n'en suppose aucune (R4).
  const decimales = parametres.data?.moneyDecimals ?? null;

  const paiements = useQuery({
    queryKey: ["paiements", pieceId],
    queryFn: () => office().capture.paiementsDUnePiece(pieceId),
  });
  // Vivant : tout règlement qui porte encore un effet, ou un geste (l'annulation à inscrire).
  const vivants = (paiements.data ?? []).filter((p) => !p.eteint || p.annulationAInscrire);
  const annules = (paiements.data ?? []).filter((p) => p.eteint && !p.annulationAInscrire);
  const [annulesOuverts, setAnnulesOuverts] = useState(false);
  const [signalementsOuverts, setSignalementsOuverts] = useState(false);
  const [journalOuvert, setJournalOuvert] = useState(false);

  /**
   * Les moyens du pack, traduits, à la date de la pièce.
   *
   * Le code `cheque_banque` affiché tel quel serait un identifiant machine à
   * l'écran — le défaut « ISSUER » du 5 octobre, sous un autre nom.
   */
  const moyens = useQuery({
    queryKey: ["moyens-paiement", packPaiements.data?.id, locale, piecePourMoyens],
    queryFn: () =>
      office().referential.moyensDePaiement(packPaiements.data!.id, locale, piecePourMoyens),
    enabled: !!packPaiements.data?.id,
    staleTime: 60 * 60 * 1000,
  });
  const libelleDuMoyen = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.libelle ?? code;

  /** Les types de document du référentiel, traduits — pour NOMMER un joint. */
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });
  const nomDuType = (code: string | null) =>
    code ? ((typesDoc.data ?? []).find((ty) => ty.code === code)?.libelle ?? null) : null;

  /**
   * Sortir la pièce de l'écran.
   *
   * Les octets sont déjà là — l'affichage les a chargés. Le nom donné au
   * fichier porte la référence du document quand elle a été lue : un dossier
   * de déclaration qui reçoit douze fichiers « piece.pdf » est un dossier
   * qu'on ne peut pas relire.
   */
  const telecharger = useMutation({
    mutationFn: async () => {
      const octets = await office().capture.apercu(pieceId);
      if (!octets) throw new Error(t("cab.biblio.missing"));
      const payload = dossier.data?.extraction?.payload as
        { references?: Record<string, string> } | undefined;
      const ref = payload?.references
        ? Object.values(payload.references).find((v) => v && v.trim().length > 0)
        : null;
      const { enregistrerUnFichier } = await import("@/capabilities/enregistrer-un-fichier");
      const { chemin } = await enregistrerUnFichier(
        octets,
        nomDeFichierDePiece(ref ?? null, pieceId, octets.type),
      );
      return chemin;
    },
    onSuccess: (chemin) => setCheminEnregistre(chemin),
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  /**
   * Et un document joint — le reçu, un talon.
   *
   * Ses octets ne sont pas chargés : on les demande à la lecture du dossier de
   * CETTE pièce-là, par la même route sous RLS. Les précharger tous rendrait
   * l'écran lent pour un geste qu'on fait rarement.
   */
  const telechargerUnJoint = useMutation({
    mutationFn: async (jointId: string) => {
      const d = await office().capture.dossier(jointId);
      const octets = await office().capture.apercu(jointId);
      if (!octets) throw new Error(t("cab.biblio.missing"));
      const { enregistrerUnFichier } = await import("@/capabilities/enregistrer-un-fichier");
      const { chemin } = await enregistrerUnFichier(
        octets,
        nomDeFichierDePiece(nomDuType(d.piece.documentKind), jointId, octets.type),
      );
      return chemin;
    },
    onSuccess: (chemin) => setCheminEnregistre(chemin),
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  const repondre = useMutation({
    mutationFn: async ({ accorde }: { accorde: boolean }) => {
      const objet = demandeEnAttente!;
      await office().collab.repondreSurPiece(
        pieceId,
        objet,
        accorde,
        accorde ? null : noteDeRefus.trim(),
      );
      return { objet, accorde };
    },
    onMutate: () => setErreurDeReponse(null),
    onSuccess: async ({ objet, accorde }) => {
      setNoteDeRefus("");
      /*
       * UNE PIÈCE EFFACÉE NE SE REGARDE PLUS (audit du 25 octobre 2026).
       *
       * La suppression accordée efface la pièce : rester ici montrait une
       * page fantôme, chaque appel répondant 404. On passe à la suivante de
       * la file, ou à la file elle-même — AVANT de relire, pour ne pas
       * redemander ce qui n'existe plus.
       */
      const ensuite = apresLaReponse(objet, accorde, suivante?.pieceId ?? null);
      if (ensuite) {
        if (ensuite === "file") void navigate({ to: "/cabinet", replace: true });
        else allerA(ensuite.piece);
        qc.removeQueries({ queryKey: ["piece", pieceId] });
      }
      await qc.invalidateQueries();
    },
    // Un refus de la base se lit ici, sous les boutons qui l'ont provoqué :
    // l'écran ne disait rien, et le cabinet recliquait.
    onError: (e: unknown) =>
      setErreurDeReponse(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  /*
   * ============================================== OUVRIR, C'EST VOIR
   *
   * « Malica sans blocage », §4 : ouvrir une pièce la dit « Vue », et le
   * client lit « Vue par {cabinet} ». Un fait, posé une fois par envoi : la
   * base rend la même vue si l'on rouvre. Une panne ne gêne pas l'écran —
   * elle va au journal, et la pièce se travaille quand même.
   */
  const voir = useMutation({
    mutationFn: () => office().supervision.voir(pieceId),
    onSuccess: async ({ deja }) => {
      if (deja) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
      ]);
    },
    onError: (e: unknown) =>
      void texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", ""),
  });
  const aOuvrir = dossier.data?.piece.vis === "partage" && !dossier.data.piece.remplaceePar;
  const { mutate: marquerVue } = voir;
  useEffect(() => {
    if (aOuvrir) marquerVue();
  }, [aOuvrir, marquerVue]);

  if (dossier.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!dossier.data) return <EmptyState>{t("cab.review.nodoc")}</EmptyState>;

  const { piece, contenu, extraction } = dossier.data;

  /*
   * ============================================== UNE VERSION PRÉCÉDENTE
   *
   * Le client a repris la photo : celle-ci est gelée, et tout geste sur elle
   * serait refusé (`refus.piece.remplacee`). Une notification ancienne y mène
   * pourtant. On la montre, sans aucune action, et le chemin vers la photo qui
   * fait foi — le même avis que côté PME.
   */
  if (piece.remplaceePar) {
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
          <Link
            to="/cabinet"
            onClick={(e) => {
              if (!peutRevenir) return;
              e.preventDefault();
              router.history.back();
            }}
            aria-label={t("cab.review.back")}
            title={t("cab.review.back")}
            className="flex h-11 w-11 lg:h-[34px] lg:w-[34px] shrink-0 items-center justify-center border border-border bg-card hover:bg-accent"
          >
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {t("piece.versionPrecedente.titre")}
          </h1>
        </header>
        <VersionPrecedente
          className="flex items-start gap-3 border border-s-[3px] border-border bg-card p-4 text-[13px] [&_button]:mt-3 [&_button]:h-9 [&_button]:border [&_button]:border-foreground [&_button]:bg-foreground [&_button]:px-3 [&_button]:font-medium [&_button]:text-background"
          onVoir={() => allerA(piece.versionCourante)}
        />
        {contenu ? (
          <DocumentView contenu={contenu} highlight={null} label={t("cab.review.document")} />
        ) : null}
      </div>
    );
  }

  const articles =
    (
      extraction?.payload as
        | {
            articles?: Array<{
              designation: string;
              quantity: string | null;
              unit_price_ht: string | null;
              unit_price_ttc: string | null;
              total_ht: string | null;
            }>;
          }
        | undefined
    )?.articles ?? [];
  // L'écriture qu'on lit et qu'on force : la vivante, jamais une
  // contre-passation ni un règlement (ANO-CAB-005, ANO-FC-012).
  const vivante = (ecritures.data ?? []).find((e) => e.vivante) ?? null;
  // Le mot du cabinet, dérivé au Socle — le même que dans la file.
  const statut = statutCabinet({ status: piece.status, suivi: dossier.data.suivi });
  // Le libellé que Malica propose pour cette pièce, s'il est composable.
  // Une lecture partielle ne compose rien : on ne devine pas une contrepartie.
  const libellePropose = (() => {
    const lu = ExtractV1.safeParse(dossier.data?.extraction?.payload);
    return lu.success ? composerLibelle(faitsDuLibelle(lu.data)) : null;
  })();
  // Ce que la lecture a relevé, pour nommer la pièce dans la décision.
  const luPourDecision = extraction?.payload as
    { issuer?: string; currency?: string; totals?: { ttc?: string | null } } | undefined;
  /** « ÉMETTEUR · montant devise », tel que lu — la décision et le panneau du retour. */
  const titreDeLaPiece = [
    luPourDecision?.issuer,
    luPourDecision?.totals?.ttc
      ? `${montant(luPourDecision.totals.ttc, locale)} ${luPourDecision.currency ?? ""}`.trim()
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // La date lue sur la pièce, pour une écriture saisie à la main.
  const dateLue = (extraction?.payload as { document_date?: string } | undefined)?.document_date;
  /*
   * ============================================== LE SENS SE TRANCHE ICI
   *
   * Décision du dirigeant, 29 octobre 2026 : un achat ou une vente que la
   * lecture ne tranche pas, ou qu'elle contredit (l'émetteur lu n'est pas
   * celui qu'attend le sens lu), se décide au cabinet — jamais à la PME, qui
   * ne confirme rien. Tant qu'aucune personne n'a établi le type et qu'aucune
   * écriture ne vit, et que le Socle ne propose rien pour cette raison, le
   * comptable tranche en un geste. Le type qui porte une écriture vient du
   * référentiel (`porteEcriture`), jamais d'un code écrit ici.
   */
  const sensLu =
    (extraction?.payload as { document_kind?: string | null } | undefined)?.document_kind ?? null;
  const porteEcriture = (code: string | null) =>
    Boolean(code && (typesDoc.data ?? []).find((ty) => ty.code === code)?.porteEcriture);
  const sensATrancher =
    vivante === null &&
    piece.documentKindStatut !== "confirme" &&
    proposition.data?.ok === false &&
    ((proposition.data.controlesEnDefaut ?? []).includes("sens_de_la_piece") ||
      /*
       * Le Socle dit « à compléter — type » (recette du 2 novembre 2026) :
       * la PME avait DÉCLARÉ un achat, la lecture n'a rien tranché, et le type
       * déclaré n'est pas un type établi. Les boutons Achat / Vente restaient
       * cachés parce qu'un type était déclaré ; c'est pourtant au cabinet de
       * l'établir.
       */
      (proposition.data.aCompleter ?? []).includes("type") ||
      leSensResteADemander({ sensLu, typeDeclare: piece.documentKind }));
  /*
   * Forcer ne dépend jamais du sens : un type qui ne porte pas d'écriture (un
   * ticket, un relevé, aucun) se choisit dans la saisie, comme un type que la
   * lecture n'a pas reconnu (R2).
   */
  const typeAEtablir =
    piece.documentKind === null || (typesDoc.isSuccess && !porteEcriture(piece.documentKind));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
        <Link
          to="/cabinet"
          onClick={(e) => {
            if (!peutRevenir) return;
            e.preventDefault();
            router.history.back();
          }}
          aria-label={t("cab.review.back")}
          title={t("cab.review.back")}
          className="flex h-11 w-11 lg:h-[34px] lg:w-[34px] shrink-0 items-center justify-center border border-border bg-card hover:bg-accent"
        >
          ←
        </Link>
        <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.review.ref")}
            {/*
             * « Pas une pièce, c'est un dossier si on rattache le paiement »
             * (le dirigeant, 19 octobre 2026). La facture et son règlement
             * arrivent ensemble ; l'en-tête le dit, et les deux écritures
             * se lisent plus bas, l'une sous l'autre.
             */}
            {(paiements.data ?? []).some((p) => !p.eteint) ? (
              <> · {t("cab.review.dossier")}</>
            ) : null}
            {rangDansLaFile >= 0 ? (
              <>
                {" · "}
                <span className="num">
                  {t("cab.review.rank", { n: rangDansLaFile + 1, total: fileDeRevue.length })}
                </span>
              </>
            ) : null}
          </p>
          <h1 className="mt-1 line-clamp-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">
            {dansLaFile?.clientName ?? t("cab.review.title")}
            {dansLaFile?.libelle ? (
              <span className="text-text-2"> — {dansLaFile.libelle}</span>
            ) : null}
          </h1>
          {/*
           * Une pièce qui en répète une autre arrivée avant (staging, 30
           * octobre 2026). Un mot et le lien vers l'autre ; le pourquoi dans
           * le i. Rien n'est supprimé : la PME décide.
           */}
          {dansLaFile?.doublonDe ? (
            <p className="mt-1.5 flex items-center gap-2 text-[12px]">
              <span className="bg-signal-warn px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-background">
                {t("cab.file.doublon")}
              </span>
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: dansLaFile.doublonDe }}
                className="font-medium underline underline-offset-4"
              >
                {t("cab.doublon.voir")}
              </Link>
              <Aide
                titre={t("cab.file.doublon")}
                paragraphes={[{ texte: t("cab.doublon.aide") }]}
              />
            </p>
          ) : null}
        </div>
        <SignalLight tone={feuDuStatut(statut)} label={t(MOT_CABINET[statut])} />
        <span className="ms-auto flex shrink-0 gap-1 sm:ms-0">
          <button
            type="button"
            onClick={() => precedente && allerA(precedente.pieceId)}
            disabled={!precedente}
            aria-label={t("cab.review.prev")}
            title={t("cab.review.prev")}
            className="flex h-11 w-11 lg:h-[34px] lg:w-[34px] items-center justify-center border border-border bg-card hover:bg-accent disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => suivante && allerA(suivante.pieceId)}
            disabled={!suivante}
            aria-label={t("cab.review.next")}
            title={t("cab.review.next")}
            className="flex h-11 w-11 lg:h-[34px] lg:w-[34px] items-center justify-center border border-border bg-card hover:bg-accent disabled:opacity-40"
          >
            ↓
          </button>
        </span>
      </header>

      {/*
       * ====================== CE QUE LE CLIENT DEMANDE PASSE AVANT TOUT LE RESTE
       *
       * 11 octobre 2026 : « le rappel de la pièce doit être approuvé par le
       * cabinet ». J'avais livré la demande et le bouton côté PME, et aucun
       * écran pour y répondre — on pouvait demander, personne ne pouvait
       * trancher. Le trou est de moi.
       *
       * Elle est EN TÊTE de la pièce, pas au bas : un client qui attend une
       * réponse attend sur un geste que le comptable ne doit pas chercher.
       *
       * Et le refus exige sa note, ici comme en base. Un refus sans motif
       * n'apprend rien à celui qui a demandé, et la question reviendra la
       * semaine suivante.
       */}
      {demandeEnAttente ? (
        <div className="mb-6 border border-s-[3px] border-border border-s-signal-warn bg-card p-4">
          <p className="text-[13px] font-medium">
            {t(demandeEnAttente === "rappel" ? "cab.demande.rappel" : "cab.demande.suppression", {
              client: dansLaFile?.clientName ?? "",
            })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => repondre.mutate({ accorde: true })}
              disabled={repondre.isPending}
              className="h-9 border border-foreground bg-foreground px-3 text-[13px] font-medium text-background disabled:opacity-40"
            >
              {t("cab.demande.accorder")}
            </button>
            <input
              value={noteDeRefus}
              onChange={(e) => setNoteDeRefus(e.target.value)}
              maxLength={limiteDuMotif}
              aria-label={t("cab.demande.motif")}
              placeholder={t("cab.demande.motif")}
              className="h-9 min-w-[220px] flex-1 border border-border bg-background px-2 text-[13px]"
            />
            <button
              type="button"
              onClick={() => repondre.mutate({ accorde: false })}
              disabled={repondre.isPending || noteDeRefus.trim().length === 0}
              className="h-9 border border-border px-3 text-[13px] font-medium disabled:opacity-40"
            >
              {t("cab.demande.refuser")}
            </button>
          </div>
          {erreurDeReponse ? (
            <p role="alert" className="mt-2 text-[12px] text-signal-warn">
              {erreurDeReponse}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
       * Rien ne se perd dans l'écran résumé : ce que la pièce porte se voit
       * d'un coup d'œil, et chaque pastille mène à son détail (8 novembre 2026).
       */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <nav
          aria-label={t("cab.review.contenu")}
          className="me-auto flex flex-wrap items-center gap-1.5"
        >
          {[
            { id: "dossier-articles", cle: "cab.review.contenu.articles", n: articles.length },
            {
              id: "dossier-paiements",
              cle: "cab.review.contenu.paiements",
              n: (paiements.data ?? []).length,
            },
            {
              id: "dossier-joints",
              cle: "cab.review.contenu.joints",
              n: (joints.data ?? []).length,
            },
          ]
            .filter((c) => c.n > 0)
            .map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(c.id)
                    ?.scrollIntoView({ block: "start", behavior: "smooth" });
                }}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border bg-card px-3 text-[13px] hover:bg-accent"
              >
                {t(c.cle as MessageKey)}
                <span className="num text-muted-foreground">{c.n}</span>
              </a>
            ))}
        </nav>
        <TelechargerDossierComptable
          cabinetId={org.id}
          clientId={piece.tenantId}
          nomClient={
            clients.data?.find((c) => c.tenantId === piece.tenantId)?.name ?? piece.tenantId
          }
          pieces={[pieceId]}
          libelle={t("cab.biblio.operation")}
        />
      </div>
      <div className="cab-operation-layout grid gap-8 xl:grid-cols-[1.15fr_1fr]">
        <section className="min-w-0 space-y-3">
          <SectionTitle>{t("cab.review.document")}</SectionTitle>
          {contenu ? (
            <>
              {/* La pièce ne se surligne plus ici : la liste des citations est
                  partie, et plus rien ne désigne de zone. */}
              <DocumentView
                contenu={contenu}
                highlight={null}
                label={t("cab.review.document")}
                attente={<ApercuDePiece pieceId={piece.id} />}
              />
              {/*
               * ============================================ SORTIR LA PIÈCE DE L'ÉCRAN
               *
               * 11 octobre 2026 : « le cabinet peut faire le download de la
               * facture ou n'importe quel document partagé ».
               *
               * Les octets étaient déjà chargés pour l'affichage. Un expert
               * qui doit joindre une facture à une déclaration n'avait
               * pourtant aucun moyen de la sortir : il ne restait que la
               * capture d'écran.
               */}
              <button
                type="button"
                onClick={() => telecharger.mutate()}
                disabled={telecharger.isPending}
                className="inline-flex h-9 items-center gap-2 border border-border px-3 text-[13px] font-medium hover:bg-accent disabled:opacity-40"
              >
                <Download className="h-[14px] w-[14px]" aria-hidden />
                {telecharger.isPending ? t("common.loading") : t("cab.review.telecharger")}
              </button>
              {cheminEnregistre ? (
                <p className="text-[12px] text-text-2">
                  {t("cab.review.enregistre", { chemin: cheminEnregistre })}
                </p>
              ) : null}

              {/*
               * ============================== COMMENT ELLE A ÉTÉ PAYÉE
               *
               * 11 octobre 2026 : « chaque opération ou doc le cabinet doit
               * voir le moyen de paiement et le reçu et peut les
               * télécharger ».
               *
               * Ce n'est pas un détail d'affichage : le moyen décide du
               * compte de trésorerie. Un expert qui impute une facture sans
               * savoir si elle a été réglée en espèces ou par chèque choisit
               * le compte au hasard — et c'est un rapprochement bancaire qui
               * s'en apercevra, un mois plus tard.
               */}
              {(paiements.data ?? []).length > 0 ? (
                <>
                  <span id="dossier-paiements" />
                  <SectionTitle>{t("cab.review.paiements")}</SectionTitle>
                  {/*
                   * Relevé sur staging le 29 octobre 2026 : six règlements
                   * annulés passaient AVANT le vivant. Le vivant d'abord (et
                   * l'annulation qui attend son inscription, qui est un geste) ;
                   * les annulés, sans effet comptable, se replient sous une ligne.
                   */}
                  {[vivants, annulesOuverts ? annules : []].map((lot, i) =>
                    lot.length === 0 ? null : (
                      <ul key={i} className="grid gap-px border border-border bg-border">
                        {lot.map((p) => (
                          <li key={p.id} className="bg-card px-3 py-2.5">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-[13px] font-medium">
                                {libelleDuMoyen(p.moyenCode)}
                              </span>
                              <span className="num shrink-0 text-[13px]">
                                {p.montantMineur === null || decimales === null
                                  ? "—"
                                  : `${montant(depuisUniteMineure(p.montantMineur, decimales), locale)} ${p.devise}`}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-3">
                              <span className="text-[11.5px] text-muted-foreground">
                                {p.payeLe
                                  ? dateEnChiffres(p.payeLe, locale)
                                  : t("cab.review.paiement.sansDate")}
                              </span>
                              {/*
                               * La photo du talon — « le moyen de paiement, photo
                               * ou information, transmis par la PME au cabinet ».
                               * Elle se télécharge, parce qu'une preuve qu'on ne
                               * peut pas joindre à un dossier n'est pas une
                               * preuve.
                               */}
                              {p.justificatifPieceId ? (
                                <span className="flex shrink-0 items-center gap-1.5">
                                  {/*
                                   * ============================= VOIR, AVANT DE TÉLÉCHARGER
                                   *
                                   * La preuve ne se téléchargeait que. Pour lire un
                                   * numéro de chèque, l'expert enregistrait un
                                   * fichier, l'ouvrait hors de l'application, puis
                                   * revenait — pour trois chiffres.
                                   *
                                   * `DocumentView` est déjà là, deux cents lignes
                                   * plus haut, et sert à la facture. Un composant
                                   * disponible, éprouvé, et non appelé : c'est le
                                   * motif récurrent de ce dépôt.
                                   */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreuveOuverte(
                                        preuveOuverte === p.justificatifPieceId
                                          ? null
                                          : p.justificatifPieceId,
                                      )
                                    }
                                    className="inline-flex h-7 items-center gap-1.5 border border-border px-2 text-[11.5px] font-medium hover:bg-accent"
                                  >
                                    <Eye className="h-[12px] w-[12px]" aria-hidden />
                                    {preuveOuverte === p.justificatifPieceId
                                      ? t("cab.review.paiement.fermer")
                                      : t("cab.review.paiement.voir")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      telechargerUnJoint.mutate(p.justificatifPieceId!)
                                    }
                                    disabled={telechargerUnJoint.isPending}
                                    className="inline-flex h-7 items-center gap-1.5 border border-border px-2 text-[11.5px] font-medium hover:bg-accent disabled:opacity-40"
                                  >
                                    <Download className="h-[12px] w-[12px]" aria-hidden />
                                    {t("cab.review.paiement.preuve")}
                                  </button>
                                </span>
                              ) : (
                                <span className="text-[11.5px] text-signal-warn">
                                  {t("cab.review.paiement.sansPreuve")}
                                </span>
                              )}
                            </div>
                            {p.reference ? (
                              <span className="num mt-0.5 block text-[11.5px] text-muted-foreground">
                                {t("cab.review.paiement.reference")} {p.reference}
                              </span>
                            ) : null}
                            {preuveOuverte === p.justificatifPieceId && p.justificatifPieceId ? (
                              <ApercuDeLaPreuve jointId={p.justificatifPieceId} />
                            ) : null}
                            {p.eteint && p.annulationAInscrire ? (
                              <AnnulationAInscrire
                                ecritureId={p.annulationAInscrire}
                                pieceId={pieceId}
                              />
                            ) : p.eteint ? (
                              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                                {t("cab.review.paiement.eteint")}
                              </span>
                            ) : (
                              <EcritureDuReglement
                                paiementId={p.id}
                                pieceId={pieceId}
                                plan={plan.data ?? []}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    ),
                  )}
                  {annules.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={annulesOuverts}
                      onClick={() => setAnnulesOuverts((o) => !o)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] text-muted-foreground underline underline-offset-4"
                    >
                      {t("cab.review.paiement.annules", { count: annules.length })}
                    </button>
                  ) : null}
                </>
              ) : null}

              {/*
               * ===================================== CE QUI ACCOMPAGNE LA PIÈCE
               *
               * Le reçu de paiement, les talons de chèque. Ils sont transmis
               * avec la facture et étaient introuvables depuis elle : le lien
               * existait en base, aucun écran ne le suivait.
               */}
              {tousLesJoints.length > 0 ? (
                <>
                  <span id="dossier-joints" />
                  <SectionTitle>{t("cab.review.joints")}</SectionTitle>
                  <ul className="grid gap-px border border-border bg-border">
                    {tousLesJoints.map((j) => (
                      <li
                        key={j.id}
                        className="flex items-center justify-between gap-3 bg-card px-3 py-2"
                      >
                        {/*
                         * Le libellé vient du RÉFÉRENTIEL, traduit. Un
                         * « recu_de_paiement » affiché tel quel est un
                         * identifiant machine à l'écran — le défaut « ISSUER »
                         * du 5 octobre, sous un autre nom.
                         */}
                        <span className="flex min-w-0 items-center gap-3">
                          <ApercuDePiece pieceId={j.id} className="vignette" />
                          <span className="truncate text-[13px]">
                            {nomDuType(j.documentKind) ?? t("cab.review.document")}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => telechargerUnJoint.mutate(j.id)}
                          disabled={telechargerUnJoint.isPending}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-border px-2.5 text-[12.5px] font-medium hover:bg-accent disabled:opacity-40"
                        >
                          <Download className="h-[13px] w-[13px]" aria-hidden />
                          {t("cab.review.telecharger")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="border border-border bg-card p-3 text-xs text-muted-foreground">
              {t("cab.review.nodoc")}
            </p>
          )}

          {articles.length > 0 ? (
            <>
              <span id="dossier-articles" />
              <SectionTitle>{t("pme.extract.articles")}</SectionTitle>
              <InkTable
                empile
                caption={t("pme.extract.articles")}
                head={[
                  t("pme.extract.designation"),
                  t("pme.extract.qty"),
                  t("pme.extract.pu_ht"),
                  t("pme.extract.pu_ttc"),
                  t("pme.extract.base"),
                ]}
              >
                {articles.map((article, index) => (
                  <InkTableRow key={index}>
                    <InkCell>{article.designation}</InkCell>
                    <InkCell numeric label={t("pme.extract.qty")}>
                      {article.quantity ? quantite(article.quantity, locale) : "—"}
                    </InkCell>
                    <InkCell numeric label={t("pme.extract.pu_ht")}>
                      {article.unit_price_ht ? montant(article.unit_price_ht, locale) : "—"}
                    </InkCell>
                    <InkCell numeric label={t("pme.extract.pu_ttc")}>
                      {article.unit_price_ttc ? montant(article.unit_price_ttc, locale) : "—"}
                    </InkCell>
                    <InkCell numeric label={t("pme.extract.base")}>
                      {article.total_ht ? montant(article.total_ht, locale) : "—"}
                    </InkCell>
                  </InkTableRow>
                ))}
              </InkTable>
            </>
          ) : null}

          {extraction && extraction.flags.length > 0 ? (
            <div className="border border-s-2 border-border border-s-signal-warn bg-card p-3">
              <button
                type="button"
                aria-expanded={signalementsOuverts}
                onClick={() => setSignalementsOuverts((o) => !o)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 text-start text-[11px] font-semibold uppercase tracking-wide text-signal-warn"
              >
                <span className="flex items-baseline gap-2">
                  <span aria-hidden className="text-[11px] opacity-60">
                    {signalementsOuverts ? "−" : "+"}
                  </span>
                  {t("pme.read.flags")}
                </span>
                <span className="num">{grouperLesSignalements(extraction.flags).length}</span>
              </button>
              {/*
               * Les signalements se disent UNE FOIS par cause.
               *
               * La capture du 11 octobre montrait cinq lignes « Article n ·
               * PU TTC — Signalement de lecture. », rigoureusement
               * identiques. Cinq fois la même cause, sur cinq champs : c'est
               * une information, pas cinq.
               */}
              {signalementsOuverts ? (
                <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                  {grouperLesSignalements(extraction.flags).map((g, index) => (
                    <li key={index}>
                      <span className="font-medium text-foreground">
                        {g.champs.map((c) => libelleDuChamp(c, t)).join(" · ")}
                      </span>
                      {" — "}
                      {libelleDuCode(g.code, t)}
                      {g.detail ? <span className="num"> {g.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {retourEnvoye ? (
          <PanneauRetourne
            piece={titreDeLaPiece}
            client={dansLaFile?.clientName ?? null}
            retour={retourEnvoye}
            suivante={suivante ? () => allerA(suivante.pieceId) : null}
            file={() => void navigate({ to: "/cabinet" })}
          />
        ) : null}
        <section className="space-y-3" hidden={retourEnvoye !== null}>
          <div className="cab-doclib-tabs" role="tablist" aria-label={t("cab.biblio.entries")}>
            <button
              type="button"
              role="tab"
              aria-selected={vue === "ecritures"}
              onClick={() => setVue("ecritures")}
            >
              {t("cab.biblio.entries")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vue === "controles"}
              onClick={() => setVue("controles")}
            >
              {t("cab.biblio.fiscal")}
            </button>
          </div>
          {vue === "controles" ? (
            <ControlesComptables cabinetId={org.id} pieceId={pieceId} />
          ) : null}
          <div hidden={vue !== "ecritures"} className="space-y-3">
            {/*
             * L'écriture, et les gestes du comptable : valider ou forcer,
             * retourner. Aucun n'attend le client (« Malica sans blocage »).
             * La table repart de ce qui existe à chaque changement : écriture
             * prise en charge, proposition du Socle, ou rien.
             */}
            {ecritures.isPending || (extraction && proposition.isPending) ? (
              <EmptyState>{t("common.loading")}</EmptyState>
            ) : (
              <EcritureDuCabinet
                key={`${vivante?.id ?? "-"}|${proposition.data?.ok ? "p" : "r"}`}
                pieceId={pieceId}
                clientId={piece.tenantId}
                statut={statut}
                suivi={dossier.data.suivi}
                vivante={vivante}
                proposition={proposition.data}
                typeAEtablir={typeAEtablir}
                sens={sensATrancher ? { lu: sensLu } : null}
                dateLue={dateLue ?? null}
                libellePropose={libellePropose}
                plan={plan.data ?? []}
                decimales={decimales}
                motifs={motifs.data ?? []}
                codesDeTaxe={codesDeTaxe.data ?? []}
                illisible={dossier.data.ecritureIllisible ?? false}
                onRetournee={setRetourEnvoye}
                onInscrite={() =>
                  suivante ? allerA(suivante.pieceId) : void navigate({ to: "/cabinet" })
                }
              />
            )}

            <CeQueLeLecteurALu pieceId={pieceId} />

            <SectionRepliable
              titre={t("cab.review.audit")}
              ouvert={journalOuvert}
              onBascule={() => setJournalOuvert((o) => !o)}
              resume={<span className="num">{(audit.data ?? []).length}</span>}
            >
              {(audit.data ?? []).length === 0 ? (
                <EmptyState>{t("cab.review.audit.empty")}</EmptyState>
              ) : (
                <ul className="grid gap-px border border-border bg-border text-[12px]">
                  {(audit.data ?? []).map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline justify-between gap-3 bg-card px-3 py-2"
                    >
                      <span>
                        {libelleDeLAction(entry.action, t, entry.payload)}
                        {entry.service ? (
                          <span className="text-muted-foreground">
                            {" · "}
                            {libelleDuService(entry.service, t)}
                          </span>
                        ) : null}
                      </span>
                      <span className="num shrink-0 text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(entry.at))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionRepliable>
          </div>
        </section>
      </div>

      {error ? <p className="num text-[12px] text-signal-warn">{error}</p> : null}
    </div>
  );
}

/**
 * Les signalements de lecture, regroupés par cause.
 *
 * Un même code sur cinq champs est UNE information, pas cinq : la capture du
 * 11 octobre montrait cinq lignes « Article n · PU TTC — Signalement de
 * lecture. » à l'identique, et un panneau qui se répète cesse d'être lu.
 *
 * Le détail fait partie de la clé : « TVA = TTC − base HT » et « TTC de ligne
 * = base HT + TVA » sont deux causes différentes sous le même code, et les
 * confondre perdrait justement ce qui les distingue.
 */
function grouperLesSignalements(
  flags: Array<{ field: string; code: string; detail?: string }>,
): Array<{ code: string; detail: string | undefined; champs: string[] }> {
  const parCause = new Map<
    string,
    { code: string; detail: string | undefined; champs: string[] }
  >();
  for (const f of flags) {
    const cle = `${f.code}|${f.detail ?? ""}`;
    const vu = parCause.get(cle);
    if (vu) {
      if (!vu.champs.includes(f.field)) vu.champs.push(f.field);
    } else {
      parCause.set(cle, { code: f.code, detail: f.detail, champs: [f.field] });
    }
  }
  return [...parCause.values()];
}

/**
 * Ce que le moyen de paiement engage : l'écriture du règlement.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026, le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ». Le référentiel portait depuis
 * le 11 octobre le compte de trésorerie de chaque moyen — 54 Caisse, 532
 * Banques, 403 Effets à payer — et rien ne le lisait.
 *
 * Le moteur a été écrit le 13 octobre. Ce composant est son consommateur, et
 * il naît le même jour : un moteur sans écran est exactement le défaut que
 * cette journée a passé à corriger.
 *
 * La facture constate une dette, le règlement l'éteint. L'expert voit donc
 * les deux, séparément, et c'est lui qui inscrit.
 */
/**
 * L'annulation d'un règlement que la PME a demandée, dans un dossier confié :
 * la contre-passation est proposée, l'expert l'inscrit (24 octobre 2026).
 * Tant qu'elle ne l'est pas, le règlement d'origine compte encore : l'écran
 * ne dit donc pas « sans effet comptable ».
 */
function AnnulationAInscrire({ ecritureId, pieceId }: { ecritureId: string; pieceId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const inscrire = useMutation({
    mutationFn: () => office().office.book(ecritureId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["paiements", pieceId] }),
      ]);
    },
  });
  return (
    <div className="mt-1.5">
      <p className="text-[11.5px] text-signal-warn">
        {t("cab.review.paiement.annulationAInscrire")}
      </p>
      <button
        type="button"
        onClick={() => inscrire.mutate()}
        disabled={inscrire.isPending || inscrire.isSuccess}
        className="mt-1 h-7 border border-border px-2 text-[11.5px] font-medium hover:bg-accent disabled:opacity-40"
      >
        {inscrire.isPending ? t("common.loading") : t("cab.review.paiement.inscrireAnnulation")}
      </button>
      {inscrire.error ? (
        <p role="alert" className="mt-1 text-[11.5px] text-signal-stop">
          {texteDeLErreur(
            inscrire.error,
            "routes/_authenticated/cabinet.piece.$pieceId",
            t("common.error"),
          )}
        </p>
      ) : null}
    </div>
  );
}

function EcritureDuReglement({
  paiementId,
  pieceId,
  plan,
}: {
  paiementId: string;
  pieceId: string;
  plan: readonly CompteDuPlan[];
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [qualification, setQualification] = useState<QualificationDeRetenue>();
  const [codes, setCodes] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [tva, setTva] = useState("");
  const [assietteIR, setAssietteIR] = useState("");
  const [justification, setJustification] = useState("");
  // Sous le seuil, rien n'est demandé ; le comptable peut quand même déclarer
  // une retenue sans seuil (honoraires, loyers, non-résidents).
  const [declarer, setDeclarer] = useState(false);
  const proposition = useQuery({
    queryKey: ["reglement", paiementId, qualification],
    queryFn: () => office().office.propositionDeReglement(paiementId, qualification),
  });
  const inscrire = useMutation({
    // Proposer ET comptabiliser, une fois : l'écriture du règlement entre au
    // journal et au FEC, et redemander rend la même (ANO-006).
    mutationFn: () => office().office.inscrireLeReglement(paiementId, qualification),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["reglement", paiementId] }),
        qc.invalidateQueries({ queryKey: ["paiements", pieceId] }),
      ]);
    },
  });

  if (proposition.isPending) return null;
  const r = proposition.data;
  if (!r) return null;

  if (!r.ok)
    return (
      <div>
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">{r.raison}</p>
        {qualification ? (
          <button type="button" onClick={() => setQualification(undefined)}>
            {t("cab.retenue.edit")}
          </button>
        ) : null}
      </div>
    );

  const saisie = qualificationSaisie({
    codes,
    base: base || r.ttc || "",
    tva,
    assietteIR,
    justification,
    paye: r.paye,
    motifExige: r.retenue.cas === "a_confirmer",
  });

  return (
    <div className="mt-2 border-s-2 border-border ps-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {t("cab.review.reglement")} · {r.ecriture.journal} ·{" "}
        {dateEnChiffres(r.ecriture.dateEcriture, locale)}
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{r.ecriture.libelle}</p>
      {!r.inscrite &&
      !qualification &&
      r.retenue.cas === "sans_objet" &&
      !declarer &&
      r.tauxDisponibles.length > 0 ? (
        <button
          type="button"
          onClick={() => setDeclarer(true)}
          className="mt-1 text-[11.5px] font-medium underline underline-offset-2"
        >
          {t("cab.retenue.declarer")}
        </button>
      ) : null}
      {!r.inscrite && (r.retenue.cas === "a_confirmer" || (declarer && !qualification)) ? (
        <fieldset className="my-3 min-w-0 space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-[12px] font-medium">{t("cab.retenue.qualify")}</legend>
          <select
            aria-label={t("cab.retenue.withholding")}
            className="w-full border border-border bg-background p-2 text-[12px]"
            value={
              codes.find((c) => r.tauxDisponibles.find((x) => x.code === c)?.famille !== "tva") ??
              ""
            }
            onChange={(e) =>
              setCodes([
                ...codes.filter(
                  (c) => r.tauxDisponibles.find((x) => x.code === c)?.famille === "tva",
                ),
                ...(e.target.value ? [e.target.value] : []),
              ])
            }
          >
            <option value="">{t("cab.retenue.noWithholding")}</option>
            {r.tauxDisponibles
              .filter((x) => x.famille !== "tva")
              .map((x) => (
                <option key={x.code} value={x.code}>
                  {x.libelle}
                </option>
              ))}
          </select>
          {r.tauxDisponibles
            .filter((x) => x.famille === "tva")
            .map((x) => (
              <label key={x.code} className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={codes.includes(x.code)}
                  onChange={(e) =>
                    setCodes(
                      e.target.checked ? [...codes, x.code] : codes.filter((c) => c !== x.code),
                    )
                  }
                />
                {x.libelle}
              </label>
            ))}
          {codes.length ? (
            <>
              <label className="block text-[12px]">
                {t("cab.retenue.grossSettled")}
                <input
                  inputMode="decimal"
                  className="mt-1 w-full border border-border bg-background p-2"
                  value={base || r.ttc || ""}
                  onChange={(e) => setBase(e.target.value)}
                />
              </label>
              {codes.some((c) => r.tauxDisponibles.find((x) => x.code === c)?.famille !== "tva") ? (
                <label className="block text-[12px]">
                  {t("cab.retenue.irBase")}
                  <input
                    inputMode="decimal"
                    className="mt-1 w-full border border-border bg-background p-2"
                    value={assietteIR || base || r.ttc || ""}
                    onChange={(e) => setAssietteIR(e.target.value)}
                  />
                </label>
              ) : null}
              {codes.some((c) => r.tauxDisponibles.find((x) => x.code === c)?.base === "tva") ? (
                <label className="block text-[12px]">
                  {t("cab.retenue.vatSettled")}
                  <input
                    inputMode="decimal"
                    className="mt-1 w-full border border-border bg-background p-2"
                    value={tva}
                    onChange={(e) => setTva(e.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          {/*
           * Le certificat se justifie quand une retenue est OPÉRÉE. « Sans
           * retenue » sous le seuil n'a rien à justifier ; au-dessus du seuil,
           * ne rien retenir est une décision et se motive (exonération,
           * attestation, nature de l'opération).
           */}
          <label className="block text-[12px]">
            {t("cab.retenue.taxEvidence")}
            <input
              className="mt-1 w-full border border-border bg-background p-2"
              value={justification}
              required={saisie.avecRetenue || r.retenue.cas === "a_confirmer"}
              onChange={(e) => setJustification(e.target.value)}
            />
          </label>
          {saisie.illisible ? (
            <p role="alert" className="text-[11.5px] text-signal-warn">
              {t("cab.retenue.montantIllisible")}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!saisie.qualification}
            className="h-8 border border-border px-3 text-[12px] disabled:opacity-40"
            onClick={() => saisie.qualification && setQualification(saisie.qualification)}
          >
            {t("cab.retenue.preview")}
          </button>
        </fieldset>
      ) : null}
      {r.inscrite && r.retenue.cas === "a_confirmer" ? (
        <p className="my-2 text-[12px] text-signal-warn">{t("cab.retenue.unconfirmed")}</p>
      ) : null}
      {qualification && !r.inscrite ? (
        <button
          type="button"
          className="my-2 text-[12px] underline"
          onClick={() => setQualification(undefined)}
        >
          {t("cab.retenue.edit")}
        </button>
      ) : null}
      {r.retenue.cas === "operee"
        ? (() => {
            const ttc = montant(r.retenue.ttc, locale);
            return r.retenue.retenues.map((x) => (
              <p key={x.code} className="mt-0.5 flex items-center text-[11.5px]">
                {t("cab.review.reglement.retenue", {
                  libelle: x.libelle,
                  montant: montant(x.montant, locale),
                  ttc,
                })}
                {/* Le pourquoi du net va dans le i : l'écran garde le fait et le chiffre. */}
                <Aide
                  titre={x.libelle}
                  paragraphes={[{ texte: t("cab.review.reglement.retenue.aide") }]}
                />
              </p>
            ));
          })()
        : null}
      {r.retenue.cas === "sans_objet" ? (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("cab.retenue.sansObjet")}</p>
      ) : null}
      <ul className="mt-1">
        {r.ecriture.lignes.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
            <LigneDuCompte
              code={l.account_code}
              intitule={libelleDuCompte(plan, l.account_code)}
              libelle={l.libelle}
            />
            <span className="num shrink-0">
              {Number(l.debit) > 0
                ? `${montant(l.debit, locale)} D`
                : `${montant(l.credit, locale)} C`}
            </span>
          </li>
        ))}
      </ul>
      {r.inscrite ? (
        <p className="mt-1.5 text-[11.5px] font-medium text-signal-ok">
          {t("cab.review.reglement.inscrit")}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => inscrire.mutate()}
          disabled={inscrire.isPending || inscrire.isSuccess || r.retenue.cas === "a_confirmer"}
          className="mt-1.5 h-7 border border-border px-2 text-[11.5px] font-medium hover:bg-accent disabled:opacity-40"
        >
          {inscrire.isPending ? t("common.loading") : t("cab.review.reglement.inscrire")}
        </button>
      )}
      {inscrire.isError ? (
        <p className="mt-1 text-[11.5px] text-signal-warn">
          {texteDeLErreur(inscrire.error, "routes/_authenticated/cabinet.piece", t("common.error"))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ce que la saisie du traitement fiscal permet d'envoyer au moteur.
 *
 * Les montants sont relus par `saisieDecimale` : « 1 234,500 », tel que
 * l'écran l'affiche, devient « 1234.500 ». Un montant illisible n'est pas
 * envoyé — le moteur le refuserait, et la personne ne saurait pas lequel.
 * Sans retenue, la base réglée est le payé déclaré, et aucune justification
 * n'est exigée.
 */
function qualificationSaisie(s: {
  codes: string[];
  base: string;
  tva: string;
  assietteIR: string;
  justification: string;
  paye: string;
  /** Au-dessus d'un seuil, ne rien retenir se motive aussi. */
  motifExige: boolean;
}): { avecRetenue: boolean; illisible: boolean; qualification: QualificationDeRetenue | null } {
  const avecRetenue = s.codes.length > 0;
  const facultatif = (v: string) => (v.trim() ? saisieDecimale(v) : null);
  const baseReglee = avecRetenue ? saisieDecimale(s.base) : s.paye;
  const tvaReglee = facultatif(s.tva);
  const assietteIR = facultatif(s.assietteIR);
  const illisible =
    avecRetenue &&
    (baseReglee === null ||
      (s.tva.trim() !== "" && tvaReglee === null) ||
      (s.assietteIR.trim() !== "" && assietteIR === null));
  const justification = s.justification.trim();
  const pret =
    !illisible && baseReglee !== null && ((!avecRetenue && !s.motifExige) || justification !== "");
  return {
    avecRetenue,
    illisible,
    qualification: pret
      ? { codes: s.codes, baseReglee, tvaReglee, assietteIR, justification }
      : null,
  };
}

/**
 * L'intitulé du compte ET le libellé de la ligne.
 *
 * L'un dit OÙ va le montant (« 4011 Fournisseurs »), l'autre POURQUOI
 * (« Retenue 1,5 % / tiers ») : remplacer le second par le premier perdait
 * ce qui distingue deux lignes sur le même compte. Le libellé n'est répété
 * que s'il apporte autre chose que l'intitulé.
 */
function LigneDuCompte({
  code,
  intitule,
  libelle,
}: {
  code: string;
  intitule: string | null;
  libelle: string;
}) {
  const { t } = useI18n();
  const propre = libelle.trim();
  return (
    <span className="min-w-0">
      <span className="num">{code}</span>{" "}
      <span className="text-muted-foreground">{intitule ?? t("cab.biblio.accountUnknown")}</span>
      {propre && propre !== intitule ? (
        <span className="block text-[11.5px] text-text-2">{propre}</span>
      ) : null}
    </span>
  );
}

/**
 * L'aperçu d'une preuve de paiement, dans l'écran.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. La photo du talon ne se TÉLÉCHARGEAIT que. Pour lire un
 * numéro de chèque — trois chiffres, et c'est ce qui rapproche une facture
 * d'un extrait bancaire — l'expert enregistrait un fichier, l'ouvrait hors de
 * l'application, puis revenait.
 *
 * `DocumentView` était pourtant déjà importé dans ce fichier, et servait à la
 * facture deux cents lignes plus haut. Un composant disponible, éprouvé, et
 * non appelé : le motif récurrent de ce dépôt.
 *
 * Le téléchargement reste : une preuve qu'on ne peut pas joindre à un dossier
 * n'est pas une preuve. On ajoute, on ne remplace pas.
 */
function ApercuDeLaPreuve({ jointId }: { jointId: string }) {
  const { t } = useI18n();
  const preuve = useQuery({
    queryKey: ["preuve", jointId],
    queryFn: () => office().capture.dossier(jointId),
  });

  if (preuve.isPending)
    return <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("common.loading")}</p>;
  if (!preuve.data?.contenu)
    return (
      <p className="mt-1.5 text-[11.5px] text-signal-warn">
        {t("cab.review.paiement.preuveIllisible")}
      </p>
    );

  return (
    <div className="mt-2">
      <DocumentView
        contenu={preuve.data.contenu}
        highlight={null}
        label={t("cab.review.paiement.preuve")}
      />
    </div>
  );
}
