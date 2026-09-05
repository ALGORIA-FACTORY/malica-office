/**
 * Les réglages du cabinet — ce qu'il délègue, ce qu'il garde à la main.
 *
 * ============================================================== POURQUOI
 *
 * Deux onglets. « Cabinet et équipe » lit les seuils en base et les défauts
 * du Socle quand rien n'est réglé ; chaque valeur affichée vient d'une
 * requête, jamais d'une constante. « Calendrier des échéances » dit quelles
 * obligations du pack le cabinet suit, par secteur et par exercice, avec
 * quel rappel — et lui laisse ajouter une obligation qui n'existe que pour
 * ses mandats. Le nombre de mandats concernés se compte depuis les fiches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { IntegrationsEtApi } from "@/components/regalica/integrations-panel";
import { EmptyState, RegalicaNote, SectionTitle } from "@/components/regalica/office-ui";
import {
  definirPanneauParDefaut,
  panneauOuvertParDefaut,
} from "@/components/regalica/panneau-regalica";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type {
  ObligationDuCalendrier,
  ReglagesCabinet,
} from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/reglages")({
  head: () => ({
    meta: [
      { title: "Réglages du cabinet — Regalica Office" },
      {
        name: "description",
        content:
          "Seuils de supervision, pack de juridiction, ton de Regalica, équipe et calendrier des obligations du cabinet.",
      },
      { property: "og:title", content: "Réglages du cabinet — Regalica Office" },
      {
        property: "og:description",
        content: "Seuils, pack, équipe et calendrier des obligations du cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetReglages,
});

type Onglet = "cabinet" | "calendrier" | "integrations";
const TOUTES = "*";
const PERIODICITES: Record<string, MessageKey> = {
  mensuelle: "cab.settings.cal.periodicite.mensuelle",
  trimestrielle: "cab.settings.cal.periodicite.trimestrielle",
  annuelle: "cab.settings.cal.periodicite.annuelle",
};
const TONS: Record<string, MessageKey> = {
  sobre: "cab.settings.ton.sobre",
  chaleureux: "cab.settings.ton.chaleureux",
};
/**
 * Les rappels que le cabinet peut choisir, en jours avant la date limite.
 * Un choix d'écran, pas un défaut : le défaut vient de la base, et il figure
 * toujours dans la liste parce qu'on y ajoute la valeur réglée.
 */
/** Les formes et modes que le référentiel des obligations distingue. */
const VISEES: Record<string, MessageKey> = {
  physique: "cab.settings.cal.vise.physique",
  morale: "cab.settings.cal.vise.morale",
  papier: "cab.settings.cal.vise.papier",
  electronique: "cab.settings.cal.vise.electronique",
};

/** À qui l'obligation s'applique, dans la langue de la personne — ou « tous ». */
function viseeDe(
  o: ObligationDuCalendrier,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  const parts = [o.formeJuridique, o.modeDepot]
    .filter((v): v is string => Boolean(v))
    .map((v) => (VISEES[v] ? t(VISEES[v]!) : v));
  if (o.regime) parts.push(t("cab.settings.cal.vise.regime", { regime: o.regime }));
  return parts.length > 0 ? parts.join(" · ") : t("cab.settings.cal.vise.tous");
}
const RAPPELS = [15, 10, 7, 3];
const OU = "routes/_authenticated/cabinet.reglages";

function CabinetReglages() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [onglet, setOnglet] = useState<Onglet>("cabinet");

  useRegalicaPanel(<RegalicaNote>{t("cab.settings.panel")}</RegalicaNote>, [locale]);

  const classeOnglet = (actif: boolean) =>
    cn(
      "whitespace-nowrap border-b-2 py-2.5 text-[12.5px]",
      actif
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-8">
      <header className="border-b border-foreground">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {t("cab.settings.kicker", { cabinet: org.name })}
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {t("cab.settings.title")}
        </h1>
        <nav className="mt-6 flex gap-5 overflow-x-auto" aria-label={t("cab.settings.title")}>
          <button
            type="button"
            className={classeOnglet(onglet === "cabinet")}
            aria-current={onglet === "cabinet" ? "page" : undefined}
            onClick={() => setOnglet("cabinet")}
          >
            {t("cab.settings.tab.cabinet")}
          </button>
          <button
            type="button"
            className={classeOnglet(onglet === "calendrier")}
            aria-current={onglet === "calendrier" ? "page" : undefined}
            onClick={() => setOnglet("calendrier")}
          >
            {t("cab.settings.tab.calendrier")}
          </button>
          <button
            type="button"
            className={classeOnglet(onglet === "integrations")}
            aria-current={onglet === "integrations" ? "page" : undefined}
            onClick={() => setOnglet("integrations")}
          >
            {t("cab.settings.tab.integrations")}
          </button>
        </nav>
      </header>

      {onglet === "cabinet" ? (
        <CabinetEtEquipe />
      ) : onglet === "calendrier" ? (
        <CalendrierDesEcheances />
      ) : (
        <IntegrationsEtApi />
      )}
    </div>
  );
}

/* ====================================================== cabinet et équipe */

function CabinetEtEquipe() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const plan = useQuery({
    queryKey: ["plan", org.id, null],
    queryFn: () => office().parametrage.plan(org.id, null),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const invitations = useQuery({
    queryKey: ["cab-invitations", org.id],
    queryFn: () => office().collab.invitations(org.id),
  });
  const enAttente = (invitations.data ?? []).filter(
    (i) => !i.acceptedAt && i.expiresAt > new Date().toISOString(),
  );

  /* ---- le formulaire, semé une fois depuis la base */
  const [seuilLot, setSeuilLot] = useState("");
  const [seuilRevue, setSeuilRevue] = useState("");
  const [doubleValidation, setDoubleValidation] = useState("");
  const [proactives, setProactives] = useState(true);
  const [capacite, setCapacite] = useState("");
  const [ton, setTon] = useState("");
  const [panneau, setPanneau] = useState(true);
  const [seme, setSeme] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const r = reglages.data;
    if (!r || seme) return;
    setSeuilLot(String(Math.round(r.seuilConfianceLot * 100)));
    setSeuilRevue(String(Math.round(r.seuilConfianceRevue * 100)));
    setDoubleValidation(r.doubleValidationAuDela ?? "");
    setProactives(r.propositionsProactives);
    setCapacite(String(r.capaciteDossiers));
    setTon(r.ton);
    setPanneau(panneauOuvertParDefaut("cabinet"));
    setSeme(true);
  }, [reglages.data, seme]);

  const enregistrer = useMutation({
    // Les réglages lus sont passés en argument : on ne réenregistre jamais
    // sans les avoir lus, et le seuil du conseil — réglé depuis l'écran
    // Conseil — se reconduit tel que la base le rend.
    mutationFn: (courant: ReglagesCabinet) =>
      office().parametrage.definirReglagesCabinet({
        tenantId: org.id,
        seuilConfianceLot: Number(seuilLot) / 100,
        seuilConfianceRevue: Number(seuilRevue) / 100,
        doubleValidationAuDela: doubleValidation.trim() === "" ? null : doubleValidation.trim(),
        propositionsProactives: proactives,
        capaciteDossiers: Number(capacite),
        ton,
        seuilCertitudeConseil: courant.seuilCertitudeConseil,
      }),
    onSuccess: async () => {
      setErreur(null);
      setMessage(t("cab.settings.enregistre"));
      await qc.invalidateQueries({ queryKey: ["cab-reglages", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const extensions = (plan.data ?? []).filter((c) => c.origine === "cabinet").length;
  const emails = (membres.data ?? []).map((m) => m.email);

  if (reglages.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (reglages.isError) {
    return (
      <p role="alert" className="text-[12.5px] text-signal-stop">
        {texteDeLErreur(reglages.error, OU, t("common.error"))}
      </p>
    );
  }
  const courant = reglages.data;

  return (
    <div className="space-y-8">
      {!courant.regle ? (
        <p className="border border-s-2 border-border border-s-marigold bg-card px-3 py-2 text-[12.5px]">
          {t("cab.settings.defauts")}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---- supervision */}
        <Groupe titre={t("cab.settings.g.supervision")} lede={t("cab.settings.g.supervision.lede")}>
          <Ligne label={t("cab.settings.seuilLot")} hint={t("cab.settings.seuilLot.hint")}>
            <Pourcentage
              valeur={seuilLot}
              onChange={setSeuilLot}
              label={t("cab.settings.seuilLot")}
            />
          </Ligne>
          <Ligne label={t("cab.settings.seuilRevue")} hint={t("cab.settings.seuilRevue.hint")}>
            <Pourcentage
              valeur={seuilRevue}
              onChange={setSeuilRevue}
              label={t("cab.settings.seuilRevue")}
            />
          </Ligne>
        </Groupe>

        {/* ---- pack */}
        <Groupe titre={t("cab.settings.g.pack")} lede={t("cab.settings.g.pack.lede")}>
          <Ligne label={t("cab.settings.packActif")} hint={t("cab.settings.packActif.hint")}>
            <span className="num text-[13px]">
              {pack.data
                ? `${org.jurisdiction} ${pack.data.version}`
                : t("cab.settings.packActif.absent")}
            </span>
          </Ligne>
          <Ligne label={t("cab.settings.extensions")} hint={t("cab.settings.extensions.hint")}>
            <span className="num text-[13px]">{plan.isPending ? "…" : extensions}</span>
          </Ligne>
        </Groupe>

        {/* ---- Regalica */}
        <Groupe titre={t("cab.settings.g.regalica")} lede={t("cab.settings.g.regalica.lede")}>
          <Ligne label={t("cab.settings.panneau")} hint={t("cab.settings.panneau.hint")}>
            <Interrupteur
              actif={panneau}
              label={t("cab.settings.panneau")}
              onChange={(v) => {
                setPanneau(v);
                definirPanneauParDefaut("cabinet", v);
              }}
            />
          </Ligne>
          <Ligne label={t("cab.settings.proactives")} hint={t("cab.settings.proactives.hint")}>
            <Interrupteur
              actif={proactives}
              label={t("cab.settings.proactives")}
              onChange={setProactives}
            />
          </Ligne>
          <Ligne label={t("cab.settings.ton")} hint={t("cab.settings.ton.hint")}>
            <select
              value={ton}
              onChange={(e) => setTon(e.target.value)}
              aria-label={t("cab.settings.ton")}
              className="border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
            >
              {Object.keys(TONS).map((code) => (
                <option key={code} value={code}>
                  {t(TONS[code]!)}
                </option>
              ))}
            </select>
          </Ligne>
        </Groupe>

        {/* ---- équipe */}
        <Groupe titre={t("cab.settings.g.equipe")} lede={t("cab.settings.g.equipe.lede")}>
          <Ligne label={t("cab.settings.collaborateurs")} hint={emails.join(" · ")}>
            <span className="num text-[13px]">{membres.isPending ? "…" : emails.length}</span>
          </Ligne>
          <Ligne
            label={t("cab.settings.invitations")}
            hint={
              enAttente.length > 0
                ? enAttente.map((i) => i.email).join(" · ")
                : t("cab.settings.invitations.hint")
            }
          >
            <span className="flex items-center gap-3">
              <span className="num text-[13px]">
                {invitations.isPending ? "…" : enAttente.length}
              </span>
              <Link
                to="/cabinet/mise-en-route"
                className="border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] hover:border-foreground"
              >
                {t("cab.settings.inviter")}
              </Link>
            </span>
          </Ligne>
          <Ligne
            label={t("cab.settings.doubleValidation")}
            hint={t("cab.settings.doubleValidation.hint")}
          >
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step="0.001"
                value={doubleValidation}
                onChange={(e) => setDoubleValidation(e.target.value)}
                aria-label={t("cab.settings.doubleValidation")}
                className="num w-[120px] border border-border bg-card px-2 py-1.5 text-end text-[12.5px]"
              />
              <span className="text-[11px] text-muted-foreground">{org.currency}</span>
            </span>
          </Ligne>
          <Ligne label={t("cab.settings.capacite")} hint={t("cab.settings.capacite.hint")}>
            <input
              type="number"
              min={1}
              step={1}
              value={capacite}
              onChange={(e) => setCapacite(e.target.value)}
              aria-label={t("cab.settings.capacite")}
              className="num w-[72px] border border-border bg-card px-2 py-1.5 text-end text-[12.5px]"
            />
          </Ligne>
        </Groupe>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={enregistrer.isPending || !seuilLot || !seuilRevue || !capacite || !ton}
          onClick={() => enregistrer.mutate(courant)}
          className="border border-foreground bg-foreground px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:text-foreground disabled:opacity-40"
        >
          {t("cab.settings.enregistrer")}
        </button>
        {message ? <span className="text-[12.5px] text-signal-ok">{message}</span> : null}
        {erreur ? (
          <span role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </span>
        ) : null}
        {courant.doubleValidationAuDela ? (
          <span className="num text-[11px] text-muted-foreground">
            {montant(courant.doubleValidationAuDela, locale)} {org.currency}
          </span>
        ) : null}
      </div>

      {/* ---- le parcours de mise en route : un parcours qu'on rejoue si besoin */}
      <section className="border border-border bg-card p-4">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("cab.settings.onb.titre")}
        </p>
        <p className="mt-1 max-w-[70ch] text-[12.5px] leading-[1.5] text-text-2">
          {t("cab.settings.onb.lede")}
        </p>
        <Link
          to="/cabinet/mise-en-route"
          className="mt-3 inline-block border border-foreground px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
        >
          {t("cab.settings.onb.rejouer")}
        </Link>
      </section>
    </div>
  );
}

function Groupe({
  titre,
  lede,
  children,
}: {
  titre: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {titre}
        </p>
        <p className="mt-1 text-[12px] text-text-2">{lede}</p>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Ligne({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-[13px]">{label}</dt>
        <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</dd>
      </div>
      <dd className="shrink-0">{children}</dd>
    </div>
  );
}

function Pourcentage({
  valeur,
  onChange,
  label,
}: {
  valeur: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="num w-[64px] border border-border bg-card px-2 py-1.5 text-end text-[12.5px]"
      />
      <span className="text-[11px] text-muted-foreground">%</span>
    </span>
  );
}

function Interrupteur({
  actif,
  label,
  onChange,
}: {
  actif: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={label}
      onClick={() => onChange(!actif)}
      className={cn(
        "relative h-[20px] w-[36px] border transition-colors",
        actif ? "border-foreground bg-foreground" : "border-border bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[3px] h-[12px] w-[12px] transition-[inset-inline-start]",
          actif ? "bg-marigold" : "bg-border",
        )}
        style={{ insetInlineStart: actif ? "20px" : "3px" }}
      />
    </button>
  );
}

/* ================================================== calendrier des échéances */

function CalendrierDesEcheances() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const anneeCourante = new Date().getUTCFullYear();
  const exercices = useMemo(
    () => [anneeCourante - 1, anneeCourante, anneeCourante + 1],
    [anneeCourante],
  );
  const [exercice, setExercice] = useState(anneeCourante);
  const [secteur, setSecteur] = useState(TOUTES);
  const [erreur, setErreur] = useState<string | null>(null);

  const secteurs = useQuery({
    queryKey: ["cab-secteurs", org.id],
    queryFn: () => office().parametrage.secteursDuCabinet(org.id),
  });
  const calendrier = useQuery({
    queryKey: ["cab-calendrier", org.id, exercice, secteur],
    queryFn: () => office().parametrage.calendrierCabinet(org.id, exercice, secteur),
  });

  const rafraichir = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["cab-calendrier", org.id] }),
      // Les calendriers des dossiers en dépendent : ils se redérivent.
      qc.invalidateQueries({ queryKey: ["cab-echeances-derivation"] }),
      qc.invalidateQueries({ queryKey: ["cab-echeances"] }),
    ]);

  const regler = useMutation({
    mutationFn: (input: { code: string; active: boolean; rappelJours: number }) =>
      office().parametrage.definirObligation({
        tenantId: org.id,
        code: input.code,
        exercice,
        secteur,
        active: input.active,
        rappelJours: input.rappelJours,
      }),
    onSuccess: async () => {
      setErreur(null);
      await rafraichir();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const rows = calendrier.data ?? [];
  const actives = rows.filter((o) => o.active).length;
  // Une lecture qui échoue se dit ; sinon l'écran ressemblerait à un calendrier vide.
  const echec = calendrier.error ?? secteurs.error ?? null;

  const baseLegale = (o: ObligationDuCalendrier) =>
    o.propre
      ? t("cab.settings.cal.scope.propre")
      : [o.article, o.texteSource].filter(Boolean).join(" · ");
  const jourLimite = (o: ObligationDuCalendrier) =>
    o.echeanceMois
      ? `${String(o.echeanceJour).padStart(2, "0")}/${String(o.echeanceMois).padStart(2, "0")}`
      : String(o.echeanceJour);

  return (
    <div className="space-y-8">
      <p className="max-w-[70ch] text-[13.5px] leading-[1.55] text-text-2">
        {t("cab.settings.cal.lede")}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.exercice")}
          </span>
          <select
            value={exercice}
            onChange={(e) => setExercice(Number(e.target.value))}
            className="num border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
          >
            {exercices.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.secteur")}
          </span>
          <select
            value={secteur}
            onChange={(e) => setSecteur(e.target.value)}
            className="border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
          >
            <option value={TOUTES}>{t("cab.settings.cal.general")}</option>
            {(secteurs.data ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-muted-foreground">
          {secteur === TOUTES
            ? t("cab.settings.cal.lede.general", { exercice })
            : t("cab.settings.cal.lede.secteur", { secteur, exercice })}
        </p>
      </div>

      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="num text-[10.5px] text-muted-foreground">
              {t("cab.settings.cal.resume", {
                count: actives,
                actives,
                total: rows.length,
                exercice,
              })}
            </span>
          }
        >
          {t("cab.settings.cal.titre")}
        </SectionTitle>

        {echec ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {texteDeLErreur(echec, OU, t("common.error"))}
          </p>
        ) : null}
        {erreur ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </p>
        ) : null}

        {calendrier.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.settings.cal.vide")}</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-border bg-card">
            <table className="min-w-full border-collapse text-[12.5px]">
              <caption className="sr-only">{t("cab.settings.cal.titre")}</caption>
              <thead>
                <tr className="border-b border-foreground">
                  {[
                    t("cab.settings.cal.col.active"),
                    t("cab.settings.cal.col.obligation"),
                    t("cab.settings.cal.col.legal"),
                    t("cab.settings.cal.col.periodicite"),
                    t("cab.settings.cal.col.jour"),
                    t("cab.settings.cal.col.rappel"),
                    t("cab.settings.cal.col.mandats"),
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                        i >= 4 ? "text-end" : "text-start",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.code}
                    className={cn(
                      "border-b border-border",
                      o.active ? "" : "text-muted-foreground",
                    )}
                  >
                    <td className="px-3 py-2">
                      <Interrupteur
                        actif={o.active}
                        label={o.libelle}
                        onChange={(v) =>
                          regler.mutate({ code: o.code, active: v, rappelJours: o.rappelJours })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="block font-medium">{o.libelle}</span>
                      <span
                        className={cn(
                          "block text-[10.5px]",
                          o.propre ? "text-marigold-on-paper" : "text-muted-foreground",
                        )}
                      >
                        {o.propre
                          ? t("cab.settings.cal.scope.propre")
                          : o.secteur === TOUTES
                            ? t("cab.settings.cal.scope.toutes")
                            : t("cab.settings.cal.scope.secteur")}
                      </span>
                      {/* Trois « Déclaration mensuelle TVA » ne se distinguent que
                          par qui elles visent : la forme, le mode de dépôt, le régime. */}
                      {o.propre ? null : (
                        <span className="block text-[10.5px] text-muted-foreground">
                          {viseeDe(o, t)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2" title={o.regle}>
                      <span className="num block text-[11px] text-signal-info">
                        {baseLegale(o)}
                      </span>
                      <span className="block max-w-[34ch] text-[10.5px] leading-[1.35] text-muted-foreground">
                        {o.regle}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {PERIODICITES[o.periodicite]
                        ? t(PERIODICITES[o.periodicite]!)
                        : o.periodicite}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-end">{jourLimite(o)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      <select
                        value={o.rappelJours}
                        disabled={!o.active}
                        aria-label={t("cab.settings.cal.col.rappel")}
                        onChange={(e) =>
                          regler.mutate({
                            code: o.code,
                            active: o.active,
                            rappelJours: Number(e.target.value),
                          })
                        }
                        className="num border border-border bg-card px-1.5 py-1 text-[11px] disabled:opacity-50"
                      >
                        {[...new Set([...RAPPELS, o.rappelJours])]
                          .sort((a, b) => b - a)
                          .map((j) => (
                            <option key={j} value={j}>
                              {t("cab.settings.cal.rappel.j", { days: j })}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-end">{o.mandats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ObligationPropre secteur={secteur} onAjoutee={rafraichir} />
    </div>
  );
}

function ObligationPropre({
  secteur,
  onAjoutee,
}: {
  secteur: string;
  onAjoutee: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const [libelle, setLibelle] = useState("");
  const [periodicite, setPeriodicite] = useState("mensuelle");
  const [jour, setJour] = useState("");
  const [mois, setMois] = useState("");
  const [regle, setRegle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = useMutation({
    mutationFn: () =>
      office().parametrage.creerObligationPropre({
        tenantId: org.id,
        libelle: libelle.trim(),
        periodicite,
        echeanceJour: Number(jour),
        echeanceMois: periodicite === "annuelle" ? Number(mois) : null,
        regle: regle.trim(),
        secteur,
      }),
    onSuccess: async () => {
      setErreur(null);
      setMessage(t("cab.settings.cal.propre.ajoutee"));
      setLibelle("");
      setJour("");
      setMois("");
      setRegle("");
      await onAjoutee();
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const pret =
    libelle.trim() !== "" &&
    regle.trim() !== "" &&
    jour !== "" &&
    (periodicite !== "annuelle" || mois !== "");
  const champ =
    "border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <section className="border border-s-2 border-border border-s-marigold bg-card p-4">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {t("cab.settings.cal.propre.titre")}
      </p>
      <p className="mt-1 text-[12px] text-text-2">{t("cab.settings.cal.propre.lede")}</p>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.propre.libelle")}
          </span>
          <input value={libelle} onChange={(e) => setLibelle(e.target.value)} className={champ} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.col.periodicite")}
          </span>
          <select
            value={periodicite}
            onChange={(e) => setPeriodicite(e.target.value)}
            className={champ}
          >
            {Object.keys(PERIODICITES).map((p) => (
              <option key={p} value={p}>
                {t(PERIODICITES[p]!)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.propre.jour")}
          </span>
          <input
            type="number"
            min={1}
            max={28}
            value={jour}
            onChange={(e) => setJour(e.target.value)}
            className={cn(champ, "num")}
          />
        </label>
        {periodicite === "annuelle" ? (
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cab.settings.cal.propre.mois")}
            </span>
            <input
              type="number"
              min={1}
              max={12}
              value={mois}
              onChange={(e) => setMois(e.target.value)}
              className={cn(champ, "num")}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 sm:col-span-2 xl:col-span-4">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.settings.cal.propre.regle")}
          </span>
          <input value={regle} onChange={(e) => setRegle(e.target.value)} className={champ} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!pret || creer.isPending}
          onClick={() => creer.mutate()}
          className="border border-foreground px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background disabled:opacity-40"
        >
          {t("cab.settings.cal.propre.ajouter")}
        </button>
        {message ? <span className="text-[12.5px] text-signal-ok">{message}</span> : null}
        {erreur ? (
          <span role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </span>
        ) : null}
      </div>
    </section>
  );
}
