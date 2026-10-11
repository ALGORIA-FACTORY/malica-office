import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { DocumentView } from "@/components/malica/document-view";
import { ListeDesComptes, SaisieDeCompte } from "@/components/malica/saisie-compte";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
  SignalLight,
  StickyActions,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { montant, quantite } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { Citation, CompteDuPlan, Ecriture } from "@malica/socle/ports/repositories";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import { composerLibelle, critiquerLibelle } from "@malica/socle/engines/libelle";
import { faitsDuLibelle } from "@malica/socle/use-cases/libelle-de-piece";

import {
  libelleDeLAction,
  libelleDuChamp,
  libelleDuCode,
  valeurDuChamp,
  valeurLisible,
} from "@/lib/champ-lisible";
import { toneForStatus } from "@/lib/file-cabinet";
import { texteDeLErreur } from "@/lib/erreur-lisible";

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
  component: CabinetReview,
});

/**
 * La correction en cours de saisie.
 *
 * Elle vit à côté de l'écriture d'origine, jamais dedans : celle-ci est
 * comptabilisée, donc close. Chaque ligne garde son montant — corriger une
 * IMPUTATION ne change pas ce que la pièce dit. Un montant faux n'est pas une
 * erreur d'imputation, c'est une pièce à relire, et le motif n'est pas le même.
 */
/** Un seul identifiant : la liste du plan est rendue une fois pour l'écran. */
const LISTE_DES_COMPTES = "plan-du-cabinet";

interface Correction {
  libelle: string;
  lignes: Array<{
    ordinal: number;
    compte: string;
    libelleDOrigine: string;
    debit: string;
    credit: string;
    taxCode: string | null;
  }>;
}

/** Le libellé que le plan donne à ce compte — officiel, extension, ou du cabinet. */
function libelleDuCompte(plan: readonly CompteDuPlan[], code: string): string | null {
  const propre = code.trim();
  if (!propre) return null;
  return plan.find((c) => c.code === propre)?.libelle ?? null;
}

/**
 * La correction part de l'écriture telle qu'elle est : on force, on ne
 * recommence pas. Le libellé, lui, part de ce que Malica propose — l'expert
 * arrête le paramétrage, il ne le compose pas de zéro (R10). À défaut de
 * lecture exploitable, on garde celui qui est en base plutôt que rien.
 */
function correctionDepuis(ecriture: Ecriture, libellePropose: string | null): Correction {
  return {
    libelle: libellePropose ?? ecriture.libelle,
    lignes: ecriture.lines.map((l) => ({
      ordinal: l.ordinal,
      compte: l.accountCode,
      libelleDOrigine: l.libelle,
      debit: l.debit,
      credit: l.credit,
      taxCode: l.taxCode,
    })),
  };
}

function CabinetReview() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const [zoom, setZoom] = useState<Citation | null>(null);
  const [motifId, setMotifId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"valide" | "retourne" | "corrige" | null>(null);
  // Le motif d'un refus. Exige par la base, et exige ici : un refus sans
  // motif n'apprend rien a celui qui a demande.
  const [noteDeRefus, setNoteDeRefus] = useState<string>("");
  // Dans la coque native il n'y a pas de dossier de téléchargements qu'on
  // puisse ouvrir : on dit OÙ le fichier a été écrit. Un bouton qui semble ne
  // rien faire est pire que pas de bouton.
  const [cheminEnregistre, setCheminEnregistre] = useState<string | null>(null);
  // `null` : on n'a pas ouvert la correction. Une fois ouverte, on tient la
  // saisie à part de l'écriture d'origine — celle-ci ne se modifie jamais.
  const [correction, setCorrection] = useState<Correction | null>(null);

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

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
  const file = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const rangDansLaFile = (file.data ?? []).findIndex((r) => r.pieceId === pieceId);
  const dansLaFile = rangDansLaFile >= 0 ? ((file.data ?? [])[rangDansLaFile] ?? null) : null;
  // Ce que le client attend sur cette piece, s'il attend quelque chose. La
  // file le porte deja : pas de seconde requete pour une valeur en main.
  const demandeEnAttente = dansLaFile?.demandeEnAttente ?? null;
  const precedente = rangDansLaFile > 0 ? ((file.data ?? [])[rangDansLaFile - 1] ?? null) : null;
  const suivante = rangDansLaFile >= 0 ? ((file.data ?? [])[rangDansLaFile + 1] ?? null) : null;
  const allerA = (id: string) =>
    void navigate({ to: "/cabinet/piece/$pieceId", params: { pieceId: id } });

  const plan = useQuery({
    queryKey: ["plan-cabinet", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
    staleTime: 5 * 60 * 1000,
  });

  useMalicaPanel(<MalicaNote>{t("cab.malica.review")}</MalicaNote>, [locale]);

  const selectedMotif = useMemo(
    () => (motifs.data ?? []).find((m) => m.id === motifId) ?? null,
    [motifs.data, motifId],
  );

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
      const octets = dossier.data?.contenu;
      if (!octets) return null;
      const payload = dossier.data?.extraction?.payload as
        { references?: Record<string, string> } | undefined;
      const ref = payload?.references
        ? Object.values(payload.references).find((v) => v && v.trim().length > 0)
        : null;
      const { enregistrerUnFichier } = await import("@/capabilities/enregistrer-un-fichier");
      const { chemin } = await enregistrerUnFichier(octets, `${ref ?? pieceId}.pdf`);
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
      if (!d.contenu) return null;
      const { enregistrerUnFichier } = await import("@/capabilities/enregistrer-un-fichier");
      const nom = nomDuType(d.piece.documentKind) ?? jointId;
      const { chemin } = await enregistrerUnFichier(d.contenu, `${nom}.pdf`);
      return chemin;
    },
    onSuccess: (chemin) => setCheminEnregistre(chemin),
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  const repondre = useMutation({
    mutationFn: ({ accorde }: { accorde: boolean }) =>
      office().collab.repondreSurPiece(
        pieceId,
        demandeEnAttente!,
        accorde,
        accorde ? null : noteDeRefus.trim(),
      ),
    onSuccess: async () => {
      setNoteDeRefus("");
      await qc.invalidateQueries();
    },
  });

  const review = useMutation({
    mutationFn: (outcome: "valide" | "retourne") =>
      office().supervision.review({
        ecritureId: booked!.id,
        outcome,
        motifId: outcome === "retourne" ? motifId : null,
        note: note.trim() ? note.trim() : null,
      }),
    onSuccess: async (_data, outcome) => {
      setError(null);
      setDone(outcome);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece-audit", pieceId] }),
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
      ]);
    },
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  /**
   * Forcer l'imputation.
   *
   * Une écriture comptabilisée ne se modifie pas — c'est le fondement de la
   * piste d'audit, et la base le refuserait. On fait donc ce que fait un
   * cabinet sur papier depuis toujours : contre-passer, puis réimputer.
   *
   * Trois écritures subsistent — l'erreur, son annulation, la correction —
   * et c'est exactement ce qu'un contrôleur doit pouvoir lire. Le motif
   * gouverné (« imputation à revoir ») dit pourquoi, et la note pourquoi
   * précisément : la base exige les deux.
   */
  const corriger = useMutation({
    mutationFn: async () => {
      if (!booked || !correction) throw new Error(t("cab.review.correct.nothing"));
      const lignes = correction.lignes.map((l) => ({
        account_code: l.compte.trim(),
        libelle: libelleDuCompte(plan.data ?? [], l.compte) ?? l.libelleDOrigine,
        debit: l.debit,
        credit: l.credit,
        tax_code: l.taxCode,
      }));

      // 1. La contre-passation, gouvernée. Elle porte le motif et la note.
      await office().supervision.review({
        ecritureId: booked.id,
        outcome: "retourne",
        motifId,
        note: note.trim() ? note.trim() : null,
      });

      // 2. L'écriture corrigée, sous LE MÊME pack que celle qu'elle remplace.
      const id = await office().office.propose({
        pieceId,
        journal: booked.journal,
        date: booked.dateEcriture,
        libelle: correction.libelle.trim(),
        packVersionId: booked.packVersionId,
        devise: booked.devise,
        lignes,
      });
      await office().office.book(id);
    },
    onSuccess: async () => {
      setError(null);
      setDone("corrige");
      setCorrection(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece-audit", pieceId] }),
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
      ]);
    },
    onError: (e: unknown) =>
      setError(
        texteDeLErreur(e, "routes/_authenticated/cabinet.piece.$pieceId", t("common.error")),
      ),
  });

  if (dossier.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!dossier.data) return <EmptyState>{t("cab.review.nodoc")}</EmptyState>;

  const { piece, contenu, extraction, citations } = dossier.data;

  /*
   * ============================ UNE CITATION PAR ZONE DE LA PIÈCE, PAS PAR CHAMP
   *
   * 11 octobre 2026 : « dans la partie comptable supprime ceci pour alléger ».
   * La liste affichait « Ligne TVA 1 · Base HT 514,700 » puis « Base HT
   * 514,700 » puis de nouveau « Ligne TVA 1 · Base HT 514,700 ».
   *
   * Ce n'était pas un doublon : quand la facture n'imprime pas de tableau de
   * TVA, le Socle reconstruit une ligne unique depuis les totaux du pied, et
   * `citerAussi` pointe alors le MÊME jeton sous un second nom de champ. La
   * traçabilité l'exige — on doit savoir d'où vient chaque champ.
   *
   * Mais le comptable, lui, clique pour SITUER une valeur sur la pièce : deux
   * entrées qui mènent au même endroit ne lui apprennent rien et noient les
   * autres. On regroupe donc par zone — même page, même cadre — et les noms
   * de champs se lisent sur une ligne.
   *
   * Rien n'est perdu : chaque champ reste nommé, et le lien vers la pièce est
   * le même puisque c'est le même jeton.
   */
  const citationsGroupees = (() => {
    const parZone = new Map<string, (typeof citations)[number] & { champs: string[] }>();
    for (const c of citations) {
      const cle = `${c.page}|${c.bbox.x0}|${c.bbox.y0}|${c.bbox.x1}|${c.bbox.y1}`;
      const vu = parZone.get(cle);
      if (vu) {
        if (!vu.champs.includes(c.field)) vu.champs.push(c.field);
      } else {
        parZone.set(cle, { ...c, champs: [c.field] });
      }
    }
    return [...parZone.values()];
  })();
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
  const byField = new Map(citations.map((c) => [c.field, c]));
  const all = ecritures.data ?? [];
  const booked = all.find((e) => e.status === "booked") ?? null;
  const reversal = all.find((e) => e.libelle.startsWith("Contre-passation")) ?? null;

  const noteMissing = Boolean(selectedMotif?.requiresNote) && note.trim().length === 0;

  // Les remarques ne bloquent pas : l'expert reste maître de ce qu'il écrit,
  // mais il voit ce qu'un contrôleur verra. Un refus se contourne en tapant
  // n'importe quoi ; une remarque, non.
  const remarques = correction ? critiquerLibelle(correction.libelle) : [];
  // Le libellé que Malica propose pour cette pièce, s'il est composable.
  // Une lecture partielle ne compose rien : on ne devine pas une contrepartie.
  const libellePropose = (() => {
    const lu = ExtractV1.safeParse(dossier.data?.extraction?.payload);
    return lu.success ? composerLibelle(faitsDuLibelle(lu.data)) : null;
  })();
  const compteVide = correction?.lignes.some((l) => !l.compte.trim()) ?? false;
  const correctionPrete = Boolean(correction && motifId && !noteMissing && !compteVide);
  // Une date d'écriture, dans la langue de la personne — jamais l'ISO brut de la base.
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
        <Link
          to="/cabinet"
          aria-label={t("cab.review.back")}
          title={t("cab.review.back")}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center border border-border bg-card hover:bg-accent"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.review.ref")}
            {rangDansLaFile >= 0 ? (
              <>
                {" · "}
                <span className="num">
                  {t("cab.review.rank", { n: rangDansLaFile + 1, total: (file.data ?? []).length })}
                </span>
              </>
            ) : null}
          </p>
          <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {dansLaFile?.clientName ?? t("cab.review.title")}
            {dansLaFile?.libelle ? (
              <span className="text-text-2"> — {dansLaFile.libelle}</span>
            ) : null}
          </h1>
        </div>
        <SignalLight
          tone={toneForStatus(piece.status)}
          label={t(`pme.status.${piece.status}` as MessageKey)}
        />
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => precedente && allerA(precedente.pieceId)}
            disabled={!precedente}
            aria-label={t("cab.review.prev")}
            title={t("cab.review.prev")}
            className="flex h-[34px] w-[34px] items-center justify-center border border-border bg-card hover:bg-accent disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => suivante && allerA(suivante.pieceId)}
            disabled={!suivante}
            aria-label={t("cab.review.next")}
            title={t("cab.review.next")}
            className="flex h-[34px] w-[34px] items-center justify-center border border-border bg-card hover:bg-accent disabled:opacity-40"
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
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[1.15fr_1fr]">
        <section className="min-w-0 space-y-3">
          <SectionTitle>{t("cab.review.document")}</SectionTitle>
          {contenu ? (
            <>
              <DocumentView contenu={contenu} highlight={zoom} label={t("cab.review.document")} />
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
               * ===================================== CE QUI ACCOMPAGNE LA PIÈCE
               *
               * Le reçu de paiement, les talons de chèque. Ils sont transmis
               * avec la facture et étaient introuvables depuis elle : le lien
               * existait en base, aucun écran ne le suivait.
               */}
              {(joints.data ?? []).length > 0 ? (
                <>
                  <SectionTitle>{t("cab.review.joints")}</SectionTitle>
                  <ul className="grid gap-px border border-border bg-border">
                    {(joints.data ?? []).map((j) => (
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
                        <span className="truncate text-[13px]">
                          {nomDuType(j.documentKind) ?? t("cab.review.document")}
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
              <SectionTitle>{t("pme.extract.articles")}</SectionTitle>
              <InkTable
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
                    <InkCell numeric>
                      {article.quantity ? quantite(article.quantity, locale) : "—"}
                    </InkCell>
                    <InkCell numeric>
                      {article.unit_price_ht ? montant(article.unit_price_ht, locale) : "—"}
                    </InkCell>
                    <InkCell numeric>
                      {article.unit_price_ttc ? montant(article.unit_price_ttc, locale) : "—"}
                    </InkCell>
                    <InkCell numeric>
                      {article.total_ht ? montant(article.total_ht, locale) : "—"}
                    </InkCell>
                  </InkTableRow>
                ))}
              </InkTable>
            </>
          ) : null}

          <SectionTitle
            action={
              <span className="text-[11px] text-muted-foreground">
                {t("cab.review.citations.hint")}
              </span>
            }
          >
            {t("cab.review.citations")}
          </SectionTitle>
          {citations.length === 0 ? (
            <EmptyState>{t("pme.read.none")}</EmptyState>
          ) : (
            <ul className="grid gap-px border border-border bg-border">
              {citationsGroupees.map((citation) => (
                <li key={`${citation.field}-${citation.page}`} className="bg-card">
                  <button
                    type="button"
                    onClick={() => setZoom(citation)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-start hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] text-muted-foreground">
                        {citation.champs.map((c) => libelleDuChamp(c, t)).join(" · ")}
                      </span>
                      <span className="num block truncate text-[12.5px]">
                        {(() => {
                          const v = valeurDuChamp(extraction?.payload, citation.field);
                          return v ? valeurLisible(citation.field, v, locale) : "—";
                        })()}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {citation.zone ?? t("cab.review.pages", { n: citation.page })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {extraction && extraction.flags.length > 0 ? (
            <div className="border border-s-2 border-border border-s-signal-warn bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-warn">
                {t("pme.read.flags")}
              </p>
              {/*
               * Les signalements se disent UNE FOIS par cause.
               *
               * La capture du 11 octobre montrait cinq lignes « Article n ·
               * PU TTC — Signalement de lecture. », rigoureusement
               * identiques. Cinq fois la même cause, sur cinq champs : c'est
               * une information, pas cinq.
               */}
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
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <SectionTitle>{t("cab.review.ecriture")}</SectionTitle>
          {!booked ? (
            <EmptyState>{t("cab.review.noecriture")}</EmptyState>
          ) : (
            <>
              <p className="num text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("cab.review.ecriture.meta", {
                  journal: booked.journal,
                  date: jour(booked.dateEcriture),
                  devise: booked.devise,
                })}
              </p>
              <InkTable
                caption={t("cab.review.ecriture")}
                head={[t("pme.journal.account"), t("pme.journal.debit"), t("pme.journal.credit")]}
              >
                {booked.lines.map((line) => (
                  <InkTableRow key={line.ordinal}>
                    <InkCell>
                      <span className="num">{line.accountCode}</span>{" "}
                      <span className="text-muted-foreground">{line.libelle}</span>
                    </InkCell>
                    <InkCell numeric>{montant(line.debit, locale)}</InkCell>
                    <InkCell numeric>{montant(line.credit, locale)}</InkCell>
                  </InkTableRow>
                ))}
              </InkTable>

              {!done && correction ? (
                <div className="space-y-3 border border-s-2 border-border border-s-signal-warn bg-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-signal-warn">
                    {t("cab.review.correct.title")}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {t("cab.review.correct.lede")}
                  </p>

                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("cab.review.correct.libelle")}
                    </span>
                    <input
                      type="text"
                      value={correction.libelle}
                      onChange={(e) =>
                        setCorrection((c) => (c ? { ...c, libelle: e.target.value } : c))
                      }
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[13px]"
                    />
                  </label>
                  {remarques.length > 0 ? (
                    <ul className="space-y-0.5 text-[11px] text-signal-warn">
                      {remarques.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}

                  <ListeDesComptes id={LISTE_DES_COMPTES} plan={plan.data ?? []} />
                  <InkTable
                    caption={t("cab.review.correct.title")}
                    head={[
                      t("pme.journal.account"),
                      t("pme.journal.debit"),
                      t("pme.journal.credit"),
                    ]}
                  >
                    {correction.lignes.map((ligne, index) => (
                      <InkTableRow key={ligne.ordinal}>
                        <InkCell>
                          <SaisieDeCompte
                            valeur={ligne.compte}
                            onChange={(code) =>
                              setCorrection((c) =>
                                c
                                  ? {
                                      ...c,
                                      lignes: c.lignes.map((l, i) =>
                                        i === index ? { ...l, compte: code } : l,
                                      ),
                                    }
                                  : c,
                              )
                            }
                            plan={plan.data ?? []}
                            label={t("pme.journal.account")}
                            inconnuLabel={t("cab.review.correct.unknown")}
                            listeId={LISTE_DES_COMPTES}
                            collectifLabel={t("plan.collectif.court")}
                            originesLabels={{
                              officiel: t("plan.origin.officiel"),
                              extension: t("plan.origin.extension"),
                              cabinet: t("plan.origin.cabinet"),
                            }}
                          />
                        </InkCell>
                        <InkCell numeric>{ligne.debit}</InkCell>
                        <InkCell numeric>{ligne.credit}</InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>

                  <p className="text-[11px] text-muted-foreground">
                    {t("cab.review.correct.motif.needed")}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      variant="ink"
                      disabled={!correctionPrete || corriger.isPending}
                      onClick={() => corriger.mutate()}
                    >
                      {corriger.isPending ? t("common.loading") : t("cab.review.correct.apply")}
                    </ActionButton>
                    <ActionButton disabled={corriger.isPending} onClick={() => setCorrection(null)}>
                      {t("cab.review.correct.cancel")}
                    </ActionButton>
                  </div>
                </div>
              ) : null}

              {reversal ? (
                <div className="border border-s-2 border-border border-s-signal-stop bg-card p-3 text-[12px]">
                  <p className="font-medium">{reversal.libelle}</p>
                  <p className="num mt-1 text-muted-foreground">{jour(reversal.dateEcriture)}</p>
                </div>
              ) : null}

              {done ? (
                <p className="border border-border bg-card px-3 py-3 text-[13px]">
                  {done === "valide"
                    ? t("cab.review.done.valide")
                    : done === "corrige"
                      ? t("cab.review.done.corrige")
                      : t("cab.review.done.retourne")}
                </p>
              ) : (
                <div className="space-y-3 border border-border bg-card p-3">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("cab.review.motif")}
                    </span>
                    <select
                      value={motifId}
                      onChange={(e) => setMotifId(e.target.value)}
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[13px]"
                    >
                      <option value="">{t("cab.review.motif.choose")}</option>
                      {(motifs.data ?? []).map((motif) => (
                        <option key={motif.id} value={motif.id}>
                          {motif.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("cab.review.note")}
                    </span>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[13px]"
                    />
                  </label>

                  {noteMissing ? (
                    <p className="text-[11px] text-signal-warn">{t("cab.review.note.required")}</p>
                  ) : null}

                  <StickyActions>
                    <ActionButton
                      variant="ink"
                      disabled={review.isPending}
                      onClick={() => review.mutate("valide")}
                    >
                      {t("cab.review.validate")}
                    </ActionButton>
                    <ActionButton
                      disabled={review.isPending || !motifId || noteMissing}
                      onClick={() => review.mutate("retourne")}
                    >
                      {t("cab.review.return")}
                    </ActionButton>
                    {correction ? null : (
                      <ActionButton
                        disabled={review.isPending}
                        onClick={() => setCorrection(correctionDepuis(booked, libellePropose))}
                      >
                        {t("cab.review.correct.open")}
                      </ActionButton>
                    )}
                  </StickyActions>
                </div>
              )}
            </>
          )}

          <SectionTitle>{t("cab.review.audit")}</SectionTitle>
          {(audit.data ?? []).length === 0 ? (
            <EmptyState>{t("cab.review.audit.empty")}</EmptyState>
          ) : (
            <ul className="grid gap-px border border-border bg-border text-[12px]">
              {(audit.data ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-3 bg-card px-3 py-2"
                >
                  <span>{libelleDeLAction(entry.action, t)}</span>
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
