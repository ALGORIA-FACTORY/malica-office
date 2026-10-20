/**
 * Rapprochement bancaire — l'écran du cabinet.
 *
 * ============================================================== POURQUOI
 *
 * L'appariement est déterministe et vient du Socle : montant, date,
 * référence, dans les tolérances du pack de juridiction. L'écran montre ce
 * que le moteur propose ; l'expert lettre, ignore ou délettre — avec un
 * motif gouverné — et chaque geste est consigné (R7).
 *
 * Aucun chiffre n'est produit ici. Les totaux affichés sont l'addition
 * exacte, en entiers, de montants que le Socle a déjà rendus ; le taux de
 * lignes rapprochées compte des lignes, il ne décide rien.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

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
  SectionRepliable,
  SectionTitle,
  EnTeteCabinet,
} from "@/components/malica/office-ui";
import { currentPeriod, monthBounds } from "@/hooks/use-tva";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { estNul, sommeDecimale } from "@malica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { BankBookLine, BankStatementLine } from "@malica/socle/ports/repositories";
import { computeRapprochement } from "@malica/socle/engines/banque/rapprochement";

export const Route = createFileRoute("/_authenticated/cabinet/rapprochement")({
  head: () => ({
    meta: [
      { title: "Rapprochement bancaire — Malica Office" },
      {
        name: "description",
        content:
          "Lettrage des lignes bancaires avec les écritures, délettrage motivé et journal complet.",
      },
      { property: "og:title", content: "Rapprochement bancaire — Malica Office" },
      {
        property: "og:description",
        content:
          "Lettrage des lignes bancaires avec les écritures, délettrage motivé et journal complet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetRapprochement,
});

/** Clé d'idempotence d'une ligne de relevé : zéro doublon à l'import. */
function importKey(
  compteId: string,
  at: string,
  label: string,
  montant: string,
  reference: string | null,
) {
  return [
    compteId,
    at,
    label.trim().toUpperCase(),
    montant,
    (reference ?? "").trim().toUpperCase(),
  ].join("|");
}

function parseCsv(
  compteId: string,
  raw: string,
): Array<{
  at: string;
  label: string;
  montant: string;
  reference: string | null;
  idempotencyKey: string;
}> {
  const out: Array<{
    at: string;
    label: string;
    montant: string;
    reference: string | null;
    idempotencyKey: string;
  }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const cols = row.split(/[;\t]/).map((c) => c.trim());
    if (cols.length < 3) continue;
    const at = cols[0] ?? "";
    const label = cols[1] ?? "";
    const reference = cols[3] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) continue;
    // Le montant reste une chaîne : aucun calcul monétaire hors du Socle.
    const amount = (cols[2] ?? "").replace(/\s/g, "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(amount)) continue;
    const ref = reference.length > 0 ? reference : null;
    out.push({
      at,
      label,
      montant: amount,
      reference: ref,
      idempotencyKey: importKey(compteId, at, label, amount, ref),
    });
  }
  return out;
}

/** L'opposé d'un montant décimal : on bascule le signe, on ne calcule pas. */
function oppose(valeur: string): string {
  const propre = valeur.trim();
  return propre.startsWith("-") ? propre.slice(1) : `-${propre}`;
}

/** Le montant sans son signe — un écart se lit en valeur absolue. */
function sansSigne(valeur: string): string {
  const propre = valeur.trim();
  return propre.startsWith("-") ? propre.slice(1) : propre;
}

/** Ce qu'un geste de la piste d'audit bancaire veut dire. */
const GESTES: Record<string, MessageKey> = {
  "banque.lettre": "cab.banque.action.lettre",
  "banque.delettre": "cab.banque.action.delettre",
};

type T = ReturnType<typeof useI18n>["t"];

/** Le libellé d'une écriture — lien vers sa pièce quand elle en a une. */
function EcritureRef({ book, titre }: { book: BankBookLine | undefined; titre: string }) {
  if (!book) return <span>—</span>;
  if (book.pieceId) {
    return (
      <Link
        to="/cabinet/piece/$pieceId"
        params={{ pieceId: book.pieceId }}
        className="underline decoration-dotted underline-offset-4"
        title={titre}
      >
        {book.label || "—"}
      </Link>
    );
  }
  return <span>{book.label || "—"}</span>;
}

/**
 * Une paire — proposée ou retenue — en trois colonnes : la ligne du relevé,
 * le score et l'écart au centre, l'écriture ; les gestes à droite.
 *
 * Défini hors du composant d'écran : les gestes portent des champs de saisie,
 * et un composant recréé à chaque rendu leur ferait perdre le focus.
 */
function CarteAppariement({
  bank,
  book,
  score,
  ecartMontant,
  ecartJours,
  decimals,
  actions,
  t,
  locale,
  dateCourte,
}: {
  bank: BankStatementLine | undefined;
  book: BankBookLine | undefined;
  score: number;
  ecartMontant: string;
  ecartJours: number;
  decimals: number | undefined;
  actions: ReactNode;
  t: T;
  locale: string;
  dateCourte: (iso: string) => string;
}) {
  // Montant exact : le vert ; dans la tolérance sans être exact : l'ambre.
  const exact = estNul(ecartMontant, decimals);
  const largeur = Math.min(100, Math.max(0, score));
  const pourcent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(largeur / 100);
  return (
    <li className="grid border border-border bg-card md:grid-cols-[1fr_auto_1fr_auto]">
      <div className="min-w-0 px-3.5 py-3">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("cab.banque.line")}
        </p>
        <p className="mt-1.5 text-[13px] font-medium">{bank?.label ?? "—"}</p>
        <p className="num mt-1 text-[11.5px] leading-[1.4] text-muted-foreground">
          {bank ? dateCourte(bank.at) : "—"}
          {bank?.reference ? ` · ${t("cab.banque.pair.ref", { ref: bank.reference })}` : ""}
        </p>
        <p className="num mt-2 text-[16px] font-medium leading-none">
          {bank ? montant(bank.montant, locale) : "—"}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center gap-1.5 border-y border-border bg-secondary px-3 py-3 md:border-x md:border-y-0">
        <span
          className={cn("num text-[11px]", exact ? "text-signal-ok" : "text-signal-warn")}
          title={t("cab.banque.score")}
        >
          {pourcent}
        </span>
        <span aria-hidden className="block h-1 w-full max-w-[70px] bg-border">
          <span
            className={cn("block h-1", exact ? "bg-signal-ok" : "bg-signal-warn")}
            style={{ width: `${largeur}%` }}
          />
        </span>
        <span className="num text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("cab.banque.pair.ecart", {
            days: Math.abs(ecartJours),
            amount: montant(sansSigne(ecartMontant), locale),
          })}
        </span>
      </div>
      <div className="min-w-0 px-3.5 py-3">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("cab.banque.book")}
        </p>
        <p className="mt-1.5 text-[13px] font-medium">
          <EcritureRef book={book} titre={t("cab.banque.openpiece")} />
        </p>
        <p className="num mt-1 text-[11.5px] leading-[1.4] text-muted-foreground">
          {book ? dateCourte(book.at) : "—"}
          {book?.journal ? ` · ${book.journal}` : ""}
        </p>
        <p className="num mt-2 text-[16px] font-medium leading-none">
          {book ? montant(book.montant, locale) : "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-border px-3.5 py-3 md:flex-col md:border-s md:border-t-0">
        {actions}
      </div>
    </li>
  );
}

function CabinetRapprochement() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const dossierCourant = useDossierCourant();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [compteId, setCompteId] = useState<string | null>(null);
  const [period, setPeriod] = useState(currentPeriod);
  const [csv, setCsv] = useState("");
  const [importOuvert, setImportOuvert] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unmatch, setUnmatch] = useState<{ ligneId: string; motifId: string; note: string } | null>(
    null,
  );
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const basculer = (cle: string) => setOuverts((s) => ({ ...s, [cle]: !s[cle] }));

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const rows = clients.data ?? [];
  const client =
    rows.find((c) => c.tenantId === tenantId) ??
    // Sans choix ici, l'onglet s'ouvre sur le dossier courant du cabinet.
    rows.find((c) => c.tenantId === dossierCourant?.id) ??
    rows[0] ??
    null;

  const pack = useQuery({
    queryKey: ["pack", client?.jurisdiction],
    queryFn: () => office().referential.activePack(client!.jurisdiction),
    enabled: !!client,
  });
  const params = useQuery({
    queryKey: ["socle-params", pack.data?.id],
    queryFn: () => office().referential.socleParams(pack.data!.id),
    enabled: !!pack.data,
  });
  const motifs = useQuery({
    queryKey: ["motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });
  const comptes = useQuery({
    queryKey: ["banque-comptes", client?.tenantId],
    queryFn: () => office().banque.listAccounts(client!.tenantId),
    enabled: !!client,
  });
  const compteRows = comptes.data ?? [];
  const compte = compteRows.find((c) => c.id === compteId) ?? compteRows[0] ?? null;

  /*
   * ============================================ OUVRIR UN COMPTE BANCAIRE
   *
   * `banque.createAccount` existait dans le contrat ET dans l'API, avec sa
   * requête d'insertion — et AUCUN écran ne l'appelait. Le rapprochement était
   * donc inutilisable pour un dossier neuf : il affichait « aucun compte » et
   * n'offrait aucun moyen d'en ouvrir un. Un audit des méthodes jamais
   * atteintes l'a montré ; rien dans le code ne le disait.
   */
  const [ouvrirCompte, setOuvrirCompte] = useState(false);
  const [nouveauLabel, setNouveauLabel] = useState("");
  const [nouveauCode, setNouveauCode] = useState("");
  const [nouveauIban, setNouveauIban] = useState("");

  const creerCompte = useMutation({
    mutationFn: () =>
      office().banque.createAccount({
        tenantId: client!.tenantId,
        // L'entité est facultative : un dossier n'en a pas toujours plusieurs.
        entityId: null,
        label: nouveauLabel.trim(),
        iban: nouveauIban.trim() || null,
        devise: client!.currency,
        accountCode: nouveauCode.trim(),
      }),
    onSuccess: async (id) => {
      setError(null);
      setOuvrirCompte(false);
      setNouveauLabel("");
      setNouveauCode("");
      setNouveauIban("");
      await qc.invalidateQueries({ queryKey: ["banque-comptes", client?.tenantId] });
      setCompteId(id);
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/cabinet.rapprochement", t("common.error"))),
  });

  const compteValide = nouveauLabel.trim().length > 0 && nouveauCode.trim().length > 0;

  const lignes = useQuery({
    queryKey: ["banque-lignes", client?.tenantId, compte?.id],
    queryFn: () => office().banque.lines(client!.tenantId, compte!.id),
    enabled: !!client && !!compte,
  });

  const { from, to } = monthBounds(period);
  const bookLines = useQuery({
    queryKey: ["banque-book", client?.tenantId, compte?.accountCode, from, to],
    queryFn: () =>
      office().banque.bookLines({
        tenantId: client!.tenantId,
        accountCode: compte!.accountCode,
        from,
        to,
      }),
    enabled: !!client && !!compte,
  });
  const etat = useQuery({
    queryKey: ["banque-etat", client?.tenantId],
    queryFn: () => office().banque.etat(client!.tenantId),
    enabled: !!client,
  });
  const journal = useQuery({
    queryKey: ["banque-journal", client?.tenantId],
    queryFn: () => office().banque.lettrages(client!.tenantId),
    enabled: !!client,
  });
  const audit = useQuery({
    queryKey: ["banque-audit", client?.tenantId],
    queryFn: () => office().banque.audit(client!.tenantId),
    enabled: !!client,
  });

  /** L'appariement est déterministe : le Socle décide, l'écran ne fait que montrer. */
  const result = useMemo(() => {
    if (!params.data || !client || !compte || !lignes.data || !bookLines.data) return null;
    const bank = lignes.data
      .filter((l) => l.status === "ouverte")
      .map((l) => ({
        id: l.id,
        at: l.at,
        label: l.label,
        montant: l.montant,
        reference: l.reference,
      }));
    const book = bookLines.data
      .filter((b) => !b.lettree)
      .map((b) => ({
        id: b.id,
        at: b.at,
        label: b.label,
        montant: b.montant,
        reference: b.reference,
      }));
    if (bank.length === 0 || book.length === 0) return null;
    return computeRapprochement(
      {
        currency: compte.devise || client.currency,
        decimals: params.data.moneyDecimals,
        toleranceJours: params.data.rapprochementToleranceJours,
        toleranceMontant: params.data.rapprochementToleranceMontant,
      },
      bank,
      book,
    );
  }, [params.data, client, compte, lignes.data, bookLines.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["banque-lignes", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-book", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-etat", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-journal", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-audit", client?.tenantId] });
  };

  const importer = useMutation({
    mutationFn: async () => {
      if (!client || !compte) return { added: 0, skipped: 0 };
      const parsed = parseCsv(compte.id, csv);
      // Dédoublonnage local puis clé d'idempotence en base : deux murs, zéro doublon.
      const seen = new Set<string>();
      const unique = parsed.filter((l) => {
        if (seen.has(l.idempotencyKey)) return false;
        seen.add(l.idempotencyKey);
        return true;
      });
      const added = await office().banque.importLines({
        tenantId: client.tenantId,
        compteId: compte.id,
        batchId: crypto.randomUUID(),
        lines: unique,
      });
      return { added, skipped: parsed.length - added };
    },
    onSuccess: (r) => {
      setError(null);
      setCsv("");
      setImportInfo(t("cab.banque.imported", { added: r.added, skipped: r.skipped }));
      refresh();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/cabinet.rapprochement", t("common.error"))),
  });

  const lettrer = useMutation({
    mutationFn: async (paire: {
      bank_id: string;
      book_id: string;
      score: number;
      ecart_montant: string;
      ecart_jours: number;
      reference_exacte: boolean;
    }) => {
      // Le bouton est inactif sans pack ; ceci ne sert qu'à ne jamais lettrer sans version.
      if (!pack.data) throw new Error("pack.missing");
      await office().banque.lettrer({
        ligneId: paire.bank_id,
        ecritureId: paire.book_id,
        score: paire.score,
        ecartMontant: paire.ecart_montant,
        ecartJours: paire.ecart_jours,
        referenceExacte: paire.reference_exacte,
        packVersionId: pack.data.id,
      });
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/cabinet.rapprochement", t("common.error"))),
  });

  const delettrer = useMutation({
    mutationFn: async (input: { ligneId: string; motifId: string; note: string }) => {
      await office().banque.delettrer({
        ligneId: input.ligneId,
        motifId: input.motifId,
        note: input.note.trim() ? input.note.trim() : null,
      });
    },
    onSuccess: () => {
      setError(null);
      setUnmatch(null);
      refresh();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/cabinet.rapprochement", t("common.error"))),
  });

  const ignorer = useMutation({
    mutationFn: (ligneId: string) => office().banque.setLineStatus(ligneId, "ignoree"),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/cabinet.rapprochement", t("common.error"))),
  });

  useMalicaPanel(<MalicaNote>{t("cab.banque.voice")}</MalicaNote>, [locale]);

  /* ---- ce que l'écran lit */
  const lignesRows = lignes.data ?? [];
  const bookRows = bookLines.data ?? [];
  const bookById = new Map(bookRows.map((b) => [b.id, b]));
  const bankById = new Map(lignesRows.map((b) => [b.id, b]));
  const motifRows = motifs.data ?? [];
  const motifById = new Map(motifRows.map((m) => [m.id, m]));
  const actifs = (etat.data ?? []).filter((e) => e.active);
  const ouvertes = lignesRows.filter((l) => l.status === "ouverte");
  const nonLettrees = bookRows.filter((b) => !b.lettree);
  const rapprochees = lignesRows.filter((l) => l.status === "rapprochee").length;
  const decimals = params.data?.moneyDecimals;
  const devise = compte?.devise || client?.currency || "";
  // Sans pack, la lecture des paramètres n'est jamais lancée : elle resterait
  // « en attente » pour toujours, et l'écran avec elle. On n'attend donc les
  // paramètres que lorsqu'un pack existe.
  const chargement =
    !!compte &&
    (lignes.isPending ||
      bookLines.isPending ||
      pack.isPending ||
      (!!pack.data && params.isPending));

  /*
   * Les totaux : l'addition exacte, en entiers, de ce que le Socle a rendu.
   * Ce n'est pas un moteur — rien ici ne décide d'un appariement — et le
   * chiffre se lit même quand un côté est vide, là où le moteur se tait.
   */
  const totaux =
    decimals !== undefined && compte
      ? (() => {
          const bank = sommeDecimale(
            ouvertes.map((l) => l.montant),
            decimals,
          );
          const book = sommeDecimale(
            nonLettrees.map((b) => b.montant),
            decimals,
          );
          return { bank, book, ecart: sommeDecimale([bank, oppose(book)], decimals) };
        })()
      : null;

  /* ---- les orphelines : ce que le moteur n'a pas su apparier */
  const orphelinesBanque = result
    ? result.bank_orphelines.flatMap((id) => {
        const l = bankById.get(id);
        return l ? [l] : [];
      })
    : ouvertes;
  const orphelinesLivre = result
    ? result.book_orphelines.flatMap((id) => {
        const b = bookById.get(id);
        return b ? [b] : [];
      })
    : nonLettrees;

  /* ---- formats */
  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const horodatage = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const moisLong = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));
  const pourcent = (n: number, total: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(n / total);

  const kicker = compte
    ? [compte.label, compte.iban, moisLong].filter(Boolean).join(" · ")
    : t("cab.banque.noaccount");

  const kpis = [
    {
      key: "releve",
      label: t("cab.banque.kpi.releve"),
      value: totaux ? montant(totaux.bank, locale) : "—",
      ctx: `${devise} · ${t("cab.banque.kpi.releve.ctx", { count: ouvertes.length })}`,
      tone: "",
    },
    {
      key: "book",
      label: t("cab.banque.kpi.book"),
      value: totaux ? montant(totaux.book, locale) : "—",
      ctx: `${devise} · ${t("cab.banque.kpi.book.ctx", { count: nonLettrees.length })}`,
      tone: "",
    },
    {
      key: "ecart",
      label: t("cab.banque.ecart"),
      value: totaux ? montant(totaux.ecart, locale) : "—",
      ctx: `${devise} · ${t("cab.banque.kpi.ecart.ctx")}`,
      tone: totaux ? (estNul(totaux.ecart, decimals) ? "text-signal-ok" : "text-signal-warn") : "",
    },
    {
      key: "taux",
      label: t("cab.banque.kpi.rapprochees"),
      value: lignesRows.length > 0 ? pourcent(rapprochees, lignesRows.length) : "—",
      ctx:
        lignesRows.length > 0
          ? t("cab.banque.kpi.rapprochees.ctx", { n: rapprochees, count: lignesRows.length })
          : t("cab.banque.nolines"),
      tone: rapprochees > 0 ? "text-signal-ok" : "",
    },
  ];

  const champ =
    "border border-border bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal";
  const etiquette =
    "flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide";
  const boutonPierre =
    "border border-border bg-card px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-50";

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <EnTeteCabinet
        surtitre={<>{kicker}</>}
        titre={<>{t("cab.banque.title")}</>}
        actions={
          <>
            {rows.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <ClientPicker
                  label={t("cab.queue.client")}
                  clients={rows}
                  value={client?.tenantId ?? null}
                  onChange={(id) => {
                    setTenantId(id);
                    const choisi = rows.find((c) => c.tenantId === id);
                    if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
                    setCompteId(null);
                    setImportInfo(null);
                    setError(null);
                    setUnmatch(null);
                  }}
                />
                {compteRows.length > 0 ? (
                  <label className={etiquette}>
                    <span className="text-muted-foreground">{t("cab.banque.account")}</span>
                    <select
                      value={compte?.id ?? ""}
                      onChange={(e) => setCompteId(e.target.value)}
                      className={champ}
                    >
                      {compteRows.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={etiquette}>
                  <span className="text-muted-foreground">{t("pme.tva.period")}</span>
                  <input
                    type="month"
                    value={period}
                    onChange={(e) => e.target.value && setPeriod(e.target.value)}
                    className={cn("num", champ)}
                  />
                </label>
                {compteRows.length > 0 && !ouvrirCompte ? (
                  <button
                    type="button"
                    onClick={() => setOuvrirCompte(true)}
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                  >
                    {t("cab.banque.newaccount")}
                  </button>
                ) : null}
                {compte ? (
                  <button
                    type="button"
                    onClick={() => setImportOuvert((v) => !v)}
                    aria-expanded={importOuvert}
                    className={boutonPierre}
                  >
                    {t("cab.banque.import")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <>
          {error ? (
            <p
              className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[13px]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {/* Sans pack, aucune tolérance ne se lit : le lettrage attend, et on le dit. */}
          {pack.isSuccess && pack.data === null ? (
            <p
              className="border border-s-2 border-border border-s-marigold bg-card px-3 py-2 text-[13px]"
              role="alert"
            >
              {t("cab.banque.sansPack")}
            </p>
          ) : null}

          {/* ---- ouvrir un compte : offert dans l'état vide, et sur demande
                 quand il y en a déjà — un dossier a plusieurs banques. */}
          {compteRows.length === 0 || ouvrirCompte ? (
            <section className="space-y-3 border border-border bg-card p-4">
              <SectionTitle>{t("cab.banque.newaccount")}</SectionTitle>
              {compteRows.length === 0 ? (
                <p className="text-[12.5px] text-text-2">{t("cab.banque.noaccount")}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    key: "label",
                    libelle: t("cab.banque.newaccount.label"),
                    valeur: nouveauLabel,
                    poser: setNouveauLabel,
                    mono: false,
                  },
                  {
                    key: "code",
                    libelle: t("cab.banque.newaccount.code"),
                    valeur: nouveauCode,
                    poser: setNouveauCode,
                    mono: true,
                  },
                  {
                    key: "iban",
                    libelle: t("cab.banque.newaccount.iban"),
                    valeur: nouveauIban,
                    poser: setNouveauIban,
                    mono: true,
                  },
                ].map((c) => (
                  <label key={c.key} className="flex flex-col gap-1">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {c.libelle}
                    </span>
                    <input
                      value={c.valeur}
                      onChange={(e) => c.poser(e.target.value)}
                      inputMode={c.key === "code" ? "numeric" : undefined}
                      className={cn(
                        "border border-border bg-background px-2.5 py-2 text-[13px]",
                        c.mono && "num",
                      )}
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <ActionButton
                  variant="ink"
                  onClick={() => creerCompte.mutate()}
                  disabled={!client || !compteValide || creerCompte.isPending}
                >
                  {t("cab.banque.newaccount.create")}
                </ActionButton>
                {compteRows.length > 0 ? (
                  <ActionButton onClick={() => setOuvrirCompte(false)}>
                    {t("common.cancel")}
                  </ActionButton>
                ) : null}
              </div>
            </section>
          ) : null}

          {compte ? (
            <>
              {/* ---- l'import, derrière le bouton du masthead */}
              {importOuvert ? (
                <section className="space-y-3 border border-border bg-card p-4">
                  <SectionTitle
                    action={
                      <button
                        type="button"
                        onClick={() => setImportOuvert(false)}
                        className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                      >
                        {t("common.cancel")}
                      </button>
                    }
                  >
                    {t("cab.banque.import")}
                  </SectionTitle>
                  <p className="text-[12.5px] text-text-2">{t("cab.banque.csvhint")}</p>
                  <textarea
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    rows={5}
                    spellCheck={false}
                    aria-label={t("cab.banque.import")}
                    className="num w-full border border-border bg-background p-2 text-[12px]"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <ActionButton
                      variant="ink"
                      disabled={importer.isPending || csv.trim().length === 0}
                      onClick={() => importer.mutate()}
                    >
                      {t("cab.banque.importrun")}
                    </ActionButton>
                    {importInfo ? (
                      <span className="num text-[12px] text-muted-foreground">{importInfo}</span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* ---- les chiffres */}
              <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                {kpis.map((k) => (
                  <div key={k.key} className="bg-card px-4 py-4">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {k.label}
                    </p>
                    <p
                      className={cn(
                        "num mt-3 whitespace-nowrap text-[26px] font-medium leading-none tracking-tight",
                        k.tone,
                      )}
                    >
                      {k.value}
                    </p>
                    <p className="num mt-2.5 text-[11px] text-muted-foreground">{k.ctx}</p>
                  </div>
                ))}
              </div>

              {/* ---- les appariements proposés */}
              <section className="space-y-3">
                <SectionTitle
                  action={
                    params.data ? (
                      <span className="num text-[10.5px] text-muted-foreground">
                        {t("cab.banque.tolerances", {
                          days: params.data.rapprochementToleranceJours,
                          amount: montant(params.data.rapprochementToleranceMontant, locale),
                          currency: devise,
                        })}
                      </span>
                    ) : null
                  }
                >
                  {t("cab.banque.suggest")}
                </SectionTitle>
                {chargement ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : !result || result.paires.length === 0 ? (
                  <EmptyState>{t("cab.banque.nopair")}</EmptyState>
                ) : (
                  <ul className="space-y-2">
                    {result.paires.map((p) => (
                      <CarteAppariement
                        key={`${p.bank_id}-${p.book_id}`}
                        bank={bankById.get(p.bank_id)}
                        book={bookById.get(p.book_id)}
                        score={p.score}
                        ecartMontant={p.ecart_montant}
                        ecartJours={p.ecart_jours}
                        decimals={decimals}
                        t={t}
                        locale={locale}
                        dateCourte={dateCourte}
                        actions={
                          <>
                            <ActionButton
                              variant="ink"
                              disabled={lettrer.isPending || !pack.data}
                              onClick={() => lettrer.mutate(p)}
                            >
                              {t("cab.banque.match")}
                            </ActionButton>
                            <ActionButton
                              disabled={ignorer.isPending}
                              onClick={() => ignorer.mutate(p.bank_id)}
                            >
                              {t("cab.banque.ignore")}
                            </ActionButton>
                          </>
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>

              {/* ---- ce qui reste sans vis-à-vis */}
              <div className="grid gap-6 md:grid-cols-2">
                <section>
                  <SectionTitle>{t("cab.banque.orphansbank")}</SectionTitle>
                  {chargement ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : orphelinesBanque.length === 0 ? (
                    <p className="mt-3 text-[12.5px] text-muted-foreground">
                      {t("cab.banque.noorphansbank")}
                    </p>
                  ) : (
                    <ul className="mt-3 grid gap-px border border-border bg-border">
                      {orphelinesBanque.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-baseline justify-between gap-3 bg-card px-3 py-2 text-[12.5px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{l.label}</span>
                            <span className="num block text-[10.5px] text-muted-foreground">
                              {dateCourte(l.at)}
                              {l.reference
                                ? ` · ${t("cab.banque.pair.ref", { ref: l.reference })}`
                                : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-baseline gap-3">
                            <span className="num whitespace-nowrap text-[12px] font-medium">
                              {montant(l.montant, locale)}
                            </span>
                            <button
                              type="button"
                              disabled={ignorer.isPending}
                              onClick={() => ignorer.mutate(l.id)}
                              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              {t("cab.banque.ignore")}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <SectionTitle>{t("cab.banque.orphansbook")}</SectionTitle>
                  {chargement ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : orphelinesLivre.length === 0 ? (
                    <p className="mt-3 text-[12.5px] text-muted-foreground">
                      {bookRows.length === 0
                        ? t("cab.banque.nobook")
                        : t("cab.banque.noorphansbook")}
                    </p>
                  ) : (
                    <ul className="mt-3 grid gap-px border border-border bg-border">
                      {orphelinesLivre.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-baseline justify-between gap-3 bg-card px-3 py-2 text-[12.5px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">
                              <EcritureRef book={b} titre={t("cab.banque.openpiece")} />
                            </span>
                            <span className="num block text-[10.5px] text-muted-foreground">
                              {dateCourte(b.at)}
                              {b.journal ? ` · ${b.journal}` : ""}
                            </span>
                          </span>
                          <span className="num shrink-0 whitespace-nowrap text-[12px] font-medium">
                            {montant(b.montant, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {/* ---- les appariements retenus : on délettre avec un motif */}
              <section className="space-y-3">
                <SectionTitle
                  action={
                    <span className="num text-[10.5px] text-muted-foreground">
                      {t("cab.banque.lignes.count", { count: actifs.length })}
                    </span>
                  }
                >
                  {t("cab.banque.matched")}
                </SectionTitle>
                {actifs.length === 0 ? (
                  <EmptyState>{t("cab.banque.nomatched")}</EmptyState>
                ) : (
                  <ul className="space-y-2">
                    {actifs.map((e) => {
                      const open = unmatch?.ligneId === e.ligneId;
                      const motif = open ? motifById.get(unmatch!.motifId) : undefined;
                      return (
                        <CarteAppariement
                          key={e.ligneId}
                          bank={bankById.get(e.ligneId)}
                          book={bookById.get(e.ecritureId)}
                          score={e.score}
                          ecartMontant={e.ecartMontant}
                          ecartJours={e.ecartJours}
                          decimals={decimals}
                          t={t}
                          locale={locale}
                          dateCourte={dateCourte}
                          actions={
                            open ? (
                              <div className="w-full min-w-[220px] space-y-2">
                                <select
                                  aria-label={t("cab.banque.motif")}
                                  value={unmatch!.motifId}
                                  onChange={(ev) =>
                                    setUnmatch({ ...unmatch!, motifId: ev.target.value })
                                  }
                                  className="w-full border border-border bg-card px-2 py-1.5 text-[12px]"
                                >
                                  <option value="">—</option>
                                  {motifRows.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                                {motif?.requiresNote ? (
                                  <input
                                    aria-label={t("cab.banque.note")}
                                    value={unmatch!.note}
                                    onChange={(ev) =>
                                      setUnmatch({ ...unmatch!, note: ev.target.value })
                                    }
                                    className="w-full border border-border bg-card px-2 py-1.5 text-[12px]"
                                    placeholder={t("cab.banque.note")}
                                  />
                                ) : null}
                                <div className="flex flex-wrap gap-1.5">
                                  <ActionButton
                                    variant="ink"
                                    disabled={
                                      delettrer.isPending ||
                                      !unmatch!.motifId ||
                                      (!!motif?.requiresNote && unmatch!.note.trim().length === 0)
                                    }
                                    onClick={() => delettrer.mutate(unmatch!)}
                                  >
                                    {t("cab.banque.unmatch")}
                                  </ActionButton>
                                  <ActionButton onClick={() => setUnmatch(null)}>
                                    {t("common.cancel")}
                                  </ActionButton>
                                </div>
                              </div>
                            ) : (
                              <ActionButton
                                onClick={() =>
                                  setUnmatch({ ligneId: e.ligneId, motifId: "", note: "" })
                                }
                              >
                                {t("cab.banque.unmatch")}
                              </ActionButton>
                            )
                          }
                        />
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* ---- le relevé complet, replié */}
              <SectionRepliable
                titre={t("cab.banque.lines")}
                ouvert={!!ouverts["lignes"]}
                onBascule={() => basculer("lignes")}
                resume={
                  <span className="num">
                    {t("cab.banque.lignes.count", { count: lignesRows.length })}
                  </span>
                }
              >
                {lignes.isPending ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : lignesRows.length === 0 ? (
                  <EmptyState>{t("cab.banque.nolines")}</EmptyState>
                ) : (
                  <InkTable
                    caption={t("cab.banque.lines")}
                    head={[
                      t("cab.stocks.date"),
                      t("cab.banque.label"),
                      t("cab.banque.amount"),
                      t("cab.banque.reference"),
                      t("cab.banque.status"),
                      "",
                    ]}
                  >
                    {lignesRows.map((l) => (
                      <InkTableRow key={l.id}>
                        <InkCell numeric>{dateCourte(l.at)}</InkCell>
                        <InkCell>{l.label}</InkCell>
                        <InkCell numeric>{montant(l.montant, locale)}</InkCell>
                        <InkCell numeric>{l.reference ?? "—"}</InkCell>
                        <InkCell>
                          <span
                            className={cn(
                              "border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              l.status === "rapprochee"
                                ? "border-foreground"
                                : "border-border text-muted-foreground",
                            )}
                          >
                            {t(`cab.banque.status.${l.status}`)}
                          </span>
                        </InkCell>
                        <InkCell>
                          {l.status === "ouverte" ? (
                            <ActionButton
                              disabled={ignorer.isPending}
                              onClick={() => ignorer.mutate(l.id)}
                            >
                              {t("cab.banque.ignore")}
                            </ActionButton>
                          ) : null}
                        </InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                )}
              </SectionRepliable>

              {/* ---- les écritures du compte, repliées */}
              <SectionRepliable
                titre={t("cab.banque.booklines")}
                ouvert={!!ouverts["ecritures"]}
                onBascule={() => basculer("ecritures")}
                resume={
                  <span className="num">
                    {t("cab.banque.ecritures.count", { count: bookRows.length })}
                  </span>
                }
              >
                {bookRows.length === 0 ? (
                  <EmptyState>{t("cab.banque.nobook")}</EmptyState>
                ) : (
                  <InkTable
                    caption={t("cab.banque.booklines")}
                    head={[
                      t("cab.stocks.date"),
                      t("cab.banque.label"),
                      t("cab.banque.amount"),
                      t("cab.banque.piece"),
                      t("cab.banque.status"),
                    ]}
                  >
                    {bookRows.map((b) => (
                      <InkTableRow key={b.id}>
                        <InkCell numeric>{dateCourte(b.at)}</InkCell>
                        <InkCell>
                          <EcritureRef book={b} titre={t("cab.banque.openpiece")} />
                        </InkCell>
                        <InkCell numeric>{montant(b.montant, locale)}</InkCell>
                        <InkCell>
                          {b.pieceId ? (
                            <Link
                              to="/cabinet/piece/$pieceId"
                              params={{ pieceId: b.pieceId }}
                              className="underline decoration-dotted underline-offset-4"
                            >
                              {t("cab.banque.openpiece")}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </InkCell>
                        <InkCell>
                          {b.lettree ? (
                            <span className="border border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                              {t("cab.banque.lettree")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                )}
              </SectionRepliable>

              {/* ---- le journal des décisions, replié */}
              <SectionRepliable
                titre={t("cab.banque.journal")}
                ouvert={!!ouverts["journal"]}
                onBascule={() => basculer("journal")}
                resume={
                  <span className="num">
                    {t("cab.banque.decisions.count", { count: (journal.data ?? []).length })}
                  </span>
                }
              >
                {(journal.data ?? []).length === 0 ? (
                  <EmptyState>{t("cab.banque.nojournal")}</EmptyState>
                ) : (
                  <InkTable
                    caption={t("cab.banque.journal")}
                    head={[
                      t("cab.banque.when"),
                      t("cab.banque.action"),
                      t("cab.banque.line"),
                      t("cab.banque.book"),
                      t("cab.banque.motif"),
                      t("cab.banque.note"),
                    ]}
                  >
                    {(journal.data ?? []).map((l) => (
                      <InkTableRow key={l.id}>
                        <InkCell numeric>{horodatage(l.createdAt)}</InkCell>
                        <InkCell>{t(`cab.banque.action.${l.action}`)}</InkCell>
                        <InkCell>{bankById.get(l.ligneId)?.label ?? "—"}</InkCell>
                        <InkCell>
                          <EcritureRef
                            book={bookById.get(l.ecritureId)}
                            titre={t("cab.banque.openpiece")}
                          />
                        </InkCell>
                        <InkCell>
                          {l.motifId ? (motifById.get(l.motifId)?.label ?? "—") : "—"}
                        </InkCell>
                        <InkCell>{l.note ?? "—"}</InkCell>
                      </InkTableRow>
                    ))}
                  </InkTable>
                )}
              </SectionRepliable>

              {/* ---- la piste d'audit, repliée : le geste et son motif, jamais la charge brute */}
              <SectionRepliable
                titre={t("cab.banque.audit")}
                ouvert={!!ouverts["audit"]}
                onBascule={() => basculer("audit")}
                resume={
                  <span className="num">
                    {t("cab.banque.evenements.count", { count: (audit.data ?? []).length })}
                  </span>
                }
              >
                {(audit.data ?? []).length === 0 ? (
                  <EmptyState>{t("cab.banque.noaudit")}</EmptyState>
                ) : (
                  <ol className="divide-y divide-border border border-border bg-card">
                    {(audit.data ?? []).map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2"
                      >
                        <span className="min-w-0 text-[12.5px]">
                          {t(GESTES[a.action] ?? "cab.audit.autre")}
                          {a.motifId && motifById.get(a.motifId) ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {motifById.get(a.motifId)!.label}
                            </span>
                          ) : null}
                        </span>
                        <span className="num shrink-0 text-[10.5px] text-muted-foreground">
                          {horodatage(a.at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </SectionRepliable>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
