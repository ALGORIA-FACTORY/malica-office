/**
 * Plan comptable et paramétrage du cabinet.
 *
 * Trois onglets, et la frontière entre eux est le sujet même de l'écran.
 *
 * « Plan NCT » montre la norme et ne la touche pas : 626 comptes, PAR CLASSE de
 * 1 à 7, comme un expert-comptable la lit. Un plan comptable ne se parcourt pas
 * par thème, il se parcourt par classe.
 *
 * « Personnalisation » est ce que le cabinet arrête au-dessus : les rôles qu'il
 * rebranche, et les subdivisions qu'il ouvre. Les 182 schémas d'écriture ne
 * citent jamais un numéro — ils citent un rôle. Rebrancher un rôle change
 * toutes les écritures qui l'emploient sans qu'aucun schéma ne bouge.
 *
 * « Tiers » est le grand livre auxiliaire, et il appartient au DOSSIER, pas au
 * cabinet. Un client de la PME A n'a rien à faire dans les livres de la PME B.
 * C'est pourquoi cet onglet demande d'abord de quel dossier on parle.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
  SignalLight,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import type { NatureTiers, RoleComptable } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/plan")({
  head: () => ({
    meta: [
      { title: "Plan comptable — Regalica Office" },
      {
        name: "description",
        content:
          "Plan comptable NCT par classe, personnalisation du cabinet, et grand livre auxiliaire des tiers.",
      },
      { property: "og:title", content: "Plan comptable — Regalica Office" },
      {
        property: "og:description",
        content:
          "Le plan NCT par classe, ce que le cabinet arrête, et les tiers de chaque dossier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanComptable,
});

type Onglet = "nct" | "personnalisation" | "tiers";

const CLASSES = ["1", "2", "3", "4", "5", "6", "7"] as const;

function PlanComptable() {
  const { t, locale } = useI18n();
  const [onglet, setOnglet] = useState<Onglet>("nct");

  useRegalicaPanel(
    <RegalicaNote kicker={t("plan.regalica.kicker")}>{t("plan.regalica")}</RegalicaNote>,
    [locale],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("plan.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("plan.lede")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["nct", "personnalisation", "tiers"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOnglet(o)}
            aria-pressed={onglet === o}
            className={`min-h-[44px] border px-3 text-xs uppercase tracking-wide ${
              onglet === o ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
          >
            {t(`plan.tab.${o}`)}
          </button>
        ))}
      </div>

      {onglet === "nct" ? <PlanNct /> : null}
      {onglet === "personnalisation" ? <Personnalisation /> : null}
      {onglet === "tiers" ? <TiersDuDossier /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ onglet 1 */

/**
 * La norme, par classe, en lecture seule.
 *
 * Aucun bouton : c'est le NCT, on le consulte. Ce qui s'y ajoute a sa place
 * dans l'onglet suivant, et l'écran doit rendre cette frontière évidente sans
 * avoir à l'expliquer.
 */
function PlanNct() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const [classe, setClasse] = useState<string>("1");
  const [cherche, setCherche] = useState("");

  const plan = useQuery({
    queryKey: ["param-plan", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
  });

  const lignes = useMemo(() => {
    const q = cherche.trim().toLowerCase();
    return (plan.data ?? [])
      .filter((c) => c.origine !== "cabinet")
      .filter((c) => (q ? true : c.classe === classe))
      .filter((c) => !q || c.code.includes(q) || c.libelle.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [plan.data, classe, cherche]);

  const parClasse = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of plan.data ?? [])
      if (c.origine !== "cabinet") n[c.classe] = (n[c.classe] ?? 0) + 1;
    return n;
  }, [plan.data]);

  return (
    <section className="space-y-3">
      <SectionTitle>{t("plan.nct.title")}</SectionTitle>
      <p className="text-[12px] text-muted-foreground">{t("plan.nct.lede")}</p>

      <div className="flex flex-wrap items-center gap-1">
        {CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setClasse(c);
              setCherche("");
            }}
            aria-pressed={classe === c && !cherche}
            className={`min-h-[36px] border px-3 text-[11px] uppercase tracking-wide ${
              classe === c && !cherche ? "border-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {t(`plan.classe.${c}`)}
            <span className="num ms-2 opacity-60">{parClasse[c] ?? 0}</span>
          </button>
        ))}
        <input
          value={cherche}
          onChange={(e) => setCherche(e.target.value)}
          placeholder={t("plan.search")}
          className="ms-auto min-h-[36px] w-48 border border-input bg-card px-2 text-[12px]"
        />
      </div>

      {plan.isPending ? (
        <EmptyState>{t("plan.loading")}</EmptyState>
      ) : lignes.length === 0 ? (
        <EmptyState>{t("plan.nct.empty")}</EmptyState>
      ) : (
        <InkTable
          caption={t("plan.nct.title")}
          head={[
            t("plan.col.code"),
            t("plan.col.libelle"),
            t("plan.col.parent"),
            t("plan.col.nature"),
          ]}
        >
          {lignes.map((c) => (
            <InkTableRow key={c.code}>
              <InkCell numeric>{c.code}</InkCell>
              <InkCell>
                {c.libelle}
                {c.source && c.origine === "extension" ? (
                  <span className="mt-1 block text-[11px] text-muted-foreground">{c.source}</span>
                ) : null}
              </InkCell>
              <InkCell numeric>{c.parent ?? "—"}</InkCell>
              <InkCell>
                <SignalLight
                  tone={c.officiel ? "neutral" : "ok"}
                  label={c.officiel ? t("plan.origin.officiel") : t("plan.origin.extension")}
                />
              </InkCell>
            </InkTableRow>
          ))}
        </InkTable>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ onglet 2 */

function Personnalisation() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [classe, setClasse] = useState<string>("");
  const [enEdition, setEnEdition] = useState<string | null>(null);

  const roles = useQuery({
    queryKey: ["param-roles", org.id],
    queryFn: () => office().parametrage.roles(org.id, null),
  });
  const plan = useQuery({
    queryKey: ["param-plan", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
  });

  const relier = useMutation({
    mutationFn: (v: { roleCode: string; compte: string }) =>
      office().parametrage.definirLiaison({
        tenantId: org.id,
        portee: "cabinet",
        porteeId: org.id,
        roleCode: v.roleCode,
        compte: v.compte,
      }),
    onSuccess: async () => {
      setEnEdition(null);
      await queryClient.invalidateQueries({ queryKey: ["param-roles", org.id] });
    },
  });

  const rendre = useMutation({
    mutationFn: (roleCode: string) =>
      office().parametrage.rendreAuPack({
        tenantId: org.id,
        portee: "cabinet",
        porteeId: org.id,
        roleCode,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["param-roles", org.id] });
    },
  });

  /** La classe d'un rôle est celle du compte qu'il admet — c'est le tri de l'expert. */
  function classeDuRole(r: RoleComptable) {
    return r.classesAdmises.length > 0 ? String(r.classesAdmises[0]) : "";
  }

  const lignes = useMemo(
    () =>
      (roles.data ?? [])
        .filter((r) => !classe || classeDuRole(r) === classe)
        .sort(
          (a, b) => classeDuRole(a).localeCompare(classeDuRole(b)) || a.code.localeCompare(b.code),
        ),
    [roles.data, classe],
  );

  function comptesPour(role: RoleComptable) {
    return (plan.data ?? [])
      .filter((c) => role.classesAdmises.includes(Number(c.classe)))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  const surcharges = (roles.data ?? []).filter((r) => r.origine === "cabinet").length;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="text-[12px] text-muted-foreground">
              {t("plan.summary")
                .replace("{surcharges}", String(surcharges))
                .replace("{total}", String(roles.data?.length ?? 0))}
            </span>
          }
        >
          {t("plan.roles.title")}
        </SectionTitle>
        <p className="text-[12px] text-muted-foreground">{t("plan.roles.lede")}</p>

        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setClasse("")}
            aria-pressed={classe === ""}
            className={`min-h-[36px] border px-2 text-[11px] uppercase tracking-wide ${
              classe === "" ? "border-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {t("plan.all")}
          </button>
          {CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setClasse(c)}
              aria-pressed={classe === c}
              className={`min-h-[36px] border px-2 text-[11px] uppercase tracking-wide ${
                classe === c ? "border-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {t(`plan.classe.${c}`)}
            </button>
          ))}
        </div>

        {roles.isPending ? (
          <EmptyState>{t("plan.loading")}</EmptyState>
        ) : lignes.length === 0 ? (
          <EmptyState>{t("plan.roles.empty")}</EmptyState>
        ) : (
          <InkTable
            caption={t("plan.roles.title")}
            head={[t("plan.col.role"), t("plan.col.compte"), t("plan.col.origine"), ""]}
          >
            {lignes.map((r) => (
              <InkTableRow key={r.code}>
                <InkCell>
                  <span className="font-medium">{r.libelle}</span>
                  <span className="block text-[11px] text-muted-foreground">{r.code}</span>
                  {r.note ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">{r.note}</span>
                  ) : null}
                </InkCell>

                <InkCell>
                  {enEdition === r.code ? (
                    <select
                      autoFocus
                      defaultValue={r.compte ?? ""}
                      onChange={(e) =>
                        e.target.value &&
                        relier.mutate({ roleCode: r.code, compte: e.target.value })
                      }
                      className="w-full border border-input bg-card px-2 py-1 text-[13px]"
                    >
                      <option value="">{t("plan.choose")}</option>
                      {comptesPour(r).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.libelle}
                          {c.origine === "cabinet" ? ` (${t("plan.origin.cabinet")})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <span className="num">{r.compte ?? "—"}</span>
                      {r.compteLibelle ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {r.compteLibelle}
                        </span>
                      ) : null}
                    </>
                  )}
                </InkCell>

                <InkCell>
                  <SignalLight
                    tone={r.origine === "aucun" ? "warn" : r.origine === "pack" ? "neutral" : "ok"}
                    label={t(`plan.origin.${r.origine}`)}
                  />
                  {r.origine === "cabinet" && r.defautDuPack ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {t("plan.wasDefault").replace("{compte}", r.defautDuPack)}
                    </span>
                  ) : null}
                  {r.origine === "pack" && r.justificationDuPack ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {r.justificationDuPack}
                    </span>
                  ) : null}
                </InkCell>

                <InkCell>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setEnEdition(enEdition === r.code ? null : r.code)}
                      className="min-h-[36px] border border-border px-2 text-[11px] uppercase tracking-wide"
                    >
                      {enEdition === r.code ? t("plan.cancel") : t("plan.change")}
                    </button>
                    {r.origine === "cabinet" ? (
                      <button
                        type="button"
                        onClick={() => rendre.mutate(r.code)}
                        className="min-h-[36px] border border-border px-2 text-[11px] uppercase tracking-wide text-muted-foreground"
                      >
                        {t("plan.restore")}
                      </button>
                    ) : null}
                  </div>
                </InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>

      <SousComptes />
    </div>
  );
}

/** Les subdivisions ouvertes par le cabinet, au-dessus de la norme. */
function SousComptes() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [parent, setParent] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const plan = useQuery({
    queryKey: ["param-plan", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
  });

  const ouvrir = useMutation({
    mutationFn: () =>
      office().parametrage.ouvrirCompte({
        tenantId: org.id,
        code: code.trim(),
        libelle: libelle.trim(),
        parent: parent.trim(),
      }),
    onSuccess: async () => {
      setCode("");
      setLibelle("");
      setParent("");
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["param-plan", org.id] });
    },
    // Le message vient de la base : ce sont ses quatre règles, et elles savent
    // mieux que l'écran pourquoi elles refusent.
    onError: (e) => setErreur(e instanceof Error ? e.message : String(e)),
  });

  const miens = (plan.data ?? [])
    .filter((c) => c.origine === "cabinet")
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <section className="space-y-3">
      <SectionTitle>{t("plan.sous.title")}</SectionTitle>
      <p className="text-[12px] text-muted-foreground">{t("plan.sous.lede")}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ouvrir.mutate();
        }}
        className="grid gap-2 border border-border bg-card p-3 sm:grid-cols-[8rem_8rem_1fr_auto]"
      >
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("plan.field.parent")}
          </span>
          <input
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            required
            placeholder="601"
            className="num mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("plan.field.code")}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="6011"
            className="num mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("plan.field.libelle")}
          </span>
          <input
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            required
            className="mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
          />
        </label>
        <button
          type="submit"
          disabled={ouvrir.isPending}
          className="min-h-[44px] self-end border border-foreground bg-foreground px-3 text-xs uppercase tracking-wide text-background disabled:opacity-40"
        >
          {t("plan.open")}
        </button>
      </form>

      {erreur ? <p className="text-[12px] text-signal-warn">{erreur}</p> : null}

      {miens.length === 0 ? (
        <EmptyState>{t("plan.sous.empty")}</EmptyState>
      ) : (
        <InkTable
          caption={t("plan.sous.title")}
          head={[t("plan.col.code"), t("plan.col.libelle"), t("plan.col.parent"), ""]}
        >
          {miens.map((c) => (
            <InkTableRow key={c.code}>
              <InkCell numeric>{c.code}</InkCell>
              <InkCell>{c.libelle}</InkCell>
              <InkCell numeric>{c.parent}</InkCell>
              <InkCell>
                <button
                  type="button"
                  onClick={async () => {
                    await office().parametrage.fermerCompte(org.id, c.code);
                    await queryClient.invalidateQueries({ queryKey: ["param-plan", org.id] });
                  }}
                  className="min-h-[36px] border border-border px-2 text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  {t("plan.close")}
                </button>
              </InkCell>
            </InkTableRow>
          ))}
        </InkTable>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ onglet 3 */

const NATURES: NatureTiers[] = ["client", "fournisseur", "salarie", "associe", "compte_bancaire"];

/**
 * Les tiers d'un dossier.
 *
 * On demande le dossier avant tout : un tiers appartient aux livres d'une PME,
 * pas à ceux du cabinet. Sans ce choix, l'écran laisserait croire à un fichier
 * clients commun — ce qui serait faux, et le resterait jusqu'au jour où
 * quelqu'un s'en apercevrait dans une balance.
 */
function TiersDuDossier() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [dossier, setDossier] = useState<string>("");
  const [nature, setNature] = useState<NatureTiers>("client");
  const [code, setCode] = useState("");
  const [raison, setRaison] = useState("");
  const [collectif, setCollectif] = useState("");
  const [matricule, setMatricule] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const collectifs = useQuery({
    queryKey: ["comptes-collectifs"],
    queryFn: () => office().tiers.comptesCollectifs(),
  });

  const liste = useQuery({
    queryKey: ["tiers", dossier, nature],
    queryFn: () => office().tiers.lister(dossier, nature),
    enabled: Boolean(dossier),
  });

  const creer = useMutation({
    mutationFn: () =>
      office().tiers.creer({
        tenantId: dossier,
        nature,
        code,
        raisonSociale: raison,
        compteCollectif: collectif,
        identifiantFiscal: matricule || null,
      }),
    onSuccess: async () => {
      setCode("");
      setRaison("");
      setMatricule("");
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["tiers", dossier, nature] });
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : String(e)),
  });

  return (
    <section className="space-y-4">
      <SectionTitle>{t("plan.tiers.title")}</SectionTitle>
      <p className="text-[12px] text-muted-foreground">{t("plan.tiers.lede")}</p>

      <label className="block max-w-md">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("plan.tiers.dossier")}
        </span>
        <select
          value={dossier}
          onChange={(e) => setDossier(e.target.value)}
          className="mt-1 w-full border border-input bg-card px-2 py-2 text-[13px]"
        >
          <option value="">{t("plan.tiers.chooseDossier")}</option>
          {(clients.data ?? []).map((c) => (
            <option key={c.tenantId} value={c.tenantId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {!dossier ? (
        <EmptyState>{t("plan.tiers.noDossier")}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {NATURES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNature(n)}
                aria-pressed={nature === n}
                className={`min-h-[36px] border px-2 text-[11px] uppercase tracking-wide ${
                  nature === n ? "border-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {t(`plan.nature.${n}`)}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              creer.mutate();
            }}
            className="grid gap-2 border border-border bg-card p-3 sm:grid-cols-[7rem_1fr_9rem_10rem_auto]"
          >
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("plan.col.code")}
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="DREAMOPTIC"
                className="mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("plan.tiers.raison")}
              </span>
              <input
                value={raison}
                onChange={(e) => setRaison(e.target.value)}
                required
                className="mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("plan.tiers.matricule")}
              </span>
              <input
                value={matricule}
                onChange={(e) => setMatricule(e.target.value)}
                className="num mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("plan.tiers.collectif")}
              </span>
              <select
                value={collectif}
                onChange={(e) => setCollectif(e.target.value)}
                required
                className="mt-1 w-full border border-input bg-card px-2 py-1 text-[13px]"
              >
                <option value="">{t("plan.choose")}</option>
                {(collectifs.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.libelle}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creer.isPending}
              className="min-h-[44px] self-end border border-foreground bg-foreground px-3 text-xs uppercase tracking-wide text-background disabled:opacity-40"
            >
              {t("plan.tiers.add")}
            </button>
          </form>

          {erreur ? <p className="text-[12px] text-signal-warn">{erreur}</p> : null}

          {liste.isPending ? (
            <EmptyState>{t("plan.loading")}</EmptyState>
          ) : (liste.data ?? []).length === 0 ? (
            <EmptyState>{t("plan.tiers.empty")}</EmptyState>
          ) : (
            <InkTable
              caption={t("plan.tiers.title")}
              head={[
                t("plan.col.code"),
                t("plan.tiers.raison"),
                t("plan.tiers.matricule"),
                t("plan.tiers.collectif"),
                "",
              ]}
            >
              {(liste.data ?? []).map((x) => (
                <InkTableRow key={x.id}>
                  <InkCell numeric>{x.code}</InkCell>
                  <InkCell>
                    {x.raisonSociale}
                    {!x.actif ? (
                      <span className="ms-2 text-[11px] text-muted-foreground">
                        {t("plan.tiers.inactive")}
                      </span>
                    ) : null}
                  </InkCell>
                  <InkCell numeric>{x.identifiantFiscal ?? "—"}</InkCell>
                  <InkCell>
                    <span className="num">{x.compteCollectif}</span>
                    {x.compteLibelle ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {x.compteLibelle}
                      </span>
                    ) : null}
                  </InkCell>
                  <InkCell>
                    <button
                      type="button"
                      onClick={async () => {
                        await office().tiers.desactiver(x.id, !x.actif);
                        await queryClient.invalidateQueries({
                          queryKey: ["tiers", dossier, nature],
                        });
                      }}
                      className="min-h-[36px] border border-border px-2 text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      {x.actif ? t("plan.tiers.deactivate") : t("plan.tiers.reactivate")}
                    </button>
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          )}
        </>
      )}
    </section>
  );
}
