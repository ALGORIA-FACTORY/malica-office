import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { usePme } from "@/components/regalica/pme-context";
import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { sommeDecimale } from "@regalica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { PieceLue } from "@regalica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/list")({
  head: () => ({
    meta: [
      { title: "Vos documents — Regalica Office" },
      {
        name: "description",
        content: "Ce que Regalica a lu et classé, par mois ou par année.",
      },
      { property: "og:title", content: "Vos documents — Regalica Office" },
      {
        property: "og:description",
        content: "Ce que Regalica a lu et classé, par mois ou par année.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VosDocuments,
});

/** Quatre mois en pastilles : au-delà, on passe à la vue année. */
const MOIS_VISIBLES = 4;

function moisEnArriere(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

/**
 * Vos documents — classés par elle, mois / année / type.
 *
 * ===================================================== CE QUE LE TYPE N'EST PAS
 *
 * Le prototype propose cinq filtres : tous, achats, ventes, banque, fiscal.
 * Notre contrat de lecture n'en connaît que deux — `facture_achat` et
 * `facture_vente`. Les pastilles sont donc construites SUR CE QUI EXISTE
 * réellement dans le dossier, jamais sur la liste de la maquette : un filtre
 * « Banque » qui ne rend jamais rien apprend au dirigeant à ne plus toucher
 * les filtres.
 *
 * ======================================================== CE QUI EST GROUPÉ
 *
 * Par type, avec son compte et son total — c'est la même clé que « comment je
 * les ai classés » en vue année, et les deux doivent dire la même chose.
 *
 * Le montant d'une pièce vient de sa lecture. Une pièce non lue n'a pas de
 * montant : elle affiche « — » et compte quand même dans le total des
 * documents, parce qu'elle a bien été déposée.
 */
function VosDocuments() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const [vue, setVue] = useState<"mois" | "annee">("mois");
  const [mois, setMois] = useState(moisEnArriere(0));
  const [type, setType] = useState<"tous" | "facture_achat" | "facture_vente">("tous");

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const toutes = useMemo(() => pieces.data ?? [], [pieces.data]);

  /** Le mois d'une pièce : celui du DOCUMENT s'il est lu, sinon celui du dépôt. */
  const moisDe = (p: PieceLue) => (p.dateDocument ?? p.createdAt).slice(0, 7);

  const derniersMois = useMemo(
    () => Array.from({ length: MOIS_VISIBLES }, (_, i) => moisEnArriere(i)),
    [],
  );

  const duMois = toutes.filter((p) => moisDe(p) === mois);

  // Les types présents, et eux seuls.
  const typesPresents = useMemo(() => {
    const vus = new Set(duMois.map((p) => p.kind).filter((k): k is NonNullable<typeof k> => !!k));
    return [...vus];
  }, [duMois]);

  const visibles = type === "tous" ? duMois : duMois.filter((p) => p.kind === type);

  // Groupées par type, chaque groupe avec son compte et son total.
  const groupes = useMemo(() => {
    const carte = new Map<string, PieceLue[]>();
    for (const p of visibles) {
      const cle = p.kind ?? "inconnu";
      carte.set(cle, [...(carte.get(cle) ?? []), p]);
    }
    return [...carte.entries()].map(([cle, liste]) => ({
      cle,
      liste,
      total: liste.reduce((n, p) => n + Number(p.total ?? 0), 0),
    }));
  }, [visibles]);

  const nomDuType = (k: string) =>
    k === "facture_achat"
      ? t("pme.doc.type.achats")
      : k === "facture_vente"
        ? t("pme.doc.type.ventes")
        : t("pme.doc.type.autre");

  const nomDuMois = (p: string, court = false) =>
    new Intl.DateTimeFormat(locale, {
      month: court ? "short" : "long",
      timeZone: "UTC",
    }).format(new Date(`${p}-01T00:00:00Z`));

  const jour = (p: PieceLue) => {
    const iso = p.dateDocument ?? p.createdAt;
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  };

  /** L'état d'une pièce, en une couleur. Le retour est le seul qui appelle. */
  const pastille = (p: PieceLue) =>
    p.status === "retournee"
      ? "bg-signal-stop"
      : p.status === "comptabilisee" || p.status === "supervisee"
        ? "bg-signal-ok"
        : "bg-line-strong";

  // ---------------------------------------------------------------- l'année
  const parMois = useMemo(() => {
    const carte = new Map<string, PieceLue[]>();
    for (const p of toutes) {
      const cle = moisDe(p);
      carte.set(cle, [...(carte.get(cle) ?? []), p]);
    }
    return [...carte.entries()]
      .map(([cle, liste]) => ({
        mois: cle,
        n: liste.length,
        // Une somme de montants se fait en décimal exact, jamais en flottant.
        total: sommeDecimale(liste.map((p) => String(p.total ?? "0"))),
      }))
      .sort((a, b) => b.mois.localeCompare(a.mois));
  }, [toutes]);

  // Les barres ne montrent qu'une proportion : le flottant y suffit.
  const plusHaut = Math.max(...parMois.map((m) => Number(m.total)), 0);
  const totalAnnuel = sommeDecimale(toutes.map((p) => String(p.total ?? "0")));
  const parType = useMemo(() => {
    const carte = new Map<string, number>();
    for (const p of toutes) {
      const cle = p.kind ?? "inconnu";
      carte.set(cle, (carte.get(cle) ?? 0) + 1);
    }
    return [...carte.entries()];
  }, [toutes]);

  const onglet = "flex-1 border-0 px-3 py-[7px] text-[11px] font-semibold";

  return (
    <div className="rg-rise -mx-4 flex min-h-0 flex-1 flex-col sm:-mx-6">
      <div className="px-[22px]">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {t("pme.doc.titre")}
          </p>
          <span className="inline-flex border border-line-strong">
            <button
              type="button"
              onClick={() => setVue("mois")}
              className={cn(
                onglet,
                vue === "mois" ? "bg-foreground text-background" : "bg-transparent",
              )}
            >
              {t("pme.vue.mois")}
            </button>
            <button
              type="button"
              onClick={() => setVue("annee")}
              className={cn(
                onglet,
                vue === "annee" ? "bg-foreground text-background" : "bg-transparent",
              )}
            >
              {t("pme.vue.annee")}
            </button>
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.5] text-text-2">
          {vue === "mois"
            ? t("pme.doc.lead.mois", { count: duMois.length, mois: nomDuMois(mois) })
            : t("pme.doc.lead.annee", { count: toutes.length })}
        </p>
      </div>

      {vue === "mois" ? (
        <>
          <div className="flex gap-1.5 px-[22px] pt-3.5">
            {derniersMois.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMois(m)}
                aria-pressed={m === mois}
                className={cn(
                  "flex-1 border border-line-strong py-[7px] font-mono text-[11px] font-semibold tracking-[0.04em]",
                  m === mois ? "bg-foreground text-background" : "bg-transparent",
                )}
              >
                {nomDuMois(m, true)}
              </button>
            ))}
          </div>

          {/* Les types réellement présents ce mois-ci, et « tous » devant. */}
          {typesPresents.length > 1 ? (
            <div className="flex gap-1.5 overflow-hidden px-[22px] pt-2">
              {(["tous", ...typesPresents] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setType(c as typeof type)}
                  aria-pressed={c === type}
                  className={cn(
                    "flex-none border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
                    c === type
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-transparent text-text-2",
                  )}
                >
                  {c === "tous" ? t("pme.doc.type.tous") : nomDuType(c)}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex-1 px-[22px] pt-2.5">
            {pieces.isPending ? (
              <p className="pt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : visibles.length === 0 ? (
              <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
                {t("pme.doc.vide", { mois: nomDuMois(mois) })}
              </p>
            ) : (
              <>
                {groupes.map((g) => (
                  <div key={g.cle}>
                    <div className="mt-1.5 flex items-baseline justify-between gap-2.5 border-t border-foreground pb-[5px] pt-2.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                        {nomDuType(g.cle)}
                      </span>
                      <span className="flex items-baseline gap-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("pme.doc.compte", { count: g.liste.length })}
                        </span>
                        <span className="num text-[12px] font-medium">
                          {montant(g.total.toFixed(3), locale)}
                        </span>
                      </span>
                    </div>
                    {g.liste.map((p) => (
                      <Link
                        key={p.id}
                        to="/pme/piece/$pieceId"
                        params={{ pieceId: p.id }}
                        className="grid grid-cols-[auto_38px_1fr_auto] items-center gap-2.5 border-t border-border py-2.5"
                      >
                        <span aria-hidden className={cn("h-[6px] w-[6px]", pastille(p))} />
                        <span className="num text-[11px] text-muted-foreground">{jour(p)}</span>
                        <span className="min-w-0">
                          {/*
                           * ================================ LE TITRE NE MENT PLUS
                           *
                           * Il valait `p.emetteur ?? "Pas encore lue"` : dès que
                           * l'émetteur manquait, la ligne annonçait une pièce non
                           * lue — y compris quand le statut juste en dessous
                           * affichait « Lue ». Deux phrases contradictoires sur
                           * la même ligne, et c'est celle du haut qu'on croit.
                           *
                           * Une pièce lue dont l'émetteur reste introuvable
                           * existe : un ticket effacé, une photo d'autre chose.
                           * Elle mérite sa propre phrase, qui dit quoi faire.
                           */}
                          <span className="block truncate text-[14px] font-medium">
                            {p.emetteur ??
                              (p.status === "capturee"
                                ? t("pme.list.nonLue")
                                : t("pme.list.sansEmetteur"))}
                          </span>
                          <span
                            className={cn(
                              "mt-px block text-[11px]",
                              p.status === "retournee"
                                ? "text-signal-stop"
                                : "text-muted-foreground",
                            )}
                          >
                            {t(`pme.status.${p.status}` as never)}
                          </span>
                        </span>
                        <span className="num text-[13px] font-medium">
                          {p.total === null ? "—" : montant(p.total, locale)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))}

                <div className="mt-3 flex gap-2.5 border-t border-border pt-3">
                  <RegalicaAvatar size={30} alt="Regalica" rond />
                  <p className="text-[13px] leading-[1.45] text-text-2">{t("pme.doc.note")}</p>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <section className="rg-regle relative mt-4 overflow-hidden border-t-[3px] border-marigold-on-ink bg-foreground px-[22px] py-5 text-background">
            <p className="relative font-mono text-[10px] font-medium uppercase tracking-[0.2em] opacity-65">
              {t("pme.doc.depuis")}
            </p>
            <p className="relative mt-2 flex items-baseline gap-2">
              <span className="num text-[clamp(2rem,11vw,46px)] font-medium leading-[0.92] tracking-[-0.045em]">
                {toutes.length === 0 ? "—" : montant(totalAnnuel, locale)}
              </span>
              <span className="num text-[14px] font-medium opacity-60">{pme.currency}</span>
            </p>
            <p className="relative mt-2.5 text-[12.5px] opacity-[0.72]">
              {t("pme.doc.bilan", { count: toutes.length })}
            </p>
          </section>

          <div className="px-[22px] pt-4">
            {parMois.map((m) => (
              <button
                key={m.mois}
                type="button"
                onClick={() => {
                  setMois(m.mois);
                  setVue("mois");
                }}
                className="grid w-full grid-cols-[44px_1fr_34px_auto] items-center gap-2.5 border-t border-border py-2.5 text-start"
              >
                <span className="num text-[12px] font-medium">{nomDuMois(m.mois, true)}</span>
                <span className="relative h-[6px] bg-line-strong">
                  <i
                    className="absolute inset-y-0 start-0 bg-foreground"
                    style={{
                      width: `${plusHaut > 0 ? Math.round((Number(m.total) / plusHaut) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="num text-end text-[11px] text-muted-foreground">{m.n}</span>
                <span className="num text-[13px] font-medium">{montant(m.total, locale)}</span>
              </button>
            ))}

            <p className="mb-1.5 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("pme.doc.classes")}
            </p>
            {parType.map(([cle, n]) => (
              <div
                key={cle}
                className="flex items-center justify-between gap-3 border-t border-border py-2.5"
              >
                <span className="text-[13.5px]">{nomDuType(cle)}</span>
                <span className="num text-[13px] font-medium">{n}</span>
              </div>
            ))}

            <p className="mt-3 border-t border-foreground pt-3 text-[11.5px] leading-[1.5] text-muted-foreground">
              {t("pme.doc.source")}
            </p>
          </div>
        </>
      )}

      <div className="pb-6" />
    </div>
  );
}
