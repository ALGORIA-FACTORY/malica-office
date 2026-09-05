/**
 * L'export FEC et CSV du cabinet — la sortie de données, sans verrou.
 *
 * ============================================================== POURQUOI
 *
 * Un cabinet qui ne peut pas partir n'est pas un client, c'est un otage. Cet
 * écran ne montre rien qu'il n'ait lu : les mandats viennent des engagements,
 * les exercices de la clôture inscrite sur la fiche, la taille du fichier
 * qui serait produit — calculée sur son contenu, pas estimée.
 *
 * Le fichier ne transite par aucun serveur de fichiers : l'API rend son
 * contenu, le navigateur en fait un téléchargement. Ce qui reste en base est
 * le fait daté — format, période, lignes, taille, empreinte — et il ne
 * s'efface pas.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { EmptyState, RegalicaNote } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { ExportGenere, FormatExport } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/export")({
  head: () => ({
    meta: [
      { title: "Export FEC et CSV — Regalica Office" },
      {
        name: "description",
        content:
          "Les écritures comptabilisées de vos mandats, au format légal ou tabulé, horodatées avec leur pack de rattachement.",
      },
      { property: "og:title", content: "Export FEC et CSV — Regalica Office" },
      {
        property: "og:description",
        content: "Sortie de données du cabinet : FEC, CSV des écritures, CSV du plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetExport,
});

const FORMATS: ReadonlyArray<{ code: FormatExport; label: MessageKey; hint: MessageKey }> = [
  { code: "fec", label: "cab.export.format.fec", hint: "cab.export.format.fec.hint" },
  {
    code: "csv_ecritures",
    label: "cab.export.format.csv_ecritures",
    hint: "cab.export.format.csv_ecritures.hint",
  },
  {
    code: "csv_plan",
    label: "cab.export.format.csv_plan",
    hint: "cab.export.format.csv_plan.hint",
  },
];
/** Le libellé de chaque format, dérivé de la liste : une seule table à tenir. */
const LIBELLE_DU_FORMAT = Object.fromEntries(FORMATS.map((f) => [f.code, f.label])) as Record<
  FormatExport,
  MessageKey
>;
const OCTETS_PAR_PALIER = 1024;
const UNITES = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/** Un nombre d'octets dans la langue du lecteur : l'unité se choisit, elle ne s'écrit pas. */
function tailleLisible(octets: number, locale: string): string {
  let valeur = octets;
  let palier = 0;
  while (valeur >= OCTETS_PAR_PALIER && palier < UNITES.length - 1) {
    valeur /= OCTETS_PAR_PALIER;
    palier += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITES[palier],
    maximumFractionDigits: palier === 0 ? 0 : 1,
  }).format(valeur);
}

/** Le contenu rendu par l'API devient un fichier du poste — aucun serveur de fichiers. */
function telecharger(e: ExportGenere): void {
  const url = URL.createObjectURL(new Blob([e.contenu], { type: e.typeMime }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = e.nomDeFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

function CabinetExport() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [client, setClient] = useState<string>("");
  const [exercice, setExercice] = useState<number | null>(null);
  const [format, setFormat] = useState<FormatExport>("csv_ecritures");
  const [erreur, setErreur] = useState<string | null>(null);
  const [dernier, setDernier] = useState<ExportGenere | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const exercices = useQuery({
    queryKey: ["cab-export-exercices", org.id, client],
    queryFn: () => office().exports.exercices(org.id, client || null),
  });
  const historique = useQuery({
    queryKey: ["cab-exports", org.id],
    queryFn: () => office().exports.historique(org.id),
  });

  // Seuls les mandats en cours s'exportent : c'est la même frontière que la RLS.
  const mandats = useMemo(
    () => (clients.data ?? []).filter((c) => c.engagementStatus === "actif"),
    [clients.data],
  );

  // L'exercice retenu : celui qu'on a choisi s'il existe encore pour ce
  // périmètre, sinon celui en cours, sinon le plus récent.
  const choisi = useMemo(() => {
    const liste = exercices.data ?? [];
    return (
      liste.find((e) => e.exercice === exercice) ?? liste.find((e) => !e.clos) ?? liste[0] ?? null
    );
  }, [exercices.data, exercice]);
  const today = new Date().toISOString().slice(0, 10);
  const du = choisi?.du ?? null;
  const au = choisi ? (choisi.clos ? choisi.au : today) : null;

  // Le FEC se produit dossier par dossier : sans client, il n'est pas proposé.
  const formatActif: FormatExport = format === "fec" && !client ? "csv_ecritures" : format;

  const estimation = useQuery({
    queryKey: ["cab-export-estimation", org.id, client, du, au, formatActif],
    queryFn: () => office().exports.estimer(org.id, client || null, du!, au!, formatActif),
    enabled: du !== null && au !== null && Boolean(pack.data),
  });

  const generer = useMutation({
    mutationFn: () => office().exports.generer(org.id, client || null, du!, au!, formatActif),
    onMutate: () => {
      setErreur(null);
      setDernier(null);
    },
    onSuccess: (r) => {
      telecharger(r);
      setDernier(r);
      void qc.invalidateQueries({ queryKey: ["cab-exports", org.id] });
    },
    onError: (e) => setErreur(texteDeLErreur(e, "export : génération", t("cab.export.erreur"))),
  });

  const versionDuPack = pack.data ? `${org.jurisdiction} ${pack.data.version}` : null;
  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.export.panel.kicker")}>
      {versionDuPack
        ? t("cab.export.panel", { pack: versionDuPack })
        : t("cab.export.panel.sansPack")}
    </RegalicaNote>,
    [locale, versionDuPack],
  );

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(`${iso.slice(0, 10)}T00:00:00Z`),
    );
  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const dateEtHeure = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const nombre = (n: number) => new Intl.NumberFormat(locale).format(n);

  const libelleExercice = (e: { exercice: number; du: string; au: string; clos: boolean }) =>
    e.clos
      ? t("cab.export.exercice.clos", { exercice: e.exercice })
      : t("cab.export.exercice.enCours", {
          exercice: e.exercice,
          du: dateCourte(e.du),
          au: dateCourte(today),
        });

  const pret = du !== null && au !== null && Boolean(pack.data) && !generer.isPending;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-5">
        {/* ---- masthead */}
        <header className="border-b border-foreground pb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.export.kicker")}
          </p>
          <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
            {t("cab.export.title")}
          </h1>
          <p className="mt-3 max-w-[60ch] text-[13.5px] leading-[1.6] text-text-2">
            {t("cab.export.lede")}
          </p>
        </header>

        {/* ---- le formulaire */}
        <div className="space-y-5 border border-border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("cab.export.client")}
              </span>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                aria-label={t("cab.export.client")}
                className="mt-1.5 w-full border border-border bg-background px-3 py-2.5 text-[13px]"
              >
                <option value="">{t("cab.export.tous", { n: nombre(mandats.length) })}</option>
                {mandats.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("cab.export.exercice")}
              </span>
              <select
                value={choisi?.exercice ?? ""}
                onChange={(e) => setExercice(Number(e.target.value))}
                aria-label={t("cab.export.exercice")}
                disabled={!choisi}
                className="num mt-1.5 w-full border border-border bg-background px-3 py-2.5 text-[13px] disabled:opacity-50"
              >
                {(exercices.data ?? []).map((e) => (
                  <option key={e.exercice} value={e.exercice}>
                    {libelleExercice(e)}
                  </option>
                ))}
              </select>
              {exercices.isFetched && (exercices.data ?? []).length === 0 ? (
                <span className="mt-1.5 block text-[11px] text-muted-foreground">
                  {t("cab.export.exercice.aucun")}
                </span>
              ) : null}
              {client && choisi && !choisi.clotureConnue ? (
                <span className="mt-1.5 block text-[11px] text-muted-foreground">
                  {t("cab.export.exercice.civil")}
                </span>
              ) : null}
            </label>
          </div>

          <div>
            <p className="mb-2.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("cab.export.format")}
            </p>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => {
                const indisponible = f.code === "fec" && !client;
                const actif = formatActif === f.code;
                return (
                  <button
                    key={f.code}
                    type="button"
                    disabled={indisponible}
                    aria-pressed={actif}
                    onClick={() => setFormat(f.code)}
                    className={cn(
                      "min-w-[150px] border px-4 py-3 text-start transition-colors",
                      actif
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card hover:border-foreground",
                      indisponible ? "cursor-not-allowed opacity-40" : "",
                    )}
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em]">
                      {t(f.label)}
                    </span>
                    <span className="num mt-1.5 block text-[10.5px] opacity-70">{t(f.hint)}</span>
                  </button>
                );
              })}
            </div>
            {!client ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("cab.export.format.fec.unDossier")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="num text-[12px] text-muted-foreground">
              {estimation.data
                ? estimation.data.lignes === 0
                  ? t("cab.export.taille.vide")
                  : t("cab.export.taille", {
                      count: estimation.data.lignes,
                      lignes: nombre(estimation.data.lignes),
                      taille: tailleLisible(estimation.data.taille, locale),
                    })
                : estimation.isFetching
                  ? t("cab.export.taille.calcul")
                  : ""}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={!pret}
              onClick={() => generer.mutate()}
              className="border border-foreground bg-foreground px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background transition-colors hover:border-marigold hover:bg-marigold hover:text-foreground disabled:opacity-40"
            >
              {generer.isPending ? t("cab.export.generer.enCours") : t("cab.export.generer")}
            </button>
          </div>

          {erreur ? (
            <p role="alert" className="text-[12px] text-signal-stop">
              {erreur}
            </p>
          ) : null}
          {dernier ? (
            <p role="status" className="num text-[12px] text-signal-ok">
              {t("cab.export.fait", {
                fichier: dernier.nomDeFichier,
                taille: tailleLisible(dernier.taille, locale),
              })}
            </p>
          ) : null}
        </div>

        {versionDuPack ? (
          <p className="text-[10px] italic text-muted-foreground">
            {t("cab.export.source", { pack: versionDuPack })}
          </p>
        ) : null}
      </section>

      {/* ---- les exports récents */}
      <aside className="min-w-0 border border-border bg-card p-5">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("cab.export.recents")}
        </p>
        {historique.isPending ? (
          <p className="mt-3 text-[12px] text-muted-foreground">{t("common.loading")}</p>
        ) : (historique.data ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState>{t("cab.export.recents.vide")}</EmptyState>
          </div>
        ) : (
          <ul className="mt-3.5 flex flex-col gap-3">
            {(historique.data ?? []).map((h) => (
              <li
                key={h.id}
                className="flex items-baseline justify-between gap-3 border-t border-border pt-3"
              >
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">
                    {t("cab.export.recents.libelle", {
                      format: t(LIBELLE_DU_FORMAT[h.format]),
                      perimetre: h.clientNom ?? t("cab.export.recents.tous"),
                    })}
                  </span>
                  <span className="num mt-0.5 block text-[10.5px] text-muted-foreground">
                    {t("cab.export.recents.periode", {
                      du: dateLongue(h.du),
                      au: dateLongue(h.au),
                    })}
                  </span>
                  <span className="num mt-0.5 block text-[10.5px] text-muted-foreground">
                    {dateEtHeure(h.createdAt)} ·{" "}
                    {h.auteur ?? t("cab.export.recents.auteur.inconnu")}
                  </span>
                </span>
                <span className="num whitespace-nowrap text-end text-[11px] text-muted-foreground">
                  {t("cab.export.taille", {
                    count: h.lignes,
                    lignes: nombre(h.lignes),
                    taille: tailleLisible(h.taille, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
