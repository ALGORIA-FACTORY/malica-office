/**
 * Le cours de change d'une pièce en devise, côté cabinet (31 octobre 2026).
 *
 * Une facture en euros d'un dossier tenu en dinars ne se proposait plus,
 * faute de cours. Le cours est une donnée : importé par l'exploitation, ou
 * saisi ici par le cabinet qui supervise le dossier, en un geste depuis la
 * pièce. Le Socle rejuge aussitôt et propose l'écriture convertie.
 *
 * Deux états, un seul formulaire :
 *   — le cours manque : « Taux EUR/TND du 10/09/2026 à saisir » et le geste ;
 *   — le cours s'applique : ce qu'il vaut, sa source, sa date, et « Corriger
 *     le taux » (une correction s'ajoute, rien n'est effacé — R7).
 * Les explications sont dans le i, jamais dans la carte.
 *
 * Revue de #148 : le cours officiel importé passe devant un cours saisi. Pour
 * passer devant lui, ou pour corriger un cours, le cabinet DÉROGE : un motif,
 * et pour qui — ce dossier ou tout le cabinet. Corriger exige le motif.
 */
import type {
  CoursASaisir,
  DerogationDeCours,
  PropositionDePiece,
} from "@malica/socle/ports/repositories";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Aide } from "@/components/malica/aide";
import { useI18n } from "@/i18n";
import { coursSaisi } from "@/lib/cours-saisi";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnChiffres, montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/cours-de-change";

/** Un cours saisi, et la dérogation qu'il porte, s'il en porte une. */
export interface CoursAEnregistrer {
  taux: string;
  unite: number;
  derogation: DerogationDeCours | null;
}

/**
 * Le formulaire d'un cours : le taux, pour une unité de la devise, et le
 * motif d'une dérogation. Un geste. `portees` : pour qui une dérogation peut
 * valoir ici (ce dossier n'existe que depuis une pièce) ; `motifExige` : une
 * correction dit toujours pourquoi.
 */
export function FormulaireDuCours({
  devise,
  vers,
  enCours,
  portees,
  motifExige = false,
  onEnregistrer,
}: {
  devise: string;
  vers: string;
  enCours: boolean;
  portees: ReadonlyArray<DerogationDeCours["portee"]>;
  motifExige?: boolean;
  onEnregistrer: (c: CoursAEnregistrer) => void;
}) {
  const { t } = useI18n();
  const [taux, setTaux] = useState("");
  const [unite, setUnite] = useState("1");
  const [motif, setMotif] = useState("");
  const [portee, setPortee] = useState<DerogationDeCours["portee"]>(portees[0] ?? "cabinet");
  const cours = coursSaisi(taux, unite);
  const motifEcrit = motif.trim();
  const pret = cours !== null && (!motifExige || motifEcrit.length > 0);
  return (
    <form
      className="grid grid-cols-2 gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (cours && pret)
          onEnregistrer({
            ...cours,
            derogation: motifEcrit ? { motif: motifEcrit, portee } : null,
          });
      }}
    >
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
        {t("cab.cours.taux", { vers, unite: unite.trim() || "1", devise })}
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          required
          value={taux}
          onChange={(e) => setTaux(e.target.value)}
          className="num h-[48px] border border-border bg-background px-2 text-end text-[14px] font-normal text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
        {t("cab.cours.unite", { devise })}
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          required
          value={unite}
          onChange={(e) => setUnite(e.target.value)}
          className="num h-[48px] border border-border bg-background px-2 text-end text-[14px] font-normal text-foreground"
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
        {motifExige ? t("cab.cours.motif.exige") : t("cab.cours.motif")}
        <input
          type="text"
          dir="auto"
          required={motifExige}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          className="h-[48px] border border-border bg-background px-2 text-[14px] font-normal text-foreground"
        />
      </label>
      {motifEcrit && portees.length > 1 ? (
        <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          {t("cab.cours.portee")}
          <select
            value={portee}
            onChange={(e) => setPortee(e.target.value as DerogationDeCours["portee"])}
            className="h-[48px] border border-border bg-background px-2 text-[14px] font-normal text-foreground"
          >
            {portees.map((p) => (
              <option key={p} value={p}>
                {p === "dossier"
                  ? t("tva.affectation.pourLeDossier")
                  : t("tva.affectation.pourLeCabinet")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="submit"
        disabled={enCours || !pret}
        className="col-span-2 min-h-[48px] border border-foreground bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        {enCours ? t("common.loading") : t("cab.cours.enregistrer")}
      </button>
    </form>
  );
}

/**
 * Le cours de la pièce : à saisir, ou appliqué et corrigeable. Rien quand la
 * pièce est dans la devise du dossier.
 */
export function CoursDeLaPiece({
  pieceId,
  proposition,
  onRejugee,
}: {
  pieceId: string;
  proposition: PropositionDePiece | undefined;
  /** Le Socle a rejugé la pièce : l'écran relit ce qui en dépend. */
  onRejugee: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const [corriger, setCorriger] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const saisir = useMutation({
    mutationFn: (c: CoursAEnregistrer) =>
      office().office.saisirLeCoursDeLaPiece(pieceId, c.taux, c.unite, c.derogation),
    onMutate: () => setErreur(null),
    onSuccess: async () => {
      setCorriger(false);
      await onRejugee();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const aSaisir: CoursASaisir | null =
    proposition && !proposition.ok && proposition.raisonCode === "taux_de_change"
      ? (proposition.coursASaisir ?? null)
      : null;
  const applique = proposition?.ok ? (proposition.proposition.conversion ?? null) : null;
  if (!aSaisir && !applique) return null;

  const devise = aSaisir?.devise ?? applique!.devise_origine;
  const vers = aSaisir?.versDevise ?? applique!.devise;
  const source = aSaisir?.source ?? applique!.cours.source;
  const aide = (
    <Aide
      titre={t("cab.cours.titre")}
      paragraphes={[
        { texte: t("cab.cours.aide.pourquoi", { devise, vers, source }) },
        { texte: t("cab.cours.aide.regle") },
        { texte: t("cab.cours.aide.trace") },
        // La raison du Socle, telle qu'il l'a posée.
        ...(proposition && !proposition.ok ? [{ texte: proposition.raison }] : []),
      ]}
    />
  );

  return (
    <div
      className={
        aSaisir
          ? "space-y-2.5 border border-signal-warn bg-card px-3.5 py-3"
          : "space-y-2.5 border border-border bg-card px-3.5 py-3"
      }
    >
      {aSaisir ? (
        <p id="cours-a-saisir" className="flex items-center text-[14px] font-semibold">
          {t("cab.cours.a_saisir", {
            devise,
            vers,
            jour: dateEnChiffres(aSaisir.jour, locale),
          })}
          {aide}
        </p>
      ) : (
        <div className="grid grid-cols-2 items-center gap-2.5">
          <p className="num flex items-center text-[13px]" dir="auto">
            {t("cab.cours.applique", {
              unite: String(applique!.cours.unite),
              devise,
              taux: montant(applique!.cours.taux, locale),
              vers,
              source,
              date: dateEnChiffres(applique!.cours.date, locale),
            })}
            {aide}
          </p>
          <button
            type="button"
            onClick={() => setCorriger((c) => !c)}
            className="min-h-[48px] border border-border bg-card px-4 text-[14px] font-semibold hover:bg-accent"
          >
            {t("cab.cours.corriger")}
          </button>
        </div>
      )}
      {aSaisir || corriger ? (
        <FormulaireDuCours
          devise={devise}
          vers={vers}
          enCours={saisir.isPending}
          portees={["dossier", "cabinet"]}
          // Un cours appliqué se corrige : la correction dit pourquoi.
          motifExige={!aSaisir}
          onEnregistrer={(c) => saisir.mutate(c)}
        />
      ) : null}
      <Link
        to="/cabinet/cours"
        className="inline-flex text-[12.5px] font-semibold underline-offset-4 hover:underline"
      >
        {t("cab.cours.tous")}
      </Link>
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
