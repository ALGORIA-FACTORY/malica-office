/**
 * Les lecteurs spécialisés — l'écran de l'expert sur la fabrique de recettes.
 *
 * ============================================================== POURQUOI
 *
 * La fabrique fonctionne de bout en bout côté serveur depuis le 20 octobre
 * 2026 : une recette naît d'exemples, s'évalue, s'observe, s'active, se
 * suspend, se retire. Aucun écran ne la montrait. Celui-ci la montre à qui a
 * le droit d'en décider, et à personne d'autre : le dirigeant qui numérise ne
 * voit rien de tout cela, et c'est voulu.
 *
 * ================================================= CE QU'IL NE RÉIMPLÉMENTE PAS
 *
 * Le droit de promouvoir est tenu par la BASE — `fabrique.verifier_promotion()`
 * et la politique d'écriture. L'écran propose les transitions et rend le refus
 * tel qu'il arrive ; il ne cache pas un bouton en devinant un rôle, parce
 * qu'une devinette d'écran et un verdict de base finissent toujours par
 * diverger, et c'est l'écran qu'on croit.
 *
 * ========================================= LES QUATRE CHOSES À NE PAS LISSER
 *
 * ① UNE MESURE ABSENTE RESTE ABSENTE. Quand le jeu d'évaluation ne porte
 *   aucun montant, `montants_faux_acceptes` n'est pas zéro : elle n'existe
 *   pas. Zéro franchirait le seuil « au plus zéro ». Les mesures calculées et
 *   les mesures absentes sont donc rendues dans DEUX blocs séparés, et le
 *   mot « absente » est écrit — jamais un tiret, qui se lit comme un zéro.
 *
 * ② UNE RECETTE EN OBSERVATION N'EST PAS CRUE. Elle s'exécute, on compare.
 *   L'état porte son mot ET sa phrase, et les deux disent la même chose :
 *   la couleur seule ne porte rien (langage visuel, interdit ③).
 *
 * ③ UNE RECETTE SUSPENDUE NE DISPARAÎT PAS. Cet écran lisait
 *   `contexteDeDesignation`, qui ne rend que `observation` et `active` : la
 *   recette que la surveillance venait de suspendre s'en allait de l'écran.
 *   L'expert voyait le verdict une fois, puis plus rien — au pire moment.
 *   Il lit donc `recettes`, qui rend TOUS les états, et l'historique des
 *   décisions, qui dit par QUI et pour QUEL motif une recette s'est arrêtée.
 *
 * ④ CE QUI MANQUE SE DIT EN NOMBRE, PAS EN RÈGLE. Énoncer « deux exemples
 *   distincts au moins » laisse l'expert compter lui-même. La section des
 *   formats dit « il vous manque un exemple », et le nombre vient du serveur :
 *   le minimum est une borne de forme, et le recopier ici en ferait une
 *   seconde vérité.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { ClientPicker } from "@/components/malica/ClientPicker";
import { ecrireDossierCourant, useDossierCourant } from "@/components/malica/dossier-courant";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
  SignalLight,
  type Tone,
} from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { MessageKey } from "@malica/socle/messages";
import type {
  DeriveConstatee,
  EtatDUneRecette,
  EvaluationDUneVersion,
  ExempleQualifieLu,
  FormatConnuDuDossier,
  RecetteDeLaFabrique,
  SurveillanceDUneVersion,
} from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/lecteurs")({
  head: () => ({
    meta: [
      { title: "Lecteurs spécialisés — Malica Office" },
      {
        name: "description",
        content:
          "Les recettes de lecture d'un dossier : état, version, évaluation avec ses mesures absentes nommées, surveillance et décisions de cycle.",
      },
      { property: "og:title", content: "Lecteurs spécialisés — Malica Office" },
      {
        property: "og:description",
        content:
          "État, version, évaluation, surveillance et décisions des lecteurs spécialisés d'un dossier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetLecteurs,
});

const OU = "routes/_authenticated/cabinet.lecteurs";
const LABEL = "block text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground";
const LABEL_EN_LIGNE = "text-[9px] font-semibold uppercase tracking-[0.18em]";
const FIELD = "w-full border border-border bg-card px-2.5 py-1.5 text-[12.5px] outline-none";

/** Le mot de chaque état du cycle. Un état sans mot ne s'affiche pas. */
const MOT_DE_L_ETAT: Record<EtatDUneRecette, MessageKey> = {
  candidate: "cab.lecteurs.etat.candidate",
  evaluee: "cab.lecteurs.etat.evaluee",
  observation: "cab.lecteurs.etat.observation",
  active: "cab.lecteurs.etat.active",
  suspendue: "cab.lecteurs.etat.suspendue",
  retiree: "cab.lecteurs.etat.retiree",
};

/**
 * Le signal de chaque état.
 *
 * `observation` est un signal d'ATTENTE, pas de service : elle s'exécute, on
 * compare, on ne la croit pas. Lui donner le vert de `active` ferait passer
 * une mise à l'épreuve pour un lecteur en service, et c'est exactement la
 * confusion que le plan interdit.
 */
const SIGNAL_DE_L_ETAT: Record<EtatDUneRecette, Tone> = {
  candidate: "neutral",
  evaluee: "neutral",
  observation: "warn",
  active: "ok",
  suspendue: "stop",
  retiree: "neutral",
};

/**
 * La phrase de chaque état — à côté du mot, jamais à sa place.
 *
 * Les six états paraissent désormais à l'écran, et chacun porte sa phrase.
 * Avant, l'écran n'en montrait que deux et toute autre valeur recevait la
 * phrase de l'observation : une recette suspendue aurait lu « elle s'exécute
 * et on compare », c'est-à-dire l'inverse de ce qu'elle fait.
 */
const NOTE_DE_L_ETAT: Record<EtatDUneRecette, MessageKey> = {
  candidate: "cab.lecteurs.etat.candidate.note",
  evaluee: "cab.lecteurs.etat.evaluee.note",
  observation: "cab.lecteurs.etat.observation.note",
  active: "cab.lecteurs.etat.active.note",
  suspendue: "cab.lecteurs.etat.suspendue.note",
  retiree: "cab.lecteurs.etat.retiree.note",
};

/** La portée d'une recette. Un partage ne naît pas d'un oubli : il se lit. */
const MOT_DE_LA_PORTEE: Record<"organisation" | "mutualisee", MessageKey> = {
  organisation: "cab.lecteurs.portee.organisation",
  mutualisee: "cab.lecteurs.portee.mutualisee",
};

const MOT_DE_L_USAGE: Record<ExempleQualifieLu["usage"], MessageKey> = {
  apprentissage: "cab.lecteurs.usage.apprentissage",
  evaluation: "cab.lecteurs.usage.evaluation",
};

const MOT_DE_LA_PROVENANCE: Record<ExempleQualifieLu["provenance"], MessageKey> = {
  validation_humaine: "cab.lecteurs.provenance.validation_humaine",
  correction_humaine: "cab.lecteurs.provenance.correction_humaine",
  import_expert: "cab.lecteurs.provenance.import_expert",
  observation: "cab.lecteurs.provenance.observation",
};

const MOT_DE_LA_QUALIFICATION: Record<ExempleQualifieLu["qualification"], MessageKey> = {
  reconnaissance_ocr: "cab.lecteurs.qualification.reconnaissance_ocr",
  designation_champ: "cab.lecteurs.qualification.designation_champ",
  normalisation: "cab.lecteurs.qualification.normalisation",
  document_incomplet: "cab.lecteurs.qualification.document_incomplet",
  decision_comptable: "cab.lecteurs.qualification.decision_comptable",
};

/** La phrase de chaque dérive. Les quatre natures de `fabrique.derive_t`. */
const MOT_DE_LA_DERIVE: Record<DeriveConstatee["nature"], MessageKey> = {
  abstention_en_hausse: "cab.lecteurs.derive.abstention_en_hausse",
  montant_faux_accepte: "cab.lecteurs.derive.montant_faux_accepte",
  correction_humaine: "cab.lecteurs.derive.correction_humaine",
  signature_changee: "cab.lecteurs.derive.signature_changee",
};

/**
 * Le nom lisible d'une mesure, ou son nom brut.
 *
 * Les mesures viennent du référentiel (`fabrique.seuils_exiges`), pas du
 * code : une mesure ajoutée demain s'affichera sous son nom technique plutôt
 * que de disparaître de l'écran. Un nom technique se lit mal ; une mesure
 * qu'on ne montre pas ne se lit pas du tout.
 */
function nomDeLaMesure(nom: string, t: (k: MessageKey) => string): string {
  const CLES: Record<string, MessageKey> = {
    exactitude_champs_critiques: "cab.lecteurs.mesure.exactitude",
    montants_faux_acceptes: "cab.lecteurs.mesure.fauxMontants",
    taux_abstention: "cab.lecteurs.mesure.abstention",
  };
  const cle = CLES[nom];
  return cle ? t(cle) : nom;
}

/**
 * Le nom de la mesure manquante, tiré de la ligne que le serveur rend.
 *
 * Le serveur écrit « nom : raison en clair ». On garde le nom pour le
 * traduire, et la raison reste celle du serveur — elle nomme ce qui manque
 * au jeu d'évaluation, et la réécrire ici en ferait une seconde vérité.
 */
function nomAbsent(ligne: string): string {
  const coupe = ligne.indexOf(" : ");
  return coupe === -1 ? ligne : ligne.slice(0, coupe);
}

function raisonAbsente(ligne: string): string | null {
  const coupe = ligne.indexOf(" : ");
  return coupe === -1 ? null : ligne.slice(coupe + 3);
}

function CabinetLecteurs() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const dossierCourant = useDossierCourant();
  const [tenantId, setTenantId] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const rows = clients.data ?? [];
  const client =
    rows.find((c) => c.tenantId === tenantId) ??
    rows.find((c) => c.tenantId === dossierCourant?.id) ??
    rows[0] ??
    null;

  /*
   * `recettes`, et non `contexteDeDesignation` : celle-là est sur le chemin de
   * la désignation et ne rend que les deux états qui tournent. L'écran bâti
   * dessus perdait la recette au moment précis où elle venait d'être
   * suspendue.
   */
  const recettes = useQuery({
    queryKey: ["fabrique-recettes", client?.tenantId],
    queryFn: () => office().fabrique.recettes(client!.tenantId),
    enabled: !!client,
  });
  const versions = recettes.data ?? [];

  const formats = useQuery({
    queryKey: ["fabrique-signatures", client?.tenantId],
    queryFn: () => office().fabrique.signatures(client!.tenantId),
    enabled: !!client,
  });

  const derives = useQuery({
    queryKey: ["fabrique-derives", client?.tenantId],
    queryFn: () => office().fabrique.derives(client!.tenantId),
    enabled: !!client,
  });

  useMalicaPanel(
    <MalicaNote kicker={t("cab.lecteurs.panel.kicker")}>{t("cab.lecteurs.panel")}</MalicaNote>,
    [locale],
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-foreground pb-6">
        <div className="min-w-0">
          <p className="num text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.lecteurs.kicker")}
          </p>
          <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
            {t("cab.lecteurs.title")}
          </h1>
          <p className="mt-3 max-w-[46rem] text-[13.5px] leading-[1.55] text-text-2">
            {t("cab.lecteurs.lede")}
          </p>
        </div>
        {rows.length > 0 ? (
          <ClientPicker
            label={t("cab.queue.client")}
            clients={rows}
            value={client?.tenantId ?? null}
            onChange={(id) => {
              setTenantId(id);
              const choisi = rows.find((c) => c.tenantId === id);
              if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
            }}
          />
        ) : null}
      </header>

      <section className="space-y-3">
        <SectionTitle>{t("cab.lecteurs.section.quiLit")}</SectionTitle>
        {client && recettes.isPending ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : versions.length === 0 ? (
          <EmptyState>{t("cab.lecteurs.vide")}</EmptyState>
        ) : (
          <ul className="space-y-4">
            {versions.map((v) => (
              <li key={v.versionId}>
                <CarteDeRecette tenantId={client!.tenantId} version={v} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- les formats, leurs exemples un par un, et ce qui manque */}
      <section className="space-y-3">
        <SectionTitle>{t("cab.lecteurs.section.formats")}</SectionTitle>
        <p className="max-w-[46rem] text-[12.5px] leading-[1.55] text-text-2">
          {t("cab.lecteurs.formats.doctrine")}
        </p>
        {client && formats.isPending ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (formats.data?.formats.length ?? 0) === 0 ? (
          <EmptyState>{t("cab.lecteurs.formats.vide")}</EmptyState>
        ) : (
          <ul className="space-y-4">
            {(formats.data?.formats ?? []).map((f) => (
              <li key={f.signatureCle}>
                <CarteDeFormat format={f} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- les dérives : elles survivent à la suspension qu'elles ont causée */}
      <section className="space-y-3">
        <SectionTitle>{t("cab.lecteurs.section.derives")}</SectionTitle>
        <p className="max-w-[46rem] text-[12.5px] leading-[1.55] text-text-2">
          {t("cab.lecteurs.derives.doctrine")}
        </p>
        {client && derives.isPending ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (derives.data ?? []).length === 0 ? (
          <EmptyState>{t("cab.lecteurs.derives.vide")}</EmptyState>
        ) : (
          <InkTable
            head={[
              t("cab.lecteurs.derive.quand"),
              t("cab.lecteurs.derive.lecteur"),
              t("cab.lecteurs.derive.nature"),
            ]}
            caption={t("cab.lecteurs.derive.caption")}
          >
            {(derives.data ?? []).map((d) => (
              <InkTableRow key={`${d.versionId}-${d.constateeLe}-${d.nature}`}>
                <InkCell numeric>{jourLisible(d.constateeLe, locale)}</InkCell>
                <InkCell>
                  {d.libelle}
                  {" · "}
                  {t("cab.lecteurs.version", { rang: String(d.rang) })}
                </InkCell>
                <InkCell>{t(MOT_DE_LA_DERIVE[d.nature])}</InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>

      {/* Ce qu'il faut pour qu'une recette naisse. Ce n'est pas un seuil de
          paramétrage : à un seul exemple, l'ossature n'existe pas. */}
      <section className="space-y-3">
        <SectionTitle>{t("cab.lecteurs.section.naissance")}</SectionTitle>
        <p className="border border-border bg-card px-4 py-4 text-[13px] leading-[1.6] text-muted-foreground">
          {t("cab.lecteurs.naissance.corps")}
        </p>
      </section>
    </div>
  );
}

/** Un jour lisible, dans la langue de l'écran. Rien d'autre n'est inventé. */
function jourLisible(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

/* ----------------------------------------- un format, ses exemples, son manque */

function CarteDeFormat({ format, locale }: { format: FormatConnuDuDossier; locale: string }) {
  const { t } = useI18n();
  return (
    <article className="border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="num text-[13px] font-semibold">{format.signatureCle}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {format.libelle
              ? t("cab.lecteurs.format.lecteur", { libelle: format.libelle })
              : t("cab.lecteurs.format.sansLecteur")}
            {format.portee ? ` · ${t(MOT_DE_LA_PORTEE[format.portee])}` : ""}
          </p>
        </div>
        {/* Pas de `shrink-0` : à 375 px, les deux comptes débordaient de trois
            pixels et le dernier chiffre se coupait. Ils reviennent à la ligne. */}
        <p className="num text-[11.5px] text-muted-foreground">
          {t("cab.lecteurs.format.apprentissage", { count: format.apprentissage })}
          {" · "}
          {t("cab.lecteurs.format.evaluation", { count: format.evaluation })}
        </p>
      </header>

      <div className="space-y-4 px-4 py-4">
        {/*
         * CE QUI MANQUE, EN NOMBRE. Le compte vient du serveur : le minimum
         * d'exemples est une borne de forme, pas un seuil de paramétrage, et
         * un second exemplaire ici serait une seconde vérité.
         */}
        {format.manque > 0 ? (
          <p className="border border-s-2 border-border border-s-signal-warn px-3 py-2 text-[12.5px] leading-[1.5]">
            {t("cab.lecteurs.format.manque", { count: format.manque })}
          </p>
        ) : (
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
            {t("cab.lecteurs.format.assez")}
          </p>
        )}

        {format.exemples.length > 0 ? (
          <InkTable
            head={[
              t("cab.lecteurs.exemple.quand"),
              t("cab.lecteurs.exemple.quoi"),
              t("cab.lecteurs.exemple.provenance"),
              t("cab.lecteurs.exemple.usage"),
              t("cab.lecteurs.exemple.champs"),
            ]}
            caption={t("cab.lecteurs.exemple.caption")}
          >
            {format.exemples.map((e) => (
              <InkTableRow key={e.exempleId}>
                <InkCell numeric>{jourLisible(e.qualifieLe, locale)}</InkCell>
                <InkCell>
                  {t(MOT_DE_LA_QUALIFICATION[e.qualification])}
                  {/* Une décision comptable n'enseigne rien sur la forme du
                      papier, et la colonne calculée en base le dit. */}
                  {e.nourritUneRecette ? "" : ` — ${t("cab.lecteurs.exemple.nenourritpas")}`}
                </InkCell>
                <InkCell>{t(MOT_DE_LA_PROVENANCE[e.provenance])}</InkCell>
                <InkCell>{t(MOT_DE_L_USAGE[e.usage])}</InkCell>
                <InkCell numeric>
                  {e.champs === null ? t("cab.lecteurs.eval.absente") : String(e.champs)}
                </InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------ une recette, et sa vie */

function CarteDeRecette({ tenantId, version }: { tenantId: string; version: RecetteDeLaFabrique }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [historique, setHistorique] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationDUneVersion | null>(null);
  const [surveillance, setSurveillance] = useState<SurveillanceDUneVersion | null>(null);

  /*
   * TOUTES les décisions, pas la dernière. Une suspension est une écriture
   * nouvelle : sans la suite, l'écran dirait « suspendue » sans jamais dire
   * ce que la recette faisait la veille ni qui l'a arrêtée.
   */
  const decisions = useQuery({
    queryKey: ["fabrique-decisions", version.versionId],
    queryFn: () => office().fabrique.decisions(version.versionId),
  });
  const derniere = decisions.data?.[0] ?? null;

  const evaluer = useMutation({
    mutationFn: () => office().fabrique.evaluerUneVersion(tenantId, version.versionId),
    onSuccess: (r) => {
      setErreur(null);
      setEvaluation(r);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const surveiller = useMutation({
    mutationFn: () => office().fabrique.surveillerUneVersion(tenantId, version.versionId),
    onSuccess: async (r) => {
      setErreur(null);
      setSurveillance(r);
      // Une surveillance peut SUSPENDRE : l'état affiché doit suivre le fait.
      await qc.invalidateQueries({ queryKey: ["fabrique-recettes", tenantId] });
      await qc.invalidateQueries({ queryKey: ["fabrique-decisions", version.versionId] });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const promouvoir = useMutation({
    mutationFn: (etat: EtatDUneRecette) =>
      office().fabrique.promouvoir({
        tenantId,
        recetteVersionId: version.versionId,
        etat,
        // L'évaluation n'accompagne la décision que si elle vient d'être
        // menée ici. La base exige la sienne : elle ne se suppose pas.
        ...(evaluation ? { evaluationId: evaluation.evaluationId } : {}),
        motif: motif.trim(),
      }),
    onSuccess: async () => {
      setErreur(null);
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["fabrique-recettes", tenantId] });
      await qc.invalidateQueries({ queryKey: ["fabrique-decisions", version.versionId] });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const nombre = (n: number) => new Intl.NumberFormat(locale).format(n);
  const pret = motif.trim().length > 0 && !promouvoir.isPending;

  return (
    <article className="border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">{version.libelle}</p>
          <p className="num mt-1 text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("cab.lecteurs.version", { rang: nombre(version.rang) })}
            {" · "}
            {t("cab.lecteurs.exemples", { count: version.exemples })}
            {version.champs === null
              ? ""
              : ` · ${t("cab.lecteurs.champs", { count: version.champs })}`}
          </p>
          {/* Le format lu et la portée : « qui partage quoi » se lit sans enquête. */}
          <p className="mt-1.5 text-[11.5px] leading-[1.45] text-muted-foreground">
            <span className={LABEL_EN_LIGNE}>{t("cab.lecteurs.signature")}</span>{" "}
            <span className="num">{version.signatureCle}</span>
            {" · "}
            <span className={LABEL_EN_LIGNE}>{t("cab.lecteurs.portee")}</span>{" "}
            {t(MOT_DE_LA_PORTEE[version.portee])}
          </p>
        </div>
        <div className="shrink-0 text-end">
          {/* Six états paraissent ici, et chacun porte SON mot et SA phrase.
              Une version sans décision n'en a pas : elle le dit. */}
          <SignalLight
            tone={version.etat === null ? "neutral" : SIGNAL_DE_L_ETAT[version.etat]}
            label={
              version.etat === null
                ? t("cab.lecteurs.etat.inconnu")
                : t(MOT_DE_L_ETAT[version.etat])
            }
          />
          <p className="mt-1 max-w-[20rem] text-[11.5px] leading-[1.45] text-muted-foreground">
            {version.etat === null
              ? t("cab.lecteurs.etat.inconnu.note")
              : t(NOTE_DE_L_ETAT[version.etat])}
          </p>
        </div>
      </header>

      <div className="space-y-5 px-4 py-4">
        {/* ---- la dernière décision : qui a tranché, et pourquoi */}
        <div>
          <p className={LABEL}>{t("cab.lecteurs.decision")}</p>
          <p className="mt-1 text-[12.5px] leading-[1.5]">
            {decisions.isPending
              ? t("common.loading")
              : derniere
                ? `${t(MOT_DE_L_ETAT[derniere.etat])} — ${derniere.motif}`
                : t("cab.lecteurs.decision.aucune")}
          </p>
          {(decisions.data ?? []).length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setHistorique((v) => !v)}
                aria-expanded={historique}
                className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] underline"
              >
                {historique
                  ? t("cab.lecteurs.historique.cacher")
                  : t("cab.lecteurs.historique.voir")}
              </button>
              {historique ? (
                <div className="mt-2">
                  <p className={LABEL}>{t("cab.lecteurs.historique")}</p>
                  <div className="mt-1.5">
                    <InkTable
                      head={[
                        t("cab.lecteurs.hist.quand"),
                        t("cab.lecteurs.hist.etat"),
                        t("cab.lecteurs.hist.motif"),
                      ]}
                      caption={t("cab.lecteurs.hist.caption")}
                    >
                      {(decisions.data ?? []).map((d) => (
                        <InkTableRow key={`${d.decideLe}-${d.etat}-${d.motif}`}>
                          <InkCell numeric>{jourLisible(d.decideLe, locale)}</InkCell>
                          <InkCell>{t(MOT_DE_L_ETAT[d.etat])}</InkCell>
                          <InkCell>{d.motif}</InkCell>
                        </InkTableRow>
                      ))}
                    </InkTable>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={() => evaluer.mutate()} disabled={evaluer.isPending}>
              {evaluer.isPending ? t("cab.lecteurs.evaluer.encours") : t("cab.lecteurs.evaluer")}
            </ActionButton>
            <ActionButton onClick={() => surveiller.mutate()} disabled={surveiller.isPending}>
              {surveiller.isPending
                ? t("cab.lecteurs.surveiller.encours")
                : t("cab.lecteurs.surveiller")}
            </ActionButton>
          </div>

          {/* ---- l'évaluation, et ses mesures ABSENTES nommées une par une */}
          {evaluation ? (
            <div className="space-y-3 border border-border p-3">
              <p className={LABEL}>
                {t("cab.lecteurs.eval.titre", { count: evaluation.exemplesComptes })}
              </p>
              {Object.keys(evaluation.mesures).length > 0 ? (
                <InkTable
                  head={[t("cab.lecteurs.eval.mesure"), t("cab.lecteurs.eval.valeur")]}
                  caption={t("cab.lecteurs.eval.mesurees")}
                >
                  {Object.entries(evaluation.mesures).map(([nom, valeur]) => (
                    <InkTableRow key={nom}>
                      <InkCell>{nomDeLaMesure(nom, t)}</InkCell>
                      <InkCell numeric>{nombre(valeur)}</InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              ) : null}

              {/*
               * LES ABSENTES. Elles ne descendent pas dans la table des
               * mesures avec un tiret : un tiret dans une colonne de chiffres
               * se lit comme un zéro, et zéro franchit le seuil « au plus
               * zéro ». Elles ont leur bloc, leur mot, et leur raison.
               */}
              {evaluation.absentes.length > 0 ? (
                <div className="border border-s-2 border-border border-s-signal-warn px-3 py-2">
                  <p className={LABEL}>{t("cab.lecteurs.eval.absentes")}</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {evaluation.absentes.map((ligne) => (
                      <li key={ligne} className="text-[12.5px] leading-[1.5]">
                        <span className="font-semibold">{nomDeLaMesure(nomAbsent(ligne), t)}</span>
                        {" — "}
                        <span className="uppercase tracking-[0.12em] text-signal-warn">
                          {t("cab.lecteurs.eval.absente")}
                        </span>
                        {raisonAbsente(ligne) ? (
                          <span className="block text-muted-foreground">
                            {raisonAbsente(ligne)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11.5px] leading-[1.45] text-muted-foreground">
                    {t("cab.lecteurs.eval.absente.aide")}
                  </p>
                </div>
              ) : null}

              {evaluation.ecarts.length > 0 ? (
                <InkTable
                  head={[
                    t("cab.lecteurs.ecart.champ"),
                    t("cab.lecteurs.ecart.quoi"),
                    t("cab.lecteurs.ecart.detail"),
                  ]}
                  caption={t("cab.lecteurs.ecarts")}
                >
                  {evaluation.ecarts.map((e) => (
                    <InkTableRow key={`${e.pieceId}-${e.champ}-${e.quoi}`}>
                      <InkCell>{e.champ}</InkCell>
                      <InkCell>{e.quoi}</InkCell>
                      <InkCell>{e.detail}</InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              ) : null}
            </div>
          ) : null}

          {/* ---- la surveillance : ce que la recette a désigné, ce qu'elle a
                  rendu à la chaîne, et la dérive quand il y en a une */}
          {surveillance ? (
            <div className="space-y-2 border border-border p-3">
              <p className={LABEL}>{t("cab.lecteurs.surv.titre")}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
                <div>
                  <dt className={LABEL}>{t("cab.lecteurs.surv.executions")}</dt>
                  <dd className="num mt-0.5">{nombre(surveillance.executions)}</dd>
                </div>
                <div>
                  <dt className={LABEL}>{t("cab.lecteurs.surv.abstentions")}</dt>
                  <dd className="num mt-0.5">{nombre(surveillance.abstentions)}</dd>
                </div>
                <div>
                  <dt className={LABEL}>{t("cab.lecteurs.surv.taux")}</dt>
                  {/* Un taux sur zéro exécution n'est pas un taux : il est
                      absent, et il s'écrit absent. */}
                  <dd
                    className={
                      surveillance.tauxAbstention === null
                        ? "mt-0.5 text-signal-warn"
                        : "num mt-0.5"
                    }
                  >
                    {surveillance.tauxAbstention === null
                      ? t("cab.lecteurs.eval.absente")
                      : nombre(surveillance.tauxAbstention)}
                  </dd>
                </div>
                <div>
                  <dt className={LABEL}>{t("cab.lecteurs.surv.tolere")}</dt>
                  <dd
                    className={
                      surveillance.tolere === null ? "mt-0.5 text-signal-warn" : "num mt-0.5"
                    }
                  >
                    {surveillance.tolere === null
                      ? t("cab.lecteurs.eval.absente")
                      : nombre(surveillance.tolere)}
                  </dd>
                </div>
              </dl>
              <p className="text-[12.5px] leading-[1.5]">
                {surveillance.derive === null
                  ? t("cab.lecteurs.surv.rien")
                  : surveillance.derive === "signature_changee"
                    ? t("cab.lecteurs.surv.derive.signature")
                    : t("cab.lecteurs.surv.derive.abstention")}
                {surveillance.suspendue ? ` — ${t("cab.lecteurs.surv.suspendue")}` : ""}
              </p>
              <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
                {t("cab.lecteurs.surv.comparaison")}
              </p>
            </div>
          ) : null}
        </div>

        {/* ---- les décisions de cycle. Le motif est obligatoire en base ; le
                bouton reste gris tant qu'il manque, et la phrase dit pourquoi. */}
        <div className="space-y-2 border-t border-border pt-4">
          <label className="block">
            <span className={LABEL}>{t("cab.lecteurs.motif")}</span>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              maxLength={2000}
              className={`mt-1 ${FIELD}`}
              placeholder={t("cab.lecteurs.motif.exemple")}
            />
          </label>
          <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
            {t("cab.lecteurs.motif.pourquoi")}
          </p>
          <div className="flex flex-wrap gap-2">
            {version.etat === "observation" ? (
              <ActionButton
                variant="ink"
                disabled={!pret}
                onClick={() => promouvoir.mutate("active")}
              >
                {t("cab.lecteurs.activer")}
              </ActionButton>
            ) : null}
            {/* La reprise d'une recette suspendue. Elle n'existait pas tant que
                l'écran ne voyait pas les suspendues — la base, elle, la permet,
                et elle exige son évaluation comme pour toute mise à l'épreuve. */}
            {version.etat === "suspendue" ? (
              <ActionButton
                variant="ink"
                disabled={!pret}
                onClick={() => promouvoir.mutate("observation")}
              >
                {t("cab.lecteurs.reprendre")}
              </ActionButton>
            ) : null}
            <ActionButton disabled={!pret} onClick={() => promouvoir.mutate("suspendue")}>
              {t("cab.lecteurs.suspendre")}
            </ActionButton>
            <ActionButton disabled={!pret} onClick={() => promouvoir.mutate("retiree")}>
              {t("cab.lecteurs.retirer")}
            </ActionButton>
          </div>
          <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
            {t("cab.lecteurs.droit")}
          </p>
        </div>

        {erreur ? <p className="text-[12.5px] text-signal-stop">{erreur}</p> : null}
      </div>
    </article>
  );
}
