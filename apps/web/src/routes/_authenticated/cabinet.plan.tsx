/**
 * Plan comptable du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * Un seul plan, trois origines, et l'origine est la colonne qui compte : le
 * compte livré verbatim par la norme du pack, l'extension ouverte par Regalica,
 * la subdivision que le cabinet a arrêtée. L'écran les montre ensemble, et
 * marque à l'or ce qui vient du cabinet — on doit pouvoir répondre à « qui a
 * décidé ce compte » sans lire un historique (R10).
 *
 * Le masthead ne porte que des comptes de lignes : le pack en vigueur, le
 * nombre de comptes, le nombre d'extensions. Aucun chiffre n'est calculé ici
 * au-delà d'un dénombrement — et le moteur ne donne pas le nombre d'écritures
 * par compte, donc l'écran ne l'affiche pas.
 *
 * Sous le plan, deux panneaux repliables : les rôles comptables — les schémas
 * d'écriture citent un rôle, jamais un numéro ; rebrancher un rôle change
 * toutes les écritures qui l'emploient — et les tiers, qui appartiennent au
 * DOSSIER, pas au cabinet : un client de la PME A n'a rien à faire dans les
 * livres de la PME B, d'où le choix du dossier avant tout.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionRepliable,
  SignalLight,
} from "@/components/regalica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type {
  CompteDuPlan,
  NatureTiers,
  RoleComptable,
  Tiers,
} from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/plan")({
  head: () => ({
    meta: [
      { title: "Plan comptable — Regalica Office" },
      {
        name: "description",
        content:
          "Le plan de référence du pack, les extensions du cabinet, les rôles comptables et les tiers de chaque dossier.",
      },
      { property: "og:title", content: "Plan comptable — Regalica Office" },
      {
        property: "og:description",
        content:
          "Le plan de référence du pack, les extensions du cabinet, les rôles comptables et les tiers de chaque dossier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanComptable,
});

type Origine = CompteDuPlan["origine"];
type FiltreOrigine = "tout" | Origine;

const ORIGINES: Origine[] = ["officiel", "extension", "cabinet"];
const OU = "routes/_authenticated/cabinet.plan";

/**
 * Le libellé d'une classe du plan.
 *
 * Les classes viennent du plan lui-même, pas d'une liste écrite ici : un pack
 * qui en compte neuf n'a pas à attendre l'écran (R5). Le dictionnaire nomme
 * celles qu'il connaît ; pour les autres, le chiffre suffit — mieux qu'une clé
 * brute à l'écran.
 */
function libelleClasse(t: (cle: MessageKey) => string, classe: string): string {
  const cle = `plan.classe.${classe}` as MessageKey;
  const libelle = t(cle);
  return libelle === cle ? classe : libelle;
}

/** La couleur de l'origine : l'encre pour la norme, l'information pour Regalica, l'or pour le cabinet. */
const TON_ORIGINE: Record<Origine, string> = {
  officiel: "text-muted-foreground",
  extension: "text-signal-info",
  cabinet: "text-marigold",
};

const CHIP =
  "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]";
const CHIP_ACTIF = "bg-foreground text-background";
const CHIP_REPOS = "bg-card hover:bg-accent";
const BOUTON =
  "border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-40";
const BOUTON_ENCRE =
  "border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-background disabled:opacity-40";
const ETIQUETTE = "text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground";
const CHAMP = "mt-1 w-full border border-border bg-card px-2 py-1 text-[13px]";

function PlanComptable() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const plan = useQuery({
    queryKey: ["param-plan", org.id],
    queryFn: () => office().parametrage.plan(org.id, null),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });

  useRegalicaPanel(
    <RegalicaNote kicker={t("plan.regalica.kicker")}>{t("plan.regalica")}</RegalicaNote>,
    [locale],
  );

  const comptes = useMemo(() => plan.data ?? [], [plan.data]);
  const extensionsDuCabinet = comptes.filter((c) => c.origine === "cabinet").length;
  // Les classes que le plan porte réellement, dans l'ordre : le filtre les suit.
  const classes = useMemo(
    () => [...new Set(comptes.map((c) => c.classe))].sort((a, b) => a.localeCompare(b)),
    [comptes],
  );

  // Le kicker ne dit un nombre que lorsqu'il est lu : « 0 compte » pendant le
  // chargement serait un chiffre faux.
  const kicker = [
    pack.data ? `${org.jurisdiction} ${pack.data.version}` : org.jurisdiction,
    ...(plan.data
      ? [
          t("cab.plan.comptes", { count: comptes.length }),
          t("cab.plan.extensions", { count: extensionsDuCabinet }),
        ]
      : []),
  ].join(" · ");

  // Les deux panneaux sont longs : repliés, la page se lit d'un coup d'œil.
  // Les boutons du masthead les ouvrent et y mènent.
  const [voirRoles, setVoirRoles] = useState(false);
  const [voirTiers, setVoirTiers] = useState(false);
  const rolesRef = useRef<HTMLDivElement>(null);
  const tiersRef = useRef<HTMLDivElement>(null);

  function montrer(section: "roles" | "tiers") {
    if (section === "roles") setVoirRoles(true);
    else setVoirTiers(true);
    const cible = section === "roles" ? rolesRef.current : tiersRef.current;
    cible?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="border-b border-foreground pb-6">
        <p className="num text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {kicker}
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {t("plan.title")}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.55] text-text-2">
          {t("cab.plan.principe")}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={voirRoles}
            onClick={() => montrer("roles")}
            className={cn(BOUTON, "bg-card py-1.5")}
          >
            {t("plan.roles.title")}
          </button>
          <button
            type="button"
            aria-expanded={voirTiers}
            onClick={() => montrer("tiers")}
            className={cn(BOUTON, "bg-card py-1.5")}
          >
            {t("plan.tiers.title")}
          </button>
        </div>
      </header>

      <PlanDuCabinet comptes={comptes} classes={classes} chargement={plan.isPending} />

      <div ref={rolesRef}>
        <Roles
          comptes={comptes}
          classes={classes}
          ouvert={voirRoles}
          onBascule={() => setVoirRoles((v) => !v)}
        />
      </div>
      <div ref={tiersRef}>
        <TiersDuDossier ouvert={voirTiers} onBascule={() => setVoirTiers((v) => !v)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ le plan */

/**
 * Le plan, filtré par origine et par classe, avec la main pour le subdiviser.
 *
 * Le geste part du compte : on parcourt la ligne, on ouvre dessous. Le code est
 * PROPOSÉ — le prochain libre sous ce parent — et reste modifiable : un cabinet
 * qui numérote par agence ou par chantier garde la main.
 *
 * Les comptes collectifs sont montrés mais fermés à la subdivision : 401, 411,
 * 425 reçoivent des tiers, et l'écran le dit sur la ligne plutôt que de laisser
 * l'expert le découvrir par un refus.
 */
function PlanDuCabinet({
  comptes,
  classes,
  chargement,
}: {
  comptes: CompteDuPlan[];
  classes: string[];
  chargement: boolean;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [origine, setOrigine] = useState<FiltreOrigine>("tout");
  const [classe, setClasse] = useState<string>("");
  const [cherche, setCherche] = useState("");
  const [ouvertSous, setOuvertSous] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const ouvrir = useMutation({
    mutationFn: (parent: string) =>
      office().parametrage.ouvrirCompte({
        tenantId: org.id,
        code: code.trim(),
        libelle: libelle.trim(),
        parent,
      }),
    onSuccess: async () => {
      setOuvertSous(null);
      setCode("");
      setLibelle("");
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["param-plan", org.id] });
    },
    // Le message vient de la base quand c'est elle qui refuse : ce sont ses
    // règles, et elles savent mieux que l'écran pourquoi. Toute autre origine
    // se lit en une phrase humaine, le détail part au journal.
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const fermer = useMutation({
    mutationFn: (compte: string) => office().parametrage.fermerCompte(org.id, compte),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["param-plan", org.id] });
    },
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  /**
   * Le prochain code libre sous un parent.
   *
   * On prend les enfants directs — ceux qui prolongent le parent d'un chiffre —
   * et on propose le suivant. Si la norme est déjà dense, on remonte : 6011,
   * 6012… puis 60111 si tout est pris. La proposition n'est jamais imposée.
   */
  function prochainCode(parent: string): string {
    const enfants = comptes
      .map((c) => c.code)
      .filter((c) => c.startsWith(parent) && c.length === parent.length + 1);
    for (let i = 1; i <= 9; i += 1) {
      const essai = parent + String(i);
      if (!enfants.includes(essai)) return essai;
    }
    return parent + "01";
  }

  const parOrigine = useMemo(() => {
    const n: Record<Origine, number> = { officiel: 0, extension: 0, cabinet: 0 };
    for (const c of comptes) n[c.origine] += 1;
    return n;
  }, [comptes]);

  const deLOrigine = useMemo(
    () => (origine === "tout" ? comptes : comptes.filter((c) => c.origine === origine)),
    [comptes, origine],
  );

  const parClasse = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of deLOrigine) n[c.classe] = (n[c.classe] ?? 0) + 1;
    return n;
  }, [deLOrigine]);

  const lignes = useMemo(() => {
    const q = cherche.trim().toLocaleLowerCase();
    return deLOrigine
      .filter((c) => !classe || c.classe === classe)
      .filter((c) => !q || c.code.includes(q) || c.libelle.toLocaleLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [deLOrigine, classe, cherche]);

  const filtresOrigine: Array<{ cle: FiltreOrigine; label: string; count: number }> = [
    { cle: "tout", label: t("cab.plan.filter.tout"), count: comptes.length },
    ...ORIGINES.map((o) => ({ cle: o, label: t(`plan.origin.${o}`), count: parOrigine[o] })),
  ];

  return (
    <section className="space-y-4">
      {/* ---- filtres : origine, classe, texte */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap border border-border">
          {filtresOrigine.map((f) => (
            <button
              key={f.cle}
              type="button"
              onClick={() => setOrigine(f.cle)}
              aria-pressed={origine === f.cle}
              className={cn(CHIP, origine === f.cle ? CHIP_ACTIF : CHIP_REPOS)}
            >
              {f.label}
              <span className="num font-normal opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap border border-border">
          <button
            type="button"
            onClick={() => setClasse("")}
            aria-pressed={classe === ""}
            className={cn(CHIP, classe === "" ? CHIP_ACTIF : CHIP_REPOS)}
          >
            {t("plan.all")}
          </button>
          {classes.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setClasse(c)}
              aria-pressed={classe === c}
              className={cn(CHIP, classe === c ? CHIP_ACTIF : CHIP_REPOS)}
            >
              {libelleClasse(t, c)}
              <span className="num font-normal opacity-70">{parClasse[c] ?? 0}</span>
            </button>
          ))}
        </div>
        <input
          value={cherche}
          onChange={(e) => setCherche(e.target.value)}
          placeholder={t("plan.search")}
          aria-label={t("plan.search")}
          className="ms-auto min-h-[36px] w-48 border border-border bg-card px-2.5 text-[12px]"
        />
      </div>

      {erreur ? <p className="text-[12px] text-signal-stop">{erreur}</p> : null}

      {/* ---- le plan */}
      {chargement ? (
        <p className="text-sm text-muted-foreground">{t("plan.loading")}</p>
      ) : lignes.length === 0 ? (
        <EmptyState>{t("plan.nct.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="min-w-full border-collapse text-[12.5px]">
            <caption className="sr-only">{t("plan.title")}</caption>
            <thead>
              <tr className="border-b border-foreground">
                {[
                  t("plan.col.compte"),
                  t("plan.col.libelle"),
                  t("plan.col.origine"),
                  t("plan.collectif.court"),
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="px-3 py-2 text-start text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((c) => {
                const duCabinet = c.origine === "cabinet";
                return (
                  <tr key={c.code} className="border-b border-border hover:bg-secondary/60">
                    <td
                      className={cn(
                        "num whitespace-nowrap px-3 py-2 align-top text-[13px] font-medium",
                        duCabinet && "border-s-2 border-s-marigold text-marigold",
                      )}
                    >
                      {c.code}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {c.libelle}
                      {c.source && c.origine === "extension" ? (
                        <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                          {c.source}
                        </span>
                      ) : null}
                      {ouvertSous === c.code ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            ouvrir.mutate(c.code);
                          }}
                          className="mt-2 grid gap-2 border border-border bg-background p-2 sm:grid-cols-[7rem_1fr_auto]"
                        >
                          <label className="block">
                            <span className={ETIQUETTE}>{t("plan.field.code")}</span>
                            <input
                              value={code}
                              onChange={(e) => setCode(e.target.value)}
                              required
                              className={cn("num", CHAMP)}
                            />
                          </label>
                          <label className="block">
                            <span className={ETIQUETTE}>{t("plan.field.libelle")}</span>
                            <input
                              value={libelle}
                              onChange={(e) => setLibelle(e.target.value)}
                              required
                              autoFocus
                              className={CHAMP}
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={ouvrir.isPending}
                            className={cn(BOUTON_ENCRE, "self-end")}
                          >
                            {t("plan.open")}
                          </button>
                        </form>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      <span
                        className={cn(
                          "text-[9.5px] font-semibold uppercase tracking-[0.14em]",
                          TON_ORIGINE[c.origine],
                        )}
                      >
                        {t(`plan.origin.${c.origine}`)}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 align-top text-[11.5px] text-muted-foreground"
                      title={c.collectif ? t("plan.collectif") : undefined}
                    >
                      {c.collectif ? t("plan.collectif.court") : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end align-top">
                      {c.collectif ? null : duCabinet ? (
                        <button
                          type="button"
                          disabled={fermer.isPending}
                          onClick={() => fermer.mutate(c.code)}
                          className={cn(BOUTON, "text-muted-foreground")}
                        >
                          {t("plan.close")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const suivant = ouvertSous === c.code ? null : c.code;
                            setOuvertSous(suivant);
                            setErreur(null);
                            setLibelle("");
                            setCode(suivant ? prochainCode(c.code) : "");
                          }}
                          className={BOUTON}
                        >
                          {ouvertSous === c.code ? t("plan.cancel") : t("plan.subdivide")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ les rôles */

function Roles({
  comptes,
  classes,
  ouvert,
  onBascule,
}: {
  comptes: CompteDuPlan[];
  classes: string[];
  ouvert: boolean;
  onBascule: () => void;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const queryClient = useQueryClient();

  const [classe, setClasse] = useState<string>("");
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const roles = useQuery({
    queryKey: ["param-roles", org.id],
    queryFn: () => office().parametrage.roles(org.id, null),
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
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["param-roles", org.id] });
    },
    // Un refus de la base — compte hors des classes admises, par exemple — se
    // lit ici ; sans quoi le rôle garderait son ancien compte sans un mot.
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
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
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["param-roles", org.id] });
    },
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
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
    return comptes
      .filter((c) => role.classesAdmises.includes(Number(c.classe)))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  const surcharges = (roles.data ?? []).filter((r) => r.origine === "cabinet").length;

  return (
    <SectionRepliable
      titre={t("plan.roles.title")}
      ouvert={ouvert}
      onBascule={onBascule}
      resume={
        roles.data ? t("plan.summary", { surcharges, total: roles.data.length }) : t("plan.loading")
      }
    >
      <p className="max-w-[62ch] text-[12.5px] leading-[1.5] text-text-2">{t("plan.roles.lede")}</p>

      <div className="flex flex-wrap border border-border">
        <button
          type="button"
          onClick={() => setClasse("")}
          aria-pressed={classe === ""}
          className={cn(CHIP, classe === "" ? CHIP_ACTIF : CHIP_REPOS)}
        >
          {t("plan.all")}
        </button>
        {classes.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setClasse(c)}
            aria-pressed={classe === c}
            className={cn(CHIP, classe === c ? CHIP_ACTIF : CHIP_REPOS)}
          >
            {libelleClasse(t, c)}
          </button>
        ))}
      </div>

      {erreur ? <p className="text-[12px] text-signal-stop">{erreur}</p> : null}

      {roles.isPending ? (
        <p className="text-sm text-muted-foreground">{t("plan.loading")}</p>
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
                <span className="num block text-[10.5px] text-muted-foreground">{r.code}</span>
                {r.note ? (
                  <span className="mt-1 block text-[10.5px] text-muted-foreground">{r.note}</span>
                ) : null}
              </InkCell>

              <InkCell>
                {enEdition === r.code ? (
                  <select
                    autoFocus
                    defaultValue={r.compte ?? ""}
                    onChange={(e) =>
                      e.target.value && relier.mutate({ roleCode: r.code, compte: e.target.value })
                    }
                    className="w-full border border-border bg-card px-2 py-1 text-[13px]"
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
                      <span className="block text-[10.5px] text-muted-foreground">
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
                  <span className="mt-1 block text-[10.5px] text-muted-foreground">
                    {t("plan.wasDefault", { compte: r.defautDuPack })}
                  </span>
                ) : null}
                {r.origine === "pack" && r.justificationDuPack ? (
                  <span className="mt-1 block text-[10.5px] text-muted-foreground">
                    {r.justificationDuPack}
                  </span>
                ) : null}
              </InkCell>

              <InkCell>
                <div className="flex flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setEnEdition(enEdition === r.code ? null : r.code)}
                    className={BOUTON}
                  >
                    {enEdition === r.code ? t("plan.cancel") : t("plan.change")}
                  </button>
                  {r.origine === "cabinet" ? (
                    <button
                      type="button"
                      disabled={rendre.isPending}
                      onClick={() => rendre.mutate(r.code)}
                      className={cn(BOUTON, "text-muted-foreground")}
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
    </SectionRepliable>
  );
}

/* ------------------------------------------------------------------ les tiers */

const NATURES: NatureTiers[] = ["client", "fournisseur", "salarie", "associe", "compte_bancaire"];

/**
 * Les tiers d'un dossier.
 *
 * On demande le dossier avant tout : un tiers appartient aux livres d'une PME,
 * pas à ceux du cabinet. Sans ce choix, l'écran laisserait croire à un fichier
 * clients commun — ce qui serait faux, et le resterait jusqu'au jour où
 * quelqu'un s'en apercevrait dans une balance.
 */
function TiersDuDossier({ ouvert, onBascule }: { ouvert: boolean; onBascule: () => void }) {
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
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  /*
   * ============================================== MODIFIER UN TIERS
   *
   * Le même formulaire sert aux deux gestes. En édition, le code ne change pas :
   * c'est l'identité du tiers dans les écritures, on ne la réécrit pas.
   */
  const [enEdition, setEnEdition] = useState<Tiers | null>(null);
  const modifier = useMutation({
    mutationFn: () =>
      office().tiers.modifier({
        id: enEdition!.id,
        raisonSociale: raison,
        compteCollectif: collectif,
        identifiantFiscal: matricule || null,
        note: enEdition!.note,
      }),
    onSuccess: async () => {
      setEnEdition(null);
      setCode("");
      setRaison("");
      setMatricule("");
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ["tiers", dossier, nature] });
    },
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const basculer = useMutation({
    mutationFn: (x: Tiers) => office().tiers.desactiver(x.id, !x.actif),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tiers", dossier, nature] });
    },
    onError: (e) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  function vider() {
    setEnEdition(null);
    setCode("");
    setRaison("");
    setMatricule("");
  }

  return (
    <SectionRepliable
      titre={t("plan.tiers.title")}
      ouvert={ouvert}
      onBascule={onBascule}
      resume={dossier ? (clients.data ?? []).find((c) => c.tenantId === dossier)?.name : undefined}
    >
      <p className="max-w-[62ch] text-[12.5px] leading-[1.5] text-text-2">{t("plan.tiers.lede")}</p>

      <label className="flex flex-wrap items-center gap-2">
        <span className={ETIQUETTE}>{t("plan.tiers.dossier")}</span>
        <select
          value={dossier}
          onChange={(e) => {
            setDossier(e.target.value);
            vider();
          }}
          className="max-w-[280px] border border-border bg-card px-2.5 py-1.5 text-[12px]"
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
          <div className="flex flex-wrap border border-border">
            {NATURES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setNature(n);
                  vider();
                }}
                aria-pressed={nature === n}
                className={cn(CHIP, nature === n ? CHIP_ACTIF : CHIP_REPOS)}
              >
                {t(`plan.nature.${n}`)}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (enEdition) modifier.mutate();
              else creer.mutate();
            }}
            className="grid gap-2 border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_9rem_12rem_auto]"
          >
            <label className="block">
              <span className={ETIQUETTE}>{t("plan.col.code")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                readOnly={Boolean(enEdition)}
                className={cn("num", CHAMP, enEdition && "text-muted-foreground")}
              />
            </label>
            <label className="block">
              <span className={ETIQUETTE}>{t("plan.tiers.raison")}</span>
              <input
                value={raison}
                onChange={(e) => setRaison(e.target.value)}
                required
                className={CHAMP}
              />
            </label>
            <label className="block">
              <span className={ETIQUETTE}>{t("plan.tiers.matricule")}</span>
              <input
                value={matricule}
                onChange={(e) => setMatricule(e.target.value)}
                className={cn("num", CHAMP)}
              />
            </label>
            <label className="block">
              <span className={ETIQUETTE}>{t("plan.tiers.collectif")}</span>
              <select
                value={collectif}
                onChange={(e) => setCollectif(e.target.value)}
                required
                className={CHAMP}
              >
                <option value="">{t("plan.choose")}</option>
                {(collectifs.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.libelle}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex gap-2 self-end">
              <button
                type="submit"
                disabled={creer.isPending || modifier.isPending}
                className={BOUTON_ENCRE}
              >
                {enEdition ? t("plan.tiers.save") : t("plan.tiers.add")}
              </button>
              {enEdition ? (
                <button
                  type="button"
                  onClick={vider}
                  className={cn(BOUTON, "py-1.5 text-muted-foreground")}
                >
                  {t("common.cancel")}
                </button>
              ) : null}
            </span>
          </form>

          {erreur ? <p className="text-[12px] text-signal-stop">{erreur}</p> : null}

          {liste.isPending ? (
            <p className="text-sm text-muted-foreground">{t("plan.loading")}</p>
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
                      <span className="ms-2 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
                        {t("plan.tiers.inactive")}
                      </span>
                    ) : null}
                  </InkCell>
                  <InkCell numeric>{x.identifiantFiscal ?? "—"}</InkCell>
                  <InkCell>
                    <span className="num">{x.compteCollectif}</span>
                    {x.compteLibelle ? (
                      <span className="block text-[10.5px] text-muted-foreground">
                        {x.compteLibelle}
                      </span>
                    ) : null}
                  </InkCell>
                  <InkCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          // Le formulaire se remplit avec la ligne : on modifie ce
                          // qu'on voit, pas une copie retapée.
                          setEnEdition(x);
                          setCode(x.code);
                          setRaison(x.raisonSociale);
                          setMatricule(x.identifiantFiscal ?? "");
                          setCollectif(x.compteCollectif);
                        }}
                        className={BOUTON}
                      >
                        {t("plan.tiers.edit")}
                      </button>
                      <button
                        type="button"
                        disabled={basculer.isPending}
                        onClick={() => basculer.mutate(x)}
                        className={cn(BOUTON, "text-muted-foreground")}
                      >
                        {x.actif ? t("plan.tiers.deactivate") : t("plan.tiers.reactivate")}
                      </button>
                    </div>
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          )}
        </>
      )}
    </SectionRepliable>
  );
}
