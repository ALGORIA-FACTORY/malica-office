/**
 * Intégrations et API — ce qui entre et ce qui sort du Socle.
 *
 * ============================================================== POURQUOI
 *
 * Le panneau ne déclare aucun connecteur : il montre ce qui existe dans le
 * produit et ce que la base en dit. L'application PME, l'import des relevés,
 * l'export des écritures, l'API du cabinet — quatre chemins réels, et pour
 * chacun un état lu dans les tables, jamais écrit ici.
 *
 * La clé du cabinet est rendue en clair une seule fois, à sa création. Ensuite
 * on n'en voit que le préfixe et le suffixe : de quoi la reconnaître, pas de
 * quoi la reconstituer. Une clé ne s'efface pas, elle se révoque.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useCabinet } from "@/components/regalica/cabinet-context";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { CleApi, CleApiCreee } from "@/verticals/regalica-office/ports/repositories";

/** Toute clé commence ainsi ; l'écran ne montre que ce qui suit, tronqué. */
const PREFIXE_CLE = "rgo_live_";
const MASQUE = "·".repeat(10);

const PORTEES: Record<string, MessageKey> = {
  "ecritures.lire": "cab.integ.portee.lire",
  "pieces.deposer": "cab.integ.portee.deposer",
};

type Ton = "ok" | "info" | "muet";
const OU = "components/regalica/integrations-panel";

export function IntegrationsEtApi() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const etat = useQuery({
    queryKey: ["cab-integrations-etat", org.id],
    queryFn: () => office().integrations.etat(org.id),
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(iso),
    );

  const e = etat.data;
  const cartes: Array<{
    cle: string;
    nom: string;
    nature: string;
    note: string;
    etat: string;
    ton: Ton;
    action?: React.ReactNode;
  }> = [
    {
      cle: "app",
      nom: t("cab.integ.app.nom"),
      nature: t("cab.integ.app.nature"),
      note: t("cab.integ.app.note"),
      etat: !e
        ? "…"
        : e.piecesApp30j > 0
          ? t("cab.integ.etat.pieces", { count: e.piecesApp30j })
          : e.dernierePieceApp
            ? t("cab.integ.etat.dernierePiece", { date: date(e.dernierePieceApp) })
            : t("cab.integ.etat.aucunePiece"),
      ton: !e ? "muet" : e.piecesApp30j > 0 ? "ok" : e.dernierePieceApp ? "info" : "muet",
      action: (
        <Link to="/cabinet" className={classeAction}>
          {t("cab.integ.app.action")}
        </Link>
      ),
    },
    {
      cle: "releves",
      nom: t("cab.integ.releves.nom"),
      nature: t("cab.integ.releves.nature"),
      note: t("cab.integ.releves.note"),
      etat: !e
        ? "…"
        : e.lignesReleves30j > 0
          ? t("cab.integ.etat.lignes", { count: e.lignesReleves30j })
          : e.dernierImportReleve
            ? t("cab.integ.etat.dernierImport", { date: date(e.dernierImportReleve) })
            : t("cab.integ.etat.aucunImport"),
      ton: !e ? "muet" : e.lignesReleves30j > 0 ? "ok" : e.dernierImportReleve ? "info" : "muet",
      action: (
        <Link to="/cabinet/rapprochement" className={classeAction}>
          {t("cab.integ.releves.action")}
        </Link>
      ),
    },
    {
      cle: "exports",
      nom: t("cab.integ.exports.nom"),
      nature: t("cab.integ.exports.nature"),
      note: t("cab.integ.exports.note"),
      etat: !e
        ? "…"
        : e.exports30j > 0
          ? t("cab.integ.etat.exports", { count: e.exports30j })
          : e.dernierExport
            ? t("cab.integ.etat.dernierExport", { date: date(e.dernierExport) })
            : t("cab.integ.etat.aucunExport"),
      ton: !e ? "muet" : e.exports30j > 0 ? "ok" : e.dernierExport ? "info" : "muet",
      action: (
        <Link to="/cabinet/export" className={classeAction}>
          {t("cab.integ.exports.action")}
        </Link>
      ),
    },
    {
      cle: "api",
      nom: t("cab.integ.api.nom"),
      nature: t("cab.integ.api.nature"),
      note: t("cab.integ.api.note"),
      etat: !e
        ? "…"
        : e.clesActives > 0
          ? [
              t("cab.integ.etat.cle", { count: e.clesActives }),
              e.dernierUsage
                ? t("cab.integ.etat.dernierAppel", { date: date(e.dernierUsage) })
                : t("cab.integ.etat.jamaisAppelee"),
            ].join(" · ")
          : t("cab.integ.etat.aucuneCle"),
      ton: !e ? "muet" : e.clesActives > 0 ? (e.dernierUsage ? "ok" : "info") : "muet",
      action: (
        <a href="#cle-du-cabinet" className={classeAction}>
          {t("cab.integ.api.action")}
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <p className="max-w-[66ch] text-[13.5px] leading-[1.6] text-text-2">{t("cab.integ.lede")}</p>

      {etat.isError ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {texteDeLErreur(etat.error, OU, t("common.error"))}
        </p>
      ) : null}

      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {cartes.map((c) => (
          <article key={c.cle} className="flex flex-col gap-3.5 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-[-0.01em]">{c.nom}</span>
                <span className="num mt-1 block text-[10.5px] text-muted-foreground">
                  {c.nature}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0",
                  c.ton === "ok"
                    ? "bg-signal-ok"
                    : c.ton === "info"
                      ? "bg-signal-info"
                      : "bg-border",
                )}
              />
            </div>
            <p className="text-[12.5px] leading-[1.6] text-text-2">{c.note}</p>
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
              <span
                className={cn(
                  "text-[9.5px] font-semibold uppercase tracking-[0.14em]",
                  c.ton === "ok"
                    ? "text-signal-ok"
                    : c.ton === "info"
                      ? "text-signal-info"
                      : "text-muted-foreground",
                )}
              >
                {c.etat}
              </span>
              {c.action}
            </div>
          </article>
        ))}
      </div>

      <CleDuCabinet />
    </div>
  );
}

const classeAction =
  "border border-border bg-card px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] hover:border-foreground hover:bg-foreground hover:text-background";

/* ============================================================ la clé du cabinet */

function CleDuCabinet() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const cles = useQuery({
    queryKey: ["cab-integrations-cles", org.id],
    queryFn: () => office().integrations.cles(org.id),
  });

  const [libelle, setLibelle] = useState("");
  const [lire, setLire] = useState(true);
  const [deposer, setDeposer] = useState(true);
  const [nouvelle, setNouvelle] = useState<CleApiCreee | null>(null);
  const [aRevoquer, setARevoquer] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["cab-integrations-cles", org.id] }),
      qc.invalidateQueries({ queryKey: ["cab-integrations-etat", org.id] }),
    ]);

  const creer = useMutation({
    mutationFn: () =>
      office().integrations.creerCle(
        org.id,
        libelle.trim(),
        Object.keys(PORTEES).filter((p) => (p === "ecritures.lire" ? lire : deposer)),
      ),
    onSuccess: async (creee) => {
      setErreur(null);
      setMessage(null);
      setNouvelle(creee);
      setLibelle("");
      await rafraichir();
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const revoquer = useMutation({
    mutationFn: (id: string) => office().integrations.revoquerCle(id),
    onSuccess: async (_r, id) => {
      setErreur(null);
      setARevoquer(null);
      setMessage(t("cab.integ.cle.revoquee.faite"));
      if (nouvelle?.id === id) setNouvelle(null);
      await rafraichir();
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const copier = async (texte: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setErreur(null);
      setMessage(t("cab.integ.cle.copiee"));
    } catch {
      setMessage(null);
      setErreur(t("cab.integ.cle.copieImpossible"));
    }
  };

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(iso),
    );
  const masquee = (k: CleApi) => `${PREFIXE_CLE}${k.prefixe}${MASQUE}${k.suffixe}`;
  const portees = (codes: string[]) =>
    codes.map((p) => (PORTEES[p] ? t(PORTEES[p]!) : p)).join(" · ");
  const champ =
    "border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const liste = cles.data ?? [];

  return (
    <section id="cle-du-cabinet" className="space-y-6">
      {/* ---- la clé, sur encre : c'est elle qui engage */}
      <div className="border border-border bg-foreground p-4 text-background">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-ink">
          {t("cab.integ.cle.titre")}
        </p>

        {nouvelle ? (
          <div className="mt-3.5 space-y-3">
            <p className="max-w-[70ch] text-[12.5px] leading-[1.6]">
              {t("cab.integ.cle.nouvelle")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="num min-w-[240px] flex-1 overflow-x-auto whitespace-nowrap border border-background/30 px-3 py-2.5 text-[12.5px]">
                {nouvelle.cle}
              </code>
              <button
                type="button"
                onClick={() => copier(nouvelle.cle)}
                className="border border-background bg-background px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground hover:bg-marigold"
              >
                {t("cab.integ.cle.copier")}
              </button>
              <button
                type="button"
                onClick={() => setNouvelle(null)}
                className="border border-background/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] hover:border-background"
              >
                {t("cab.integ.cle.fermer")}
              </button>
            </div>
          </div>
        ) : cles.isPending ? (
          <p className="mt-3.5 text-[12.5px] text-background/60">{t("common.loading")}</p>
        ) : cles.isError ? (
          <p role="alert" className="mt-3.5 text-[12.5px] text-marigold-on-ink">
            {texteDeLErreur(cles.error, OU, t("common.error"))}
          </p>
        ) : liste.length === 0 ? (
          <p className="mt-3.5 max-w-[70ch] text-[12.5px] leading-[1.6] text-background/60">
            {t("cab.integ.cle.vide")}
          </p>
        ) : (
          <ul className="mt-3.5 divide-y divide-background/15">
            {liste.map((k) => (
              <li
                key={k.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 py-3",
                  k.revokedAt ? "text-background/45" : "",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{k.libelle}</span>
                  <code className="num mt-1 block overflow-x-auto whitespace-nowrap text-[12px]">
                    {masquee(k)}
                  </code>
                  <span className="mt-1 block text-[10.5px] text-background/60">
                    {[
                      portees(k.portees),
                      t("cab.integ.cle.creee", { date: date(k.createdAt) }),
                      k.revokedAt
                        ? t("cab.integ.cle.revoquee", { date: date(k.revokedAt) })
                        : k.lastUsedAt
                          ? t("cab.integ.cle.usage", { date: date(k.lastUsedAt) })
                          : t("cab.integ.cle.jamais"),
                    ].join(" · ")}
                  </span>
                </span>
                {k.revokedAt ? null : aRevoquer === k.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-background/70">
                      {t("cab.integ.cle.revoquer.sur")}
                    </span>
                    <button
                      type="button"
                      disabled={revoquer.isPending}
                      onClick={() => revoquer.mutate(k.id)}
                      className="border border-background bg-background px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-foreground hover:bg-marigold disabled:opacity-40"
                    >
                      {t("cab.integ.cle.revoquer.oui")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setARevoquer(null)}
                      className="border border-background/40 px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] hover:border-background"
                    >
                      {t("cab.integ.cle.revoquer.non")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setARevoquer(k.id)}
                    className="border border-background/40 px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] hover:border-background"
                  >
                    {t("cab.integ.cle.revoquer")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3.5 max-w-[70ch] text-[12px] leading-[1.6] text-background/60">
          {t("cab.integ.cle.portee")}
        </p>
      </div>

      {/* ---- créer une clé : même motif que les groupes de réglages */}
      <section className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.integ.cle.creer.titre")}
          </p>
          <p className="mt-1 text-[12px] text-text-2">{t("cab.integ.cle.creer.lede")}</p>
        </div>
        <dl className="divide-y divide-border">
          <Ligne label={t("cab.integ.cle.libelle")} hint={t("cab.integ.cle.libelle.hint")}>
            <input
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              aria-label={t("cab.integ.cle.libelle")}
              className={cn(champ, "w-[220px]")}
            />
          </Ligne>
          <Ligne label={t("cab.integ.portee.lire")} hint={t("cab.integ.portee.lire.hint")}>
            <Interrupteur actif={lire} label={t("cab.integ.portee.lire")} onChange={setLire} />
          </Ligne>
          <Ligne label={t("cab.integ.portee.deposer")} hint={t("cab.integ.portee.deposer.hint")}>
            <Interrupteur
              actif={deposer}
              label={t("cab.integ.portee.deposer")}
              onChange={setDeposer}
            />
          </Ligne>
        </dl>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={creer.isPending || libelle.trim() === "" || (!lire && !deposer)}
            onClick={() => creer.mutate()}
            className="border border-foreground bg-foreground px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:text-foreground disabled:opacity-40"
          >
            {t("cab.integ.cle.creer")}
          </button>
          {message ? <span className="text-[12.5px] text-signal-ok">{message}</span> : null}
          {erreur ? (
            <span role="alert" className="text-[12.5px] text-signal-stop">
              {erreur}
            </span>
          ) : null}
        </div>
      </section>
    </section>
  );
}

/* ====================================== le motif des lignes de réglage, repris */

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
