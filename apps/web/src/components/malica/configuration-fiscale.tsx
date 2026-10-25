import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { ConfigurationFiscale, RegleFiscale } from "@malica/socle/ports/fiscalite";

const CHAMP =
  "mt-1 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const FAMILLES = ["tva", "timbre", "fodec", "retenue", "autre"] as const;
const OPERATIONS = ["achat", "vente", "paiement_emis", "paiement_recu"] as const;
const TRAITEMENTS = ["a_qualifier", "applicable", "non_applicable", "exonere", "suspendu"] as const;

function ChampFiscal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
export function TexteFiscal({
  label,
  value,
  onChange,
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <ChampFiscal label={label}>
      <input
        className={CHAMP}
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </ChampFiscal>
  );
}
export function ChoixFiscal({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <ChampFiscal label={label}>
      <select
        className={CHAMP}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </ChampFiscal>
  );
}

export function ConfigurationFiscaleForm({
  value,
  onChange,
  jurisdiction,
  date,
}: {
  value: ConfigurationFiscale;
  onChange: (v: ConfigurationFiscale) => void;
  jurisdiction: string;
  date: string;
}) {
  const { t } = useI18n();
  const regimes = useQuery({
    queryKey: ["fx-regimes", jurisdiction, date],
    queryFn: () => office().identity.regimesDisponibles(jurisdiction, date),
    enabled: Boolean(jurisdiction),
  });
  const catalogue = useQuery({
    queryKey: ["fx-catalogue", jurisdiction, date],
    queryFn: () => office().parametrage.catalogueFiscal(jurisdiction, date),
    enabled: Boolean(jurisdiction && date),
  });
  const key = (s: string) => `fx.${s}` as MessageKey;
  const choix = (values: readonly string[]) => values.map((v) => ({ value: v, label: t(key(v)) }));
  const modifier = (index: number, patch: Partial<RegleFiscale>) =>
    onChange({
      ...value,
      regles: value.regles.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });
  return (
    <div className="space-y-5">
      <TexteFiscal
        label={t("fx.activity")}
        value={value.activite}
        onChange={(v) => onChange({ ...value, activite: v })}
        required
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {(["imposition", "tva"] as const).map((axe) => (
          <ChoixFiscal
            key={axe}
            label={t(axe === "tva" ? "fx.vatRegime" : "fx.imposition")}
            value={(axe === "tva" ? value.regimeTva : value.regimeImposition) ?? ""}
            options={[
              { value: "", label: t("fx.unknown") },
              ...(regimes.data ?? [])
                .filter((r) => r.axe === axe)
                .map((r) => ({ value: r.code, label: r.libelle })),
            ]}
            onChange={(v) =>
              onChange(
                axe === "tva"
                  ? { ...value, regimeTva: v || null, prorataTva: null }
                  : { ...value, regimeImposition: v || null },
              )
            }
          />
        ))}
      </div>
      {value.regimeTva === "partiel" ? (
        <TexteFiscal
          label={t("fx.prorata")}
          type="number"
          value={value.prorataTva === null ? "" : String(value.prorataTva)}
          onChange={(v) => onChange({ ...value, prorataTva: v === "" ? null : Number(v) })}
        />
      ) : null}
      {regimes.error || catalogue.error ? (
        <p role="alert" className="text-sm text-signal-stop">
          {t("fx.error")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{t("fx.rules")}</h3>
        <button
          className="min-h-[44px] rounded-lg border border-border px-3 text-sm"
          type="button"
          onClick={() =>
            onChange({
              ...value,
              regles: [
                ...value.regles,
                {
                  famille: "tva",
                  operation: "vente",
                  typeOperation: "",
                  code: "",
                  applicabilite: "a_qualifier",
                  mode: "aucun",
                  valeur: null,
                  assiette: "",
                  dansBaseTva: null,
                  deductibilite: "a_qualifier",
                  referenceLegale: "",
                  conditions: "",
                  justificatif: "",
                },
              ],
            })
          }
        >
          {t("fx.add")}
        </button>
      </div>
      {value.regles.map((r, i) => (
        <details
          key={i}
          open={value.regles.length === 1 || !r.code}
          className="rounded-xl border border-border bg-card p-4"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {t(key(r.famille))} · {r.code || t("fx.unknown")} · {t(key(r.applicabilite))}
          </summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoixFiscal
                label={t("fx.family")}
                value={r.famille}
                options={choix(FAMILLES)}
                onChange={(v) =>
                  modifier(i, {
                    famille: v as RegleFiscale["famille"],
                    code: "",
                    applicabilite: "a_qualifier",
                    mode: "aucun",
                    valeur: null,
                    assiette: "",
                    referenceLegale: "",
                    justificatif: "",
                    dansBaseTva: null,
                  })
                }
              />
              <ChoixFiscal
                label={t("fx.operation")}
                value={r.operation}
                options={choix(OPERATIONS)}
                onChange={(v) =>
                  modifier(i, {
                    operation: v as RegleFiscale["operation"],
                    applicabilite: "a_qualifier",
                    mode: "aucun",
                    valeur: null,
                  })
                }
              />
            </div>
            <ChoixFiscal
              label={t("fx.catalogue")}
              value=""
              options={[
                { value: "", label: t("fx.catalogueHint") },
                ...(catalogue.data ?? [])
                  .filter((c) => c.operation === r.operation && c.famille === r.famille)
                  .map((c, n) => ({
                    value: String(n),
                    label: `${c.libelle} · ${c.valeur ?? "—"}${c.mode === "taux" ? " %" : ""}`,
                  })),
              ]}
              onChange={(v) => {
                const c = (catalogue.data ?? []).filter(
                  (c) => c.operation === r.operation && c.famille === r.famille,
                )[Number(v)];
                if (c)
                  modifier(i, {
                    code: c.code,
                    referenceLegale: c.referenceLegale,
                    ...(c.seuil !== undefined ? { seuil: c.seuil } : {}),
                    assiette: c.assiette,
                    dansBaseTva: c.dansBaseTva,
                    ...(r.applicabilite === "applicable" ? { mode: c.mode, valeur: c.valeur } : {}),
                  });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TexteFiscal
                label={t("fx.code")}
                value={r.code}
                required
                onChange={(v) => modifier(i, { code: v })}
              />
              <TexteFiscal
                label={t("fx.type")}
                value={r.typeOperation}
                required
                onChange={(v) => modifier(i, { typeOperation: v })}
              />
            </div>
            <ChoixFiscal
              label={t("fx.applicability")}
              value={r.applicabilite}
              options={choix(TRAITEMENTS)}
              onChange={(v) =>
                modifier(i, {
                  applicabilite: v as RegleFiscale["applicabilite"],
                  ...(v !== "applicable"
                    ? { mode: "aucun", valeur: null }
                    : (() => {
                        const c = (catalogue.data ?? []).find(
                          (c) =>
                            c.code === r.code &&
                            c.famille === r.famille &&
                            c.operation === r.operation,
                        );
                        return { mode: c?.mode ?? "taux", valeur: c?.valeur ?? null };
                      })()),
                })
              }
            />
            {r.applicabilite === "applicable" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoixFiscal
                  label={t("fx.mode")}
                  value={r.mode}
                  options={choix(["taux", "montant"])}
                  onChange={(v) => modifier(i, { mode: v as RegleFiscale["mode"] })}
                />
                <TexteFiscal
                  label={t(r.mode === "taux" ? "fx.taux" : "fx.value")}
                  value={r.valeur ?? ""}
                  required
                  onChange={(v) => modifier(i, { valeur: v.replace(",", ".") || null })}
                />
                <TexteFiscal
                  label={t("fx.base")}
                  value={r.assiette}
                  required={r.mode === "taux"}
                  onChange={(v) => modifier(i, { assiette: v })}
                />
                <ChoixFiscal
                  label={t("fx.baseVat")}
                  value={r.dansBaseTva === null ? "" : r.dansBaseTva ? "oui" : "non"}
                  options={[{ value: "", label: t("fx.unknown") }, ...choix(["oui", "non"])]}
                  onChange={(v) => modifier(i, { dansBaseTva: v === "" ? null : v === "oui" })}
                />
                <ChoixFiscal
                  label={t("fx.deductibility")}
                  value={r.deductibilite}
                  options={choix(["a_qualifier", "oui", "non", "partielle"])}
                  onChange={(v) =>
                    modifier(i, { deductibilite: v as RegleFiscale["deductibilite"] })
                  }
                />
              </div>
            ) : null}
            {r.famille === "retenue" && r.applicabilite === "applicable" ? (
              <TexteFiscal
                label={t("fx.threshold")}
                value={r.seuil ?? ""}
                onChange={(v) => modifier(i, { seuil: v.replace(",", ".") || null })}
              />
            ) : null}
            <TexteFiscal
              label={t("fx.source")}
              value={r.referenceLegale}
              required={r.applicabilite !== "a_qualifier"}
              onChange={(v) => modifier(i, { referenceLegale: v })}
            />
            <TexteFiscal
              label={t("fx.conditions")}
              value={r.conditions}
              onChange={(v) => modifier(i, { conditions: v })}
            />
            <TexteFiscal
              label={t("fx.evidence")}
              value={r.justificatif}
              required={r.applicabilite === "exonere" || r.applicabilite === "suspendu"}
              onChange={(v) => modifier(i, { justificatif: v })}
            />
            <button
              type="button"
              className="min-h-[44px] text-sm text-signal-stop underline"
              onClick={() => onChange({ ...value, regles: value.regles.filter((_, n) => n !== i) })}
            >
              {t("fx.remove")}
            </button>
          </div>
        </details>
      ))}
    </div>
  );
}
