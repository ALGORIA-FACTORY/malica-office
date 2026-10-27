/**
 * Une pièce transmise, lue, que le client n'a pas confirmée : le cabinet
 * décide (maquette « Retours du cabinet et pièces à confirmer », validée le
 * 25 octobre 2026).
 *
 * Avant, l'écran du cabinet montrait l'écriture proposée et aucun geste :
 * « Valider » et « Retourner » n'existaient que sur une écriture inscrite.
 * Une pièce lue sans le « Oui » du client restait donc sans issue des deux
 * côtés. Trois gestes, un principal :
 *
 *   - inscrire l'écriture proposée — le serveur la recalcule, rien ne part
 *     d'ici, et inscrire vaut confirmation par le cabinet ;
 *   - demander au client de confirmer — une notification, rien de plus ;
 *   - retourner au client — un motif du référentiel, qui dit au client quel
 *     geste faire, et la note, qui dit comment.
 */
import type { RejetMotif } from "@malica/socle/ports/repositories";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ConfirmationSurPlace,
  PasEncoreParti,
  type RetourEnvoye,
} from "@/components/malica/envoye";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { momentDeLEnvoi } from "@/lib/lisible";
import { LIBELLE_DU_GESTE } from "@/lib/retour-du-cabinet";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/decision-sans-confirmation";

export function DecisionSansConfirmation({
  pieceId,
  titre,
  comptes,
  inscriptible,
  motifs,
  client,
  onRetournee,
}: {
  pieceId: string;
  /** « ÉMETTEUR · montant devise », tel que lu. */
  titre: string;
  /** Les comptes de l'écriture proposée, dans l'ordre : « 601 · 4366 · 401 ». */
  comptes: string | null;
  /** Le Socle propose une écriture : sinon « Inscrire » n'a rien à inscrire. */
  inscriptible: boolean;
  motifs: readonly RejetMotif[];
  /** Le client, tel que la file le nomme ; `null` : « le client ». */
  client: string | null;
  /**
   * Le retour est parti. Le panneau « Retournée au client » vit sur la page :
   * relue, la pièce n'est plus « lue sans confirmation » et ce composant
   * disparaît — le panneau, lui, doit rester.
   */
  onRetournee: (r: RetourEnvoye) => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  /** Ce qui est parti, et quand — écrit après la réponse du serveur. */
  const [fait, setFait] = useState<{ quoi: "relance"; le: string } | null>(null);
  const nomDuClient = client ?? t("envoi.cab.client");
  const [feuille, setFeuille] = useState(false);

  const relire = () => qc.invalidateQueries();
  const echec = (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error")));

  const inscrire = useMutation({
    // Le type lu se confirme au nom du cabinet, puis le serveur propose et
    // inscrit : un seul appel, une transaction.
    mutationFn: () => office().office.inscrireLaPieceDuClient(pieceId),
    onMutate: () => setErreur(null),
    onSuccess: relire,
    onError: echec,
  });
  const relancer = useMutation({
    mutationFn: () => office().supervision.demanderConfirmation(pieceId),
    onMutate: () => setErreur(null),
    onSuccess: async () => {
      setFait({ quoi: "relance", le: new Date().toISOString() });
      await relire();
    },
    // « Pas encore parti » se dit sur place ; une panne reste au journal.
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, "") || null),
  });

  const occupe = inscrire.isPending || relancer.isPending;

  return (
    <section className="space-y-4" aria-labelledby="decision-sans-confirmation">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-2 border border-s-[3px] border-border border-s-signal-warn bg-card px-3 py-1 text-[12px] font-semibold">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-signal-warn" />
          {t("cab.lue.etat")}
        </span>
        <h2
          id="decision-sans-confirmation"
          className="text-[22px] font-semibold leading-tight tracking-[-0.02em]"
        >
          {titre}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t("cab.lue.lede")}</p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={!inscriptible || occupe}
          onClick={() => inscrire.mutate()}
          className="flex min-h-[52px] w-full items-center justify-between gap-3 border border-foreground bg-foreground px-5 text-[14px] font-semibold text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          <span>{inscrire.isPending ? t("common.loading") : t("cab.lue.inscrire")}</span>
          {comptes ? (
            <span className="num text-[12px] font-medium opacity-70">{comptes}</span>
          ) : null}
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={occupe || fait?.quoi === "relance"}
            onClick={() => relancer.mutate()}
            className="min-h-[48px] border border-border bg-card px-4 text-[13.5px] font-semibold hover:bg-accent disabled:opacity-50"
          >
            {relancer.isPending ? t("common.loading") : t("cab.lue.relancer")}
          </button>
          <button
            type="button"
            disabled={occupe}
            onClick={() => setFeuille(true)}
            className="min-h-[48px] border border-border bg-card px-4 text-[13.5px] font-semibold hover:bg-accent disabled:opacity-50"
          >
            {t("cab.lue.retourner")}
          </button>
        </div>
        {fait?.quoi === "relance" ? (
          <ConfirmationSurPlace
            titre={t("envoi.relance.fait", { client: nomDuClient })}
            detail={t("envoi.relance.detail", { quand: momentDeLEnvoi(fait.le, locale).quand })}
          />
        ) : relancer.isError ? (
          <PasEncoreParti
            qui={nomDuClient}
            reessayer={() => relancer.mutate()}
            enCours={relancer.isPending}
          />
        ) : null}
        {erreur ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </p>
        ) : null}
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("cab.lue.aide")}</p>
      </div>

      {feuille ? (
        <RetournerAuClient
          pieceId={pieceId}
          motifs={motifs}
          onFermer={() => setFeuille(false)}
          onRetournee={async (r) => {
            setFeuille(false);
            onRetournee({ ...r, le: new Date().toISOString() });
            await relire();
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * La feuille « Retourner au client », sur le côté.
 *
 * L'aperçu montre ce que le client lira, mot pour mot : le motif, la note
 * entre guillemets, et le geste qu'on lui demandera. Rien n'y est inventé :
 * le geste vient du référentiel, comme sur la fiche du client.
 */
function RetournerAuClient({
  pieceId,
  motifs,
  onFermer,
  onRetournee,
}: {
  pieceId: string;
  motifs: readonly RejetMotif[];
  onFermer: () => void;
  onRetournee: (r: { motif: string; note: string | null }) => Promise<void>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [motifId, setMotifId] = useState<string>(motifs[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const fermer = useCallback(() => onFermer(), [onFermer]);
  useSuperposition(true, fermer, ref);

  const motif = motifs.find((m) => m.id === motifId) ?? null;
  const noteManquante = Boolean(motif?.requiresNote) && note.trim().length === 0;

  const retourner = useMutation({
    mutationFn: () =>
      office().supervision.retourner({
        pieceId,
        motifId,
        note: note.trim() ? note.trim() : null,
      }),
    onMutate: () => setErreur(null),
    onSuccess: () =>
      onRetournee({ motif: motif?.label ?? "", note: note.trim() ? note.trim() : null }),
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-foreground/35"
      onClick={(e) => {
        if (e.target === e.currentTarget) fermer();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("cab.retour.titre")}
        className="flex h-full w-full max-w-[560px] flex-col gap-4 overflow-y-auto bg-background px-6 py-7 text-start sm:px-8"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[22px] font-semibold tracking-[-0.02em]">{t("cab.retour.titre")}</p>
          <button
            type="button"
            onClick={fermer}
            aria-label={t("common.fermer")}
            className="flex h-9 w-9 items-center justify-center border border-border bg-card hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          {t("cab.retour.lede")}
        </p>

        <fieldset className="space-y-2">
          <legend className="text-[12.5px] font-semibold">{t("cab.retour.motif")}</legend>
          <div className="flex flex-wrap gap-2">
            {motifs.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === motifId}
                onClick={() => setMotifId(m.id)}
                className={
                  m.id === motifId
                    ? "min-h-[38px] rounded-full border border-foreground bg-foreground px-3.5 text-[13px] font-semibold text-background"
                    : "min-h-[38px] rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:bg-accent"
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold">
          <span>
            {t("cab.retour.note")}{" "}
            <span
              className={
                motif?.requiresNote
                  ? "font-medium text-signal-stop"
                  : "font-medium text-muted-foreground"
              }
            >
              {motif?.requiresNote
                ? t("cab.retour.note.obligatoire")
                : t("cab.retour.note.facultative")}
            </span>
          </span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteManquante || undefined}
            className="resize-none border border-border bg-background px-3 py-2.5 text-[14px] font-normal"
          />
        </label>

        {motif ? (
          <>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("cab.retour.apercu")}
            </p>
            <div className="flex flex-col gap-2 rounded-2xl bg-foreground p-4 text-background">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-signal-info" />
                {t("pme.retour.etat.court")}
              </span>
              <b className="text-[16px]">{motif.label}</b>
              {note.trim() ? (
                <span className="text-[13px] leading-snug opacity-80">« {note.trim()} »</span>
              ) : null}
              <span className="mt-1 inline-flex h-9 items-center self-start rounded-full bg-background px-3.5 text-[13px] font-semibold text-foreground">
                {t(LIBELLE_DU_GESTE[motif.geste])}
              </span>
            </div>
          </>
        ) : null}

        {erreur ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!motif || noteManquante || retourner.isPending}
          onClick={() => retourner.mutate()}
          className="mt-auto min-h-[52px] border border-foreground bg-foreground text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          {retourner.isPending ? t("common.loading") : t("cab.retour.envoyer")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
