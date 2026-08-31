/**
 * Le plan comptable du cabinet — volet 1 du paramétrage.
 *
 * Deux onglets, parce que ce sont deux gestes différents.
 *
 * « Rôles » est le geste courant : les 182 schémas d'écriture ne citent jamais
 * un numéro, ils citent un RÔLE — « le timbre collecté », « la TVA
 * déductible ». Rebrancher un rôle change toutes les écritures qui l'emploient,
 * sans qu'aucun schéma ne bouge.
 *
 * « Comptes » est le geste rare : ouvrir une subdivision que NC 01 ne prévoit
 * pas, parce qu'un cabinet suit ses chantiers ou ses agences séparément.
 *
 * Ce que cet écran affiche toujours, et qui n'est pas décoratif : l'ORIGINE de
 * chaque compte. « 4371 » ne dit rien ; « 4371, livré par le pack » et « 4371,
 * arrêté par votre cabinet » ne disent pas la même chose à qui relit un dossier
 * six mois plus tard.
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
import type { RoleComptable } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/plan")({
  head: () => ({
    meta: [
      { title: "Plan comptable — Regalica Office" },
      {
        name: "description",
        content:
          "Paramétrage du plan comptable du cabinet : rôles reliés aux comptes, subdivisions ouvertes, origine de chaque choix.",
      },
      { property: "og:title", content: "Plan comptable — Regalica Office" },
      {
        property: "og:description",
        content: "Rôles reliés aux comptes, subdivisions du cabinet, origine de chaque choix.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanComptable,
});

/** Le ton d'un choix : livré, arrêté par le cabinet, ou non tranché. */
function tonOrigine(origine: RoleComptable["origine"]) {
  if (origine === "aucun") return "warn" as const;
  if (origine === "pack") return "neutral" as const;
  return "ok" as const;
}

function PlanComptable() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [onglet, setOnglet] = useState<"roles" | "comptes">("roles");
  const [famille, setFamille] = useState<string>("");
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

  useRegalicaPanel(
    <RegalicaNote kicker={t("plan.regalica.kicker")}>{t("plan.regalica")}</RegalicaNote>,
    [locale],
  );

  const familles = useMemo(
    () => [...new Set((roles.data ?? []).map((r) => r.famille))].sort(),
    [roles.data],
  );

  const lignes = useMemo(
    () => (roles.data ?? []).filter((r) => !famille || r.famille === famille),
    [roles.data, famille],
  );

  /** Les comptes proposés pour un rôle : ceux de ses classes admises, et rien d'autre. */
  function comptesPour(role: RoleComptable) {
    return (plan.data ?? []).filter((c) => role.classesAdmises.includes(Number(c.classe)));
  }

  const surcharges = (roles.data ?? []).filter((r) => r.origine === "cabinet").length;
  const sansCompte = (roles.data ?? []).filter((r) => r.origine === "aucun").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("plan.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("plan.lede")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["roles", "comptes"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOnglet(o)}
            aria-pressed={onglet === o}
            className={`min-h-[44px] border px-3 text-xs uppercase tracking-wide ${
              onglet === o ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
          >
            {o === "roles" ? t("plan.tab.roles") : t("plan.tab.comptes")}
          </button>
        ))}
        <span className="ms-auto text-[12px] text-muted-foreground">
          {t("plan.summary")
            .replace("{surcharges}", String(surcharges))
            .replace("{total}", String(roles.data?.length ?? 0))}
          {sansCompte > 0
            ? ` · ${t("plan.summary.missing").replace("{n}", String(sansCompte))}`
            : ""}
        </span>
      </div>

      {onglet === "roles" ? (
        <section className="space-y-3">
          <SectionTitle>{t("plan.roles.title")}</SectionTitle>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFamille("")}
              aria-pressed={famille === ""}
              className={`min-h-[36px] border px-2 text-[11px] uppercase tracking-wide ${
                famille === "" ? "border-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {t("plan.all")}
            </button>
            {familles.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFamille(f)}
                aria-pressed={famille === f}
                className={`min-h-[36px] border px-2 text-[11px] uppercase tracking-wide ${
                  famille === f ? "border-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {f}
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
              head={[
                t("plan.col.role"),
                t("plan.col.compte"),
                t("plan.col.origine"),
                t("plan.col.action"),
              ]}
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
                      tone={tonOrigine(r.origine)}
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
      ) : (
        <ComptesDuCabinet />
      )}
    </div>
  );
}

/** L'onglet des comptes : le plan livré, et ce que le cabinet y ajoute. */
function ComptesDuCabinet() {
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

  const miens = (plan.data ?? []).filter((c) => c.origine === "cabinet");

  return (
    <section className="space-y-4">
      <SectionTitle>{t("plan.comptes.title")}</SectionTitle>
      <p className="text-[12px] text-muted-foreground">{t("plan.comptes.lede")}</p>

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
        <EmptyState>{t("plan.comptes.empty")}</EmptyState>
      ) : (
        <InkTable
          caption={t("plan.comptes.title")}
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

      <p className="text-[12px] text-muted-foreground">
        {t("plan.comptes.officiels").replace(
          "{n}",
          String((plan.data ?? []).length - miens.length),
        )}
      </p>
    </section>
  );
}
