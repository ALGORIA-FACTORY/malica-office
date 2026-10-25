import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import {
  ConfigurationFiscaleSchema,
  NouveauProfilFiscalSchema,
  type ApercuFiscal,
  type ConfigurationFiscale,
  type FiscaliteDossier,
  type LotFiscal,
  type NouveauProfilFiscal,
  type ProfilFiscal,
} from "@malica/socle/ports/fiscalite";
import { ChoixFiscal, ConfigurationFiscaleForm, TexteFiscal } from "./configuration-fiscale";

const BOUTON =
  "min-h-[44px] rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40";
const ACTION = `${BOUTON} bg-foreground text-background`;
const VIDE: ConfigurationFiscale = {
  activite: "",
  regimeImposition: null,
  regimeTva: null,
  prorataTva: null,
  regles: [],
};
const JOUR = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Même parcours dans les paramètres, l'ouverture et la synthèse d'un dossier. */
export function ProfilsFiscaux({ cabinetId, clientId }: { cabinetId: string; clientId?: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [date, setDate] = useState(JOUR);
  const [reprendre, setReprendre] = useState(false);
  const [choisi, setChoisi] = useState("");
  const [categorie, setCategorie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<string[]>(clientId ? [clientId] : []);
  const [edition, setEdition] = useState<NouveauProfilFiscal | null>(null);
  const [clientEdition, setClientEdition] = useState<FiscaliteDossier | null>(null);
  const [apercu, setApercu] = useState<{ lot: LotFiscal; lignes: ApercuFiscal[] } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const acces = useQuery({
    queryKey: ["cab-acces", cabinetId],
    queryFn: () => office().acces.monAcces(cabinetId),
  });
  const expert = acces.data?.role === "expert";
  const membres = useQuery({
    queryKey: ["cab-members", cabinetId],
    queryFn: () => office().collab.members(cabinetId),
  });
  const auteur = (id: string) =>
    membres.data?.find((m) => m.userId === id)?.email ?? t("fx.formerMember");
  const horodate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );
  const profils = useQuery({
    queryKey: ["fx-profils", cabinetId],
    queryFn: () => office().parametrage.profilsFiscaux(cabinetId),
  });
  const clients = useQuery({
    queryKey: ["cab-clients", cabinetId],
    queryFn: () => office().supervision.listClients(cabinetId),
  });
  const dossiers = useQuery({
    queryKey: ["fx-dossiers", cabinetId],
    queryFn: () => office().parametrage.fiscaliteDossiers(cabinetId, "9999-12-31"),
  });
  const juridictions = useQuery({
    queryKey: ["juridictions"],
    queryFn: () => office().referential.juridictions(),
  });
  const historique = useQuery({
    queryKey: ["fx-historique", cabinetId, detail],
    queryFn: () => office().parametrage.historiqueFiscal(cabinetId, detail!),
    enabled: Boolean(detail),
  });
  const parClient = new Map((dossiers.data ?? []).map((d) => [d.clientId, d]));
  const versions = profils.data ?? [];
  const derniere = versions.filter((p) => !versions.some((v) => v.precedentId === p.id));
  const applicables = versions
    .filter((p) => p.dateEffet <= date)
    .filter((p) => !versions.some((v) => v.precedentId === p.id && v.dateEffet <= date));
  const courant = versions.find((p) => p.id === choisi);
  const visibles = (clients.data ?? [])
    .filter((c) => c.engagementStatus === "actif" && (!clientId || c.tenantId === clientId))
    .filter(
      (c) =>
        !categorie ||
        (categorie === "__sans"
          ? !parClient.has(c.tenantId)
          : parClient.get(c.tenantId)?.categorie === categorie),
    )
    .filter((c) =>
      `${c.name} ${c.legalId ?? ""}`.toLocaleLowerCase().includes(recherche.toLocaleLowerCase()),
    );
  const invalider = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["fx-profils", cabinetId] }),
      qc.invalidateQueries({ queryKey: ["fx-dossiers", cabinetId] }),
      qc.invalidateQueries({ queryKey: ["fx-historique", cabinetId] }),
      qc.invalidateQueries({ queryKey: ["fiche"] }),
      qc.invalidateQueries({ queryKey: ["cab-clients", cabinetId] }),
    ]);
  };
  const erreurDe = (e: unknown) => {
    setMessage(null);
    setErreur(texteDeLErreur(e, "comptabilite.fiscalite", t("fx.error")));
  };
  const sauver = useMutation({
    mutationFn: async () => {
      if (!edition) return;
      if (clientEdition) {
        await office().parametrage.personnaliserFiscalite({
          cabinetId,
          clientId: clientEdition.clientId,
          versionProfilId: clientEdition.versionProfilId,
          precedentId: clientEdition.id,
          dateEffet: edition.dateEffet,
          configuration: ConfigurationFiscaleSchema.parse(edition.configuration),
        });
      } else {
        const p = await office().parametrage.enregistrerProfilFiscal(
          NouveauProfilFiscalSchema.parse(edition),
        );
        setChoisi(p.id);
        if (p.dateEffet > date) setDate(p.dateEffet);
      }
    },
    onSuccess: async () => {
      setEdition(null);
      setClientEdition(null);
      setErreur(null);
      setApercu(null);
      setMessage(t("fx.saved"));
      await invalider();
    },
    onError: erreurDe,
  });
  const prevoir = useMutation({
    mutationFn: async () => {
      const lot: LotFiscal = {
        cabinetId,
        versionProfilId: choisi,
        dateEffet: date,
        ...(clientId && reprendre ? { remplacerPersonnalisation: true } : {}),
        cibles: selection.map((id) => ({
          clientId: id,
          precedentId: parClient.get(id)?.id ?? null,
        })),
      };
      return { lot, lignes: await office().parametrage.apercuFiscal(lot) };
    },
    onSuccess: (r) => {
      setErreur(null);
      setMessage(null);
      setApercu(r);
    },
    onError: erreurDe,
  });
  const appliquer = useMutation({
    mutationFn: () => office().parametrage.appliquerProfilFiscal(apercu!.lot),
    onSuccess: async (r) => {
      setMessage(t("fx.result", { n: r.appliques, ignored: r.ignores }));
      setApercu(null);
      setErreur(null);
      setSelection(clientId ? [clientId] : []);
      await invalider();
    },
    onError: (e) => {
      setApercu(null);
      erreurDe(e);
    },
  });
  const resetApercu = () => {
    setApercu(null);
    setMessage(null);
    setErreur(null);
  };
  const enCours = sauver.isPending || prevoir.isPending || appliquer.isPending;
  const ouvrir = (p?: ProfilFiscal) => {
    resetApercu();
    setClientEdition(null);
    setEdition(
      p
        ? { ...p, precedentId: p.id, dateEffet: p.dateEffet > date ? p.dateEffet : date }
        : {
            cabinetId,
            profilId: null,
            precedentId: null,
            nom: "",
            categorie: "",
            jurisdiction: juridictions.data?.length === 1 ? juridictions.data[0]!.jurisdiction : "",
            dateEffet: date,
            configuration: {
              ...VIDE,
              regles: (["tva", "timbre", "fodec", "retenue", "autre"] as const).map((famille) => ({
                famille,
                operation: famille === "retenue" ? "paiement_emis" : "vente",
                typeOperation: t("fx.unknown"),
                code: t(`fx.${famille}` as MessageKey),
                applicabilite: "a_qualifier",
                mode: "aucun",
                valeur: null,
                assiette: "",
                dansBaseTva: null,
                deductibilite: "a_qualifier",
                referenceLegale: "",
                conditions: "",
                justificatif: "",
              })),
            },
          },
    );
  };
  const sources = [acces, profils, clients, dossiers, juridictions];
  const panne = sources.find((s) => s.isError)?.error;
  if (panne)
    return (
      <p role="alert" className="text-sm text-signal-stop">
        {texteDeLErreur(panne, "comptabilite.fiscalite", t("fx.error"))}
      </p>
    );
  if (sources.some((s) => s.isPending)) return <p role="status">{t("fx.loading")}</p>;

  return (
    <section className="min-w-0" aria-label={t("fx.title")}>
      <fieldset disabled={enCours} className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("fx.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("fx.intro")}</p>
          </div>
          {expert ? (
            <button type="button" className={ACTION} disabled={enCours} onClick={() => ouvrir()}>
              {t("fx.new")}
            </button>
          ) : null}
        </div>
        {message ? (
          <p role="status" className="rounded-lg border border-signal-ok p-3 text-sm">
            {message}
          </p>
        ) : null}
        {erreur ? (
          <p
            role="alert"
            className="rounded-lg border border-signal-stop p-3 text-sm text-signal-stop"
          >
            {erreur}
          </p>
        ) : null}
        {edition ? (
          <form
            className="space-y-5 rounded-xl border border-border bg-card p-5"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!enCours) sauver.mutate();
            }}
          >
            <fieldset disabled={enCours} className="min-w-0 space-y-5">
              <h3 className="font-semibold">
                {t(clientEdition ? "fx.customize" : edition.precedentId ? "fx.edit" : "fx.new")}
              </h3>
              {clientEdition ? (
                <p className="text-sm text-muted-foreground">{t("fx.customHint")}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TexteFiscal
                    label={t("fx.name")}
                    value={edition.nom}
                    required
                    onChange={(v) => setEdition({ ...edition, nom: v })}
                  />
                  <TexteFiscal
                    label={t("fx.category")}
                    value={edition.categorie}
                    required
                    onChange={(v) => setEdition({ ...edition, categorie: v })}
                  />
                  <ChoixFiscal
                    label={t("fx.jurisdiction")}
                    value={edition.jurisdiction}
                    options={[
                      { value: "", label: "—" },
                      ...(juridictions.data ?? []).map((j) => ({
                        value: j.jurisdiction,
                        label: `${j.jurisdiction} · ${j.currency}`,
                      })),
                    ]}
                    required
                    onChange={(v) =>
                      setEdition({
                        ...edition,
                        jurisdiction: v,
                        configuration: {
                          ...edition.configuration,
                          regimeImposition: null,
                          regimeTva: null,
                          prorataTva: null,
                          regles: edition.configuration.regles.map((r) => ({
                            ...r,
                            applicabilite: "a_qualifier",
                            mode: "aucun",
                            valeur: null,
                            referenceLegale: "",
                            justificatif: "",
                          })),
                        },
                      })
                    }
                  />
                </div>
              )}
              <TexteFiscal
                label={t("fx.date")}
                value={edition.dateEffet}
                required
                type="date"
                onChange={(v) => setEdition({ ...edition, dateEffet: v })}
              />
              <ConfigurationFiscaleForm
                value={edition.configuration}
                jurisdiction={edition.jurisdiction}
                date={edition.dateEffet}
                onChange={(v) => setEdition({ ...edition, configuration: v })}
              />
              <p className="text-xs text-muted-foreground">{t("fx.draftHint")}</p>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className={ACTION}
                  disabled={!ConfigurationFiscaleSchema.safeParse(edition.configuration).success}
                >
                  {t("fx.save")}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    setEdition(null);
                    setClientEdition(null);
                    setErreur(null);
                  }}
                >
                  {t("fx.cancel")}
                </button>
              </div>
            </fieldset>
          </form>
        ) : null}
        {!clientId ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {derniere.length ? (
              derniere.map((p) => (
                <article
                  key={p.id}
                  className="space-y-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="text-xs text-muted-foreground">
                    {p.categorie} · {p.jurisdiction}
                  </div>
                  <h3 className="font-semibold">{p.nom}</h3>
                  <p className="text-sm">{p.configuration.activite}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("fx.date")} : {p.dateEffet}
                  </p>
                  <p className="text-xs">
                    {t("fx.needs", {
                      n: p.configuration.regles.filter((r) => r.applicabilite === "a_qualifier")
                        .length,
                    })}
                  </p>
                  {expert ? (
                    <button
                      type="button"
                      className={BOUTON}
                      disabled={enCours}
                      onClick={() => ouvrir(p)}
                    >
                      {t("fx.edit")}
                    </button>
                  ) : null}
                  <details>
                    <summary className="cursor-pointer text-xs">{t("fx.history")}</summary>
                    {versions
                      .filter((v) => v.profilId === p.profilId)
                      .map((v) => (
                        <div
                          key={v.id}
                          className="mt-2 space-y-1 border-t border-border pt-2 text-xs"
                        >
                          <p>
                            {v.dateEffet} · {horodate(v.creeLe)} · {auteur(v.creePar)}
                          </p>
                          <ResumeFiscal configuration={v.configuration} />
                        </div>
                      ))}
                  </details>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("fx.empty")}</p>
            )}
          </div>
        ) : null}
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className="font-semibold">{t(clientId ? "fx.onboarding" : "fx.clients")}</h3>
          {expert ? (
            <fieldset disabled={enCours} className="grid min-w-0 gap-3 sm:grid-cols-2">
              <ChoixFiscal
                label={t("fx.selectProfile")}
                value={choisi}
                options={[
                  { value: "", label: t("fx.selectProfile") },
                  ...applicables.map((p) => ({ value: p.id, label: `${p.nom} · ${p.dateEffet}` })),
                ]}
                onChange={(v) => {
                  resetApercu();
                  setChoisi(v);
                }}
              />
              <TexteFiscal
                label={t("fx.date")}
                value={date}
                type="date"
                required
                onChange={(v) => {
                  resetApercu();
                  setDate(v);
                }}
              />
            </fieldset>
          ) : null}
          {!clientId ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TexteFiscal
                label={t("fx.search")}
                value={recherche}
                onChange={(v) => setRecherche(v)}
              />
              <ChoixFiscal
                label={t("fx.category")}
                value={categorie}
                options={[
                  { value: "", label: t("fx.allCategories") },
                  { value: "__sans", label: t("fx.noCategory") },
                  ...[...new Set((dossiers.data ?? []).map((d) => d.categorie))]
                    .sort()
                    .map((v) => ({ value: v, label: v })),
                ]}
                onChange={(v) => {
                  resetApercu();
                  setCategorie(v);
                  setSelection([]);
                }}
              />
            </div>
          ) : null}
          {visibles.length ? (
            <div className="divide-y divide-border">
              {expert && !clientId ? (
                <label className="flex min-h-[44px] items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={enCours}
                    checked={
                      visibles.length > 0 && visibles.every((c) => selection.includes(c.tenantId))
                    }
                    onChange={(e) => {
                      resetApercu();
                      setSelection(e.target.checked ? visibles.map((c) => c.tenantId) : []);
                    }}
                  />
                  {t("fx.selectAll")}
                </label>
              ) : null}
              {visibles.map((c) => {
                const d = parClient.get(c.tenantId);
                return (
                  <div key={c.tenantId} className="flex flex-wrap items-center gap-3 py-3">
                    {expert ? (
                      <input
                        type="checkbox"
                        aria-label={t("fx.select", { nom: c.name })}
                        checked={selection.includes(c.tenantId)}
                        disabled={enCours}
                        onChange={(e) => {
                          resetApercu();
                          setSelection((s) =>
                            e.target.checked
                              ? [...s, c.tenantId]
                              : s.filter((id) => id !== c.tenantId),
                          );
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d
                          ? `${d.categorie} · ${d.dateEffet} · ${t(d.personnalise ? "fx.personnalise" : d.dateEffet > JOUR() ? "fx.scheduled" : "fx.current")}`
                          : t("fx.noCategory")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={BOUTON}
                      onClick={() => setDetail(detail === c.tenantId ? null : c.tenantId)}
                    >
                      {t("fx.detail")}
                    </button>
                    {expert && d ? (
                      <button
                        type="button"
                        className={BOUTON}
                        disabled={enCours}
                        onClick={() => {
                          const p = versions.find((v) => v.id === d.versionProfilId);
                          if (p) {
                            resetApercu();
                            setClientEdition(d);
                            setEdition({
                              ...NouveauProfilFiscalSchema.strip().parse(p),
                              dateEffet: date,
                              configuration: structuredClone(d.configuration),
                            });
                          }
                        }}
                      >
                        {t("fx.customize")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("fx.noClients")}</p>
          )}
          {expert && clientId ? (
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={reprendre}
                disabled={enCours}
                onChange={(e) => {
                  resetApercu();
                  setReprendre(e.target.checked);
                }}
              />
              {t("fx.replaceCustom")}
            </label>
          ) : null}
          {expert ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {t("fx.selected", { n: selection.length })}
              </span>
              <button
                type="button"
                className={ACTION}
                disabled={enCours || !choisi || !date || selection.length === 0}
                onClick={() => {
                  setApercu(null);
                  prevoir.mutate();
                }}
              >
                {t("fx.preview")}
              </button>
            </div>
          ) : null}
          {courant ? (
            <details>
              <summary className="cursor-pointer text-sm">
                {t("fx.selectProfile")} · {courant.nom}
              </summary>
              <ResumeFiscal configuration={courant.configuration} />
            </details>
          ) : null}
        </div>
        {apercu ? (
          <section
            aria-label={t("fx.preview")}
            className="space-y-4 rounded-xl border border-foreground bg-card p-5"
          >
            <h3 className="font-semibold">
              {t("fx.preview")} · {apercu.lot.dateEffet}
            </h3>
            {apercu.lignes.map((r) => (
              <details key={r.clientId} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm">
                  <strong>{r.nom}</strong> ·{" "}
                  {t(r.statut === "date" ? "fx.dateConflict" : (`fx.${r.statut}` as MessageKey))}
                </summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold">{t("fx.before")}</p>
                    {r.avant ? (
                      <ResumeFiscal configuration={r.avant} />
                    ) : (
                      <p className="text-sm">{t("fx.noCategory")}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold">{t("fx.after")}</p>
                    <ResumeFiscal
                      configuration={r.statut === "eligible" ? r.apres : (r.avant ?? r.apres)}
                    />
                  </div>
                </div>
              </details>
            ))}
            <button
              type="button"
              className={ACTION}
              disabled={enCours || !apercu.lignes.some((r) => r.statut === "eligible")}
              onClick={() => appliquer.mutate()}
            >
              {t("fx.apply", { n: apercu.lignes.filter((r) => r.statut === "eligible").length })}
            </button>
          </section>
        ) : null}
        {detail ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">{t("fx.history")}</h3>
            <p className="text-xs text-muted-foreground">{t("fx.historyHint")}</p>
            {historique.isPending ? (
              <p>{t("fx.loading")}</p>
            ) : historique.error ? (
              <p role="alert">{t("fx.error")}</p>
            ) : (
              (historique.data ?? []).map((d) => (
                <details key={d.id}>
                  <summary className="cursor-pointer text-sm">
                    {d.dateEffet} · {d.categorie} ·{" "}
                    {t(d.personnalise ? "fx.personnalise" : "fx.current")}
                  </summary>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {auteur(d.creePar)} · {horodate(d.creeLe)}
                  </p>
                  <ResumeFiscal configuration={d.configuration} />
                </details>
              ))
            )}
            <button type="button" className={BOUTON} onClick={() => setDetail(null)}>
              {t("fx.close")}
            </button>
          </section>
        ) : null}
      </fieldset>
    </section>
  );
}

function ResumeFiscal({ configuration: c }: { configuration: ConfigurationFiscale }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p>{c.activite}</p>
      <p className="text-xs text-muted-foreground">
        {c.regimeImposition ?? t("fx.unknown")} · {c.regimeTva ?? t("fx.unknown")}
        {c.prorataTva !== null ? ` · ${c.prorataTva} %` : ""}
      </p>
      {c.regles.map((r, i) => (
        <div key={i} className="rounded-lg bg-background p-3">
          <p className="font-medium">
            {t(`fx.${r.famille}` as MessageKey)} · {r.typeOperation} ·{" "}
            {t(`fx.${r.operation}` as MessageKey)}
          </p>
          <p>
            {t(`fx.${r.applicabilite}` as MessageKey)}
            {r.valeur !== null ? ` · ${r.valeur}${r.mode === "taux" ? " %" : ""}` : ""}
          </p>
          <dl className="mt-1 grid gap-1 text-xs text-muted-foreground">
            {[
              ["fx.base", r.assiette],
              [
                "fx.baseVat",
                r.dansBaseTva === null ? t("fx.unknown") : t(r.dansBaseTva ? "fx.oui" : "fx.non"),
              ],
              ["fx.deductibility", t(`fx.${r.deductibilite}` as MessageKey)],
              ["fx.source", r.referenceLegale],
              ["fx.conditions", r.conditions],
              ["fx.evidence", r.justificatif],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="break-words">
                  <dt className="inline font-medium">{t(k as MessageKey)} : </dt>
                  <dd className="inline">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
