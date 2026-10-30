/**
 * L'écriture d'une pièce, côté comptable (« Malica sans blocage », maquette
 * « Pièce côté comptabilité », validée le 28 octobre 2026).
 *
 * Le défaut qui l'a fait naître, relevé sur staging le 29 octobre : sur une
 * pièce au montant illisible, l'écran disait « Lue — le client n'a pas
 * confirmé », éteignait « Inscrire » (le Socle ne proposait rien) et
 * proposait de « Demander au client de confirmer ». Le comptable ne pouvait
 * rien faire. Le client ne confirme plus rien ; rien ne bloque.
 *
 * Une table, toujours modifiable — l'écriture prise en charge, sinon la
 * proposition du Socle, sinon des lignes à saisir. Deux gestes, côte à
 * côte : VALIDER (ou SAISIR l'écriture quand rien n'est proposé) et
 * RETOURNER au client. Validée telle que proposée : « validée » ; modifiée ou
 * saisie : « forcée », avec le nom et l'heure. Les explications sont dans le
 * i, jamais dans l'écran.
 */
import { controlerLaSaisie, type LigneSaisie } from "@malica/socle/ecriture-saisie";
import { critiquerLibelle } from "@malica/socle/engines/libelle";
import type {
  CompteDuPlan,
  Ecriture,
  PropositionDePiece,
  RejetMotif,
} from "@malica/socle/ports/repositories";
import type { StatutCabinet, SuiviDEnvoi } from "@malica/socle/statut-d-envoi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Aide } from "@/components/malica/aide";
import type { RetourEnvoye } from "@/components/malica/envoye";
import { RetournerAuClient } from "@/components/malica/retourner-au-client";
import { ListeDesComptes, SaisieDeCompte } from "@/components/malica/saisie-compte";
import { useI18n } from "@/i18n";
import {
  ecritureDeDepart,
  inchangee,
  LIGNE_VIDE,
  relue,
  type EcritureEnSaisie,
} from "@/lib/ecriture-du-cabinet";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { MOT_CABINET } from "@/lib/statut";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/ecriture-du-cabinet";
/** Une seule liste du plan pour l'écran. */
const LISTE_DES_COMPTES = "plan-de-l-ecriture";

/** Le libellé que le plan donne à ce compte — celui du cabinet d'abord. */
function libelleDuPlan(plan: readonly CompteDuPlan[], code: string): string | null {
  const comptes = plan.filter((c) => c.code === code.trim());
  return comptes.find((c) => c.origine === "cabinet")?.libelle ?? comptes[0]?.libelle ?? null;
}

export function EcritureDuCabinet({
  pieceId,
  clientId,
  statut,
  suivi,
  vivante,
  proposition,
  typeAEtablir,
  sens,
  dateLue,
  libellePropose,
  plan,
  decimales,
  motifs,
  codesDeTaxe,
  illisible,
  onRetournee,
}: {
  pieceId: string;
  /** Le dossier du client : le journal du jour s'ouvre sur lui. */
  clientId: string;
  statut: StatutCabinet;
  suivi: SuiviDEnvoi | null;
  /** L'écriture vivante de la pièce, inscrite ; `null` s'il n'y en a pas. */
  vivante: Ecriture | null;
  /** Ce que le Socle propose, ou pourquoi il ne propose rien ; absent sans lecture. */
  proposition: PropositionDePiece | undefined;
  /** Le type de la pièce ne porte pas d'écriture, ou manque : le comptable le choisit (R2). */
  typeAEtablir: boolean;
  /**
   * Le sens (achat ou vente) est à trancher par le comptable : la lecture ne
   * le dit pas ou se contredit. `lu` : le sens lu, s'il y en a un. `null`
   * quand rien n'est à trancher.
   */
  sens: { lu: string | null } | null;
  /** La date lue sur la pièce, pour une écriture saisie. */
  dateLue: string | null;
  /** Le libellé que Malica compose pour cette pièce, pour une écriture saisie. */
  libellePropose: string | null;
  plan: readonly CompteDuPlan[];
  /** Les décimales de la devise, du pack ; `null` tant qu'on ne les a pas (R4). */
  decimales: number | null;
  motifs: readonly RejetMotif[];
  /** Les codes de taxe du pack, en vigueur, traduits : le choix d'une ligne. */
  codesDeTaxe: ReadonlyArray<{ code: string; label: string }>;
  /**
   * L'écriture prise en charge ne se lit pas comme une facture : la PME
   * garde sa lecture tant que le comptable ne l'a pas reprise.
   */
  illisible: boolean;
  onRetournee: (r: RetourEnvoye) => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const depart = ecritureDeDepart(vivante, proposition);
  const [saisie, setSaisie] = useState<EcritureEnSaisie>(() =>
    depart.depart === "rien"
      ? {
          journal: "",
          date: dateLue ?? "",
          libelle: libellePropose ?? "",
          lignes: [LIGNE_VIDE, LIGNE_VIDE],
        }
      : depart,
  );
  const [type, setType] = useState("");
  const [feuille, setFeuille] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const journaux = useQuery({
    queryKey: ["journaux", locale],
    queryFn: () => office().referential.journaux(locale),
    staleTime: 60 * 60 * 1000,
  });
  const types = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    enabled: typeAEtablir || sens !== null,
    staleTime: 60 * 60 * 1000,
  });
  /*
   * Les deux sens sont les types qui portent une écriture, lus au
   * référentiel. Celui que la lecture a lu passe en premier — le geste
   * principal, à gauche ; l'autre, de même taille, le contredit.
   */
  const sensPossibles = (types.data ?? [])
    .filter((d) => d.porteEcriture)
    .sort((a, b) => Number(b.code === sens?.lu) - Number(a.code === sens?.lu));

  const lignes = saisie.lignes.map(relue);
  const controle = decimales === null ? null : controlerLaSaisie(lignes, decimales);
  const telleQuelle = decimales !== null && inchangee({ ...saisie, lignes }, depart, decimales);
  const prise = statut === "validee" || statut === "forcee";
  /** Ce qui manque avant d'inscrire, dit par la même phrase que le refus du serveur. */
  const manque: string | null =
    controle === null
      ? t("common.loading")
      : !saisie.journal
        ? t("refus.ecriture.journal")
        : !saisie.date
          ? t("cab.ecriture.date.manque")
          : !saisie.libelle.trim()
            ? t("cab.ecriture.libelle.manque")
            : typeAEtablir && !type
              ? t("refus.inscription.type_inconnu")
              : controle.defaut
                ? t(`refus.ecriture.${controle.defaut}`)
                : null;

  const relire = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
      qc.invalidateQueries({ queryKey: ["proposition", pieceId] }),
      qc.invalidateQueries({ queryKey: ["piece-audit", pieceId] }),
      qc.invalidateQueries({ queryKey: ["cab-queue"] }),
      qc.invalidateQueries({ queryKey: ["cab-clients"] }),
    ]);
  /*
   * Telle que proposée — ou telle qu'inscrite par le client, du temps où il
   * confirmait encore, et pas encore prise en charge : le serveur valide,
   * « validée ». Changée ou saisie : la saisie part, relue — « forcée ».
   */
  const validation =
    telleQuelle && (depart.depart === "proposee" || (depart.depart === "inscrite" && !prise));
  const inscrire = useMutation({
    mutationFn: () =>
      validation
        ? // L'empreinte de la proposition affichée : le serveur inscrit celle-là,
          // ou refuse si elle a changé depuis (`refus.proposition.changee`).
          office().office.valider(
            pieceId,
            depart.depart === "proposee" && proposition?.ok
              ? (proposition.empreinte ?? null)
              : null,
          )
        : office().office.forcer({
            pieceId,
            journal: saisie.journal,
            date: saisie.date,
            libelle: saisie.libelle.trim(),
            lignes,
            typeDeDocument: typeAEtablir ? type : null,
          }),
    onMutate: () => setErreur(null),
    onSuccess: relire,
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  // Trancher le sens : une précision datée à son nom, puis le Socle rejuge.
  const trancher = useMutation({
    mutationFn: (code: string) => office().office.trancherLeSens(pieceId, code),
    onMutate: () => setErreur(null),
    onSuccess: relire,
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const changerLigne = (index: number, patch: Partial<LigneSaisie>) =>
    setSaisie((s) => ({
      ...s,
      lignes: s.lignes.map((l, i) => {
        if (i !== index) return l;
        const suivante = { ...l, ...patch };
        // Le libellé suit le compte tant qu'il est celui du plan : il ne se
        // recopie pas à la main (`saisie-compte.tsx`).
        if (patch.account_code !== undefined) {
          const avant = libelleDuPlan(plan, l.account_code);
          if (!l.libelle.trim() || l.libelle === avant)
            suivante.libelle = libelleDuPlan(plan, patch.account_code) ?? "";
        }
        return suivante;
      }),
    }));

  const heure = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const remarques = critiquerLibelle(saisie.libelle);
  // Le bouton dit ce qui partira : la proposition telle quelle se valide ;
  // une ligne changée, c'est forcer — avec son nom.
  const principal =
    depart.depart === "rien"
      ? t("cab.ecriture.saisir")
      : validation
        ? t("cab.ecriture.valider")
        : t("cab.ecriture.forcer");

  return (
    <section className="space-y-3" aria-labelledby="ecriture-du-cabinet">
      {sens && proposition && !proposition.ok ? (
        <div className="space-y-2.5 border border-signal-warn bg-card px-3.5 py-3">
          <p id="sens-a-trancher" className="flex items-center text-[14px] font-semibold">
            {t("cab.sens.titre")}
            <Aide
              titre={t("cab.sens.titre")}
              paragraphes={[
                { texte: t("cab.sens.aide.pourquoi") },
                { texte: t("cab.sens.aide.trace") },
                { texte: t("cab.sens.aide.forcer") },
                // La raison du Socle, telle qu'il l'a posée.
                { texte: proposition.raison },
              ]}
            />
          </p>
          <div className="grid grid-cols-2 gap-2.5" role="group" aria-labelledby="sens-a-trancher">
            {sensPossibles.map((d, i) => (
              <button
                key={d.code}
                type="button"
                disabled={trancher.isPending || inscrire.isPending}
                onClick={() => trancher.mutate(d.code)}
                className={
                  i === 0
                    ? "min-h-[48px] border border-foreground bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
                    : "min-h-[48px] border border-border bg-card px-4 text-[14px] font-semibold hover:bg-accent disabled:opacity-50"
                }
              >
                {d.libelle}
              </button>
            ))}
          </div>
        </div>
      ) : depart.depart === "rien" && proposition && !proposition.ok ? (
        <p className="border border-signal-stop bg-card px-3.5 py-2.5 text-[13.5px] text-signal-stop">
          {t("cab.ecriture.rien")}
          <Aide
            titre={t("cab.ecriture.rien.pourquoi")}
            /*
             * La raison vient du serveur, en français, et porte les motifs des
             * contrôles : une seule phrase, construite là où le jugement est
             * posé. Elle va dans le i : l'écran dit un mot et un geste.
             */
            paragraphes={[{ texte: proposition.raison }]}
          />
        </p>
      ) : null}

      <h2
        id="ecriture-du-cabinet"
        className="flex items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
      >
        {t("cab.ecriture.titre")}
        <Aide
          titre={t("cab.ecriture.titre")}
          paragraphes={[
            { texte: t("cab.ecriture.aide.validee") },
            { texte: t("cab.ecriture.aide.client") },
            { texte: t("cab.ecriture.aide.retour") },
          ]}
        />
      </h2>

      {illisible ? (
        <p
          role="status"
          className="flex items-center border border-signal-warn bg-card px-3.5 py-2.5 text-[13px] text-signal-warn"
        >
          {t("cab.ecriture.illisible")}
          <Aide
            titre={t("cab.ecriture.illisible")}
            paragraphes={[{ texte: t("cab.ecriture.illisible.aide") }]}
          />
        </p>
      ) : null}

      {suivi?.prise && suivi.priseLe ? (
        <p role="status" className="text-[12.5px] font-medium text-signal-ok">
          {t("cab.ecriture.prise", {
            statut: t(MOT_CABINET[suivi.prise]),
            par: suivi.prisePar ?? "",
            quand: heure(suivi.priseLe),
          })}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          {t("cab.ecriture.journal")}
          <select
            value={saisie.journal}
            onChange={(e) => setSaisie((s) => ({ ...s, journal: e.target.value }))}
            className="h-9 border border-border bg-background px-2 text-[13px] font-normal text-foreground"
          >
            <option value="">{t("cab.ecriture.journal.choisir")}</option>
            {(journaux.data ?? []).map((j) => (
              <option key={j.code} value={j.code}>
                {j.code} — {j.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          {t("cab.ecriture.date")}
          <input
            type="date"
            value={saisie.date}
            onChange={(e) => setSaisie((s) => ({ ...s, date: e.target.value }))}
            className="num h-9 border border-border bg-background px-2 text-[13px] font-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          {t("cab.ecriture.libelle")}
          <input
            type="text"
            value={saisie.libelle}
            onChange={(e) => setSaisie((s) => ({ ...s, libelle: e.target.value }))}
            className="h-9 border border-border bg-background px-2 text-[13px] font-normal text-foreground"
          />
        </label>
      </div>
      {remarques.length > 0 ? (
        // Les remarques ne bloquent pas : l'expert reste maître de ce qu'il
        // écrit, mais il voit ce qu'un contrôleur verra.
        <ul className="space-y-0.5 text-[11px] text-signal-warn">
          {remarques.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {typeAEtablir ? (
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
          {t("cab.ecriture.type")}
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 border border-border bg-background px-2 text-[13px] font-normal text-foreground"
          >
            <option value="">{t("cab.ecriture.type.choisir")}</option>
            {(types.data ?? [])
              .filter((d) => d.porteEcriture)
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.libelle}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <ListeDesComptes id={LISTE_DES_COMPTES} plan={plan} />
      {/*
       * Les lignes, sans défilement horizontal : sur un téléphone, une carte par
       * ligne (compte, libellé, puis débit et crédit côte à côte) ; dès « sm »,
       * la grille d'un tableau. Les intitulés de colonne ne s'affichent qu'en
       * grille ; en carte, chaque champ porte le sien.
       */}
      <div className="border border-border bg-card text-[13px]">
        <div
          aria-hidden
          className="hidden bg-muted px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_2.25rem] sm:gap-2"
        >
          <span>{t("pme.journal.account")}</span>
          <span>{t("cab.ecriture.ligne.libelle")}</span>
          <span className="text-end">{t("pme.journal.debit")}</span>
          <span className="text-end">{t("pme.journal.credit")}</span>
          <span />
        </div>
        <ul>
          {saisie.lignes.map((l, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 border-t border-border px-2.5 py-2 first:border-t-0 sm:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_2.25rem] sm:items-start sm:first:border-t"
            >
              <div className="col-span-2 sm:col-span-1">
                <SaisieDeCompte
                  valeur={l.account_code}
                  onChange={(code) => changerLigne(i, { account_code: code })}
                  plan={plan}
                  label={t("cab.ecriture.ligne.champ", {
                    champ: t("pme.journal.account"),
                    n: i + 1,
                  })}
                  inconnuLabel={t("cab.ecriture.compte.inconnu")}
                  listeId={LISTE_DES_COMPTES}
                  collectifLabel={t("plan.collectif.court")}
                  originesLabels={{
                    officiel: t("plan.origin.officiel"),
                    extension: t("plan.origin.extension"),
                    cabinet: t("plan.origin.cabinet"),
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setSaisie((s) => ({ ...s, lignes: s.lignes.filter((_, j) => j !== i) }))
                }
                aria-label={t("cab.ecriture.ligne.champ", {
                  champ: t("cab.ecriture.ligne.retirer"),
                  n: i + 1,
                })}
                className="col-start-3 row-start-1 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground sm:col-start-5"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
              <label className="col-span-3 flex flex-col gap-1 sm:col-span-1 sm:row-start-1 sm:col-start-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:sr-only">
                  {t("cab.ecriture.ligne.libelle")}
                </span>
                {/*
                 * Un nom par champ ET par ligne : « Débit » dix fois ne dit
                 * pas lequel (lecteur d'écran, staging du 30 octobre 2026).
                 */}
                <input
                  type="text"
                  aria-label={t("cab.ecriture.ligne.champ", {
                    champ: t("cab.ecriture.ligne.libelle"),
                    n: i + 1,
                  })}
                  value={l.libelle}
                  onChange={(e) => changerLigne(i, { libelle: e.target.value })}
                  className="w-full border border-border bg-background px-2 py-1 text-[13px]"
                />
              </label>
              {(["debit", "credit"] as const).map((cote) => (
                <label
                  key={cote}
                  className={
                    cote === "debit"
                      ? "flex flex-col gap-1 sm:row-start-1 sm:col-start-3"
                      : "flex flex-col gap-1 sm:row-start-1 sm:col-start-4"
                  }
                >
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:sr-only">
                    {t(cote === "debit" ? "pme.journal.debit" : "pme.journal.credit")}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={t("cab.ecriture.ligne.champ", {
                      champ: t(cote === "debit" ? "pme.journal.debit" : "pme.journal.credit"),
                      n: i + 1,
                    })}
                    value={l[cote]}
                    onChange={(e) => changerLigne(i, { [cote]: e.target.value })}
                    className="num w-full border border-border bg-background px-2 py-1 text-end text-[13px]"
                  />
                </label>
              ))}
              {/*
               * Le taux de la ligne, choisi au référentiel du pack : une ligne
               * de TVA le dit toujours (le serveur refuse sinon) ; une base
               * aussi quand la facture porte plusieurs taux. Jamais deviné
               * (revue de #140). La proposition du Socle le pré-remplit.
               */}
              <label className="col-span-3 flex items-center gap-2 sm:col-span-2 sm:col-start-1 sm:row-start-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("cab.ecriture.ligne.taxe")}
                </span>
                <select
                  aria-label={t("cab.ecriture.ligne.champ", {
                    champ: t("cab.ecriture.ligne.taxe"),
                    n: i + 1,
                  })}
                  value={l.tax_code ?? ""}
                  onChange={(e) => changerLigne(i, { tax_code: e.target.value || null })}
                  className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-[12.5px]"
                >
                  <option value="">—</option>
                  {codesDeTaxe.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted px-2.5 py-2 font-semibold sm:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_2.25rem]">
          <button
            type="button"
            onClick={() => setSaisie((s) => ({ ...s, lignes: [...s.lignes, LIGNE_VIDE] }))}
            className="col-span-2 inline-flex min-h-[32px] items-center gap-1.5 justify-self-start text-[12.5px] font-semibold underline-offset-4 hover:underline sm:col-span-1"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("cab.ecriture.ligne.ajouter")}
          </button>
          <p
            className={
              controle && !controle.defaut
                ? "col-span-2 text-signal-ok sm:col-span-1"
                : "col-span-2 text-signal-stop sm:col-span-1"
            }
            aria-live="polite"
          >
            {controle && !controle.defaut ? t("cab.ecriture.equilibree") : manque}
          </p>
          <p className="num text-end">
            <span className="sr-only">{t("pme.journal.debit")} </span>
            {controle?.totalDebit ? montant(controle.totalDebit, locale) : "—"}
          </p>
          <p className="num text-end">
            <span className="sr-only">{t("pme.journal.credit")} </span>
            {controle?.totalCredit ? montant(controle.totalCredit, locale) : "—"}
          </p>
        </div>
      </div>

      {/* Deux gestes, même hauteur, même largeur ; aucun n'attend le client. */}
      <div className="grid grid-cols-2 gap-2.5">
        {prise && telleQuelle ? (
          <Link
            to="/cabinet/journal"
            search={{ client: clientId }}
            className="flex min-h-[48px] items-center justify-center border border-foreground bg-foreground px-4 text-center text-[14px] font-semibold text-background hover:bg-background hover:text-foreground"
          >
            {t("cab.nav.journal")}
          </Link>
        ) : (
          <button
            type="button"
            disabled={inscrire.isPending || manque !== null}
            onClick={() => inscrire.mutate()}
            className="min-h-[48px] border border-foreground bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {inscrire.isPending ? t("common.loading") : principal}
          </button>
        )}
        <button
          type="button"
          disabled={inscrire.isPending || statut === "retournee"}
          onClick={() => setFeuille(true)}
          className="min-h-[48px] border border-border bg-card px-4 text-[14px] font-semibold hover:bg-accent disabled:opacity-50"
        >
          {t("cab.ecriture.retourner")}
        </button>
      </div>
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}

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
