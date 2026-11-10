/**
 * Les blocs d'une réponse de Malica : ce que la bulle sait dessiner au-delà du
 * texte — un chiffre clé avec son détail, un tableau qui se trie et s'ouvre sur
 * ses pièces, des barres par période.
 *
 * ============================================================ CE QU'ILS NE FONT PAS
 *
 * Ils ne calculent rien et ne formatent rien : chaque valeur arrive du serveur
 * déjà écrite (séparateurs, décimales de la devise) et déjà traduite, composée
 * à partir d'un moteur ou de la base (R3). L'écran dessine.
 *
 * ================================================== UN SEUL COMPOSANT, DEUX ESPACES
 *
 * La bulle de la PME et le fil de la comptabilité montrent les mêmes blocs. Ils
 * ne portent donc que les jetons communs du thème (`background`, `muted`,
 * `border`, `signal-*`), que chaque surface règle à sa main, en clair comme en
 * sombre.
 *
 * ================================================================ TOUTES LES LARGEURS
 *
 * De 320 px au grand écran : le chiffre clé se cale sur la largeur (`clamp`),
 * le détail passe de une à plusieurs colonnes selon la place (`auto-fit`), et
 * un tableau plus large que la bulle défile DANS son cadre — jamais la page.
 * Les alignements sont logiques (`start`/`end`) : l'arabe se lit de droite à
 * gauche sans feuille à part.
 */
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import type { BlocDeReponse, ChiffreDeBloc } from "@malica/socle/ports/assistant";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Où s'ouvre une pièce : l'espace de la PME ou celui de la comptabilité. */
type Espace = "pme" | "cabinet";

const TON: Record<ChiffreDeBloc["ton"], string> = {
  positif: "text-signal-ok",
  negatif: "text-signal-stop",
  neutre: "text-foreground",
};

/** Un montant et son unité : les chiffres gardent leur sens de lecture, même en arabe. */
function Valeur({ chiffre, grande }: { chiffre: ChiffreDeBloc; grande?: boolean }) {
  return (
    <span
      className={cn(
        "flex flex-wrap items-baseline gap-x-1.5 font-mono font-semibold tabular-nums tracking-tight",
        grande ? "text-[clamp(1.5rem,7vw,2rem)] leading-tight" : "text-[1.0625rem]",
        TON[chiffre.ton],
      )}
    >
      <bdi>{chiffre.valeur}</bdi>
      {chiffre.unite ? (
        <span
          className={cn(
            "font-medium text-muted-foreground",
            grande ? "text-[0.9375rem]" : "text-[0.6875rem]",
          )}
        >
          {chiffre.unite}
        </span>
      ) : null}
    </span>
  );
}

function ReponseCle({ bloc }: { bloc: Extract<BlocDeReponse, { type: "reponse_cle" }> }) {
  return (
    <>
      <div className="grid gap-0.5">
        <span className="text-[0.8125rem] text-muted-foreground">{bloc.cle.libelle}</span>
        <Valeur chiffre={bloc.cle} grande />
      </div>
      {bloc.details.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
          {bloc.details.map((d) => (
            <div
              key={d.libelle}
              className="min-w-0 rounded-[var(--bloc-r2,0px)] bg-muted px-3 py-2.5"
            >
              <dt className="text-[0.6875rem] text-muted-foreground">{d.libelle}</dt>
              <dd className="mt-0.5">
                <Valeur chiffre={d} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

type BlocTableau = Extract<BlocDeReponse, { type: "tableau" }>;

function Tableau({ bloc, espace }: { bloc: BlocTableau; espace: Espace }) {
  const { t } = useI18n();
  // Le tri : la colonne et le sens. L'ordre vient du serveur (`ordres`) — l'écran
  // ne compare aucune valeur, il réordonne.
  const [tri, setTri] = useState<{ colonne: string; croissant: boolean } | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const ordre = tri ? bloc.ordres?.[tri.colonne] : undefined;
  const indices = ordre
    ? tri!.croissant
      ? ordre
      : [...ordre].reverse()
    : bloc.lignes.map((_, i) => i);
  const cellule = (numerique: boolean) =>
    cn("px-2.5 py-2 text-start", numerique && "text-end font-mono tabular-nums");
  const trier = (colonne: string) =>
    setTri((avant) =>
      avant?.colonne === colonne
        ? { colonne, croissant: !avant.croissant }
        : // Un montant se lit d'abord du plus grand au plus petit ; un nom, de A à Z.
          { colonne, croissant: !bloc.colonnes.find((c) => c.id === colonne)?.numerique },
    );
  const premiere = bloc.colonnes[0]?.id;

  return (
    // Le tableau défile dans son cadre, dans les deux sens : la bulle ne s'élargit pas.
    <div
      className="max-h-[19rem] overflow-auto rounded-[var(--bloc-r2,0px)] border border-border"
      tabIndex={0}
    >
      <table className="w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr>
            {bloc.colonnes.map((c) => {
              const triable = Boolean(bloc.ordres?.[c.id]);
              const actif = tri?.colonne === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={actif ? (tri!.croissant ? "ascending" : "descending") : undefined}
                  className={cn(
                    cellule(c.numerique),
                    "sticky top-0 z-[1] whitespace-nowrap bg-muted text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground",
                  )}
                >
                  {triable ? (
                    <button
                      type="button"
                      className="inline-flex min-h-6 items-center gap-1 font-[inherit] uppercase tracking-[inherit] text-inherit"
                      aria-label={t("pme.bloc.trier", { colonne: c.libelle })}
                      onClick={() => trier(c.id)}
                    >
                      {c.libelle}
                      <span aria-hidden className={cn("text-signal-ok", !actif && "opacity-0")}>
                        {actif && tri!.croissant ? "↑" : "↓"}
                      </span>
                    </button>
                  ) : (
                    c.libelle
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {indices.map((i) => {
            const l = bloc.lignes[i]!;
            const pieces = bloc.pieces?.[i] ?? null;
            const estOuverte = ouverte === i;
            return (
              <Fragment key={i}>
                <tr className="border-t border-border">
                  {bloc.colonnes.map((c) => (
                    <td
                      key={c.id}
                      className={cn(cellule(c.numerique), c.numerique && "whitespace-nowrap")}
                    >
                      {c.id === premiere && pieces ? (
                        // Toucher la ligne ouvre les pièces qui composent son chiffre.
                        <button
                          type="button"
                          className="inline-flex min-h-6 items-center gap-1.5 text-start font-[inherit] text-inherit underline decoration-dotted underline-offset-4"
                          aria-expanded={estOuverte}
                          aria-label={t("pme.bloc.pieces.voir", { ligne: l[c.id] ?? "" })}
                          onClick={() => setOuverte(estOuverte ? null : i)}
                        >
                          {l[c.id] ?? ""}
                        </button>
                      ) : c.numerique ? (
                        <bdi>{l[c.id] ?? ""}</bdi>
                      ) : (
                        (l[c.id] ?? "")
                      )}
                    </td>
                  ))}
                </tr>
                {estOuverte && pieces ? (
                  <tr className="bg-muted/50">
                    <td colSpan={bloc.colonnes.length} className="px-2.5 pb-2.5 pt-1">
                      <ul className="grid gap-1">
                        {pieces.map((p) => (
                          <li key={p.id}>
                            <Link
                              to={
                                espace === "pme" ? "/pme/piece/$pieceId" : "/cabinet/piece/$pieceId"
                              }
                              params={{ pieceId: p.id }}
                              className="inline-flex min-h-7 items-center gap-1.5 font-mono text-[0.75rem] tabular-nums text-foreground underline-offset-4 hover:underline"
                            >
                              <bdi>{p.titre}</bdi>
                            </Link>
                          </li>
                        ))}
                        {Number(l["pieces"]) > pieces.length ? (
                          <li className="text-[0.6875rem] text-muted-foreground">
                            {t("pme.bloc.pieces.plus", { n: Number(l["pieces"]) - pieces.length })}
                          </li>
                        ) : null}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        {bloc.total ? (
          <tfoot>
            <tr>
              {bloc.colonnes.map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    cellule(c.numerique),
                    "sticky bottom-0 border-t-2 border-border bg-muted font-semibold",
                  )}
                >
                  {/* Un nombre garde son sens de lecture en arabe : sans isolement, « 21 462,677 » s'y lit à l'envers. */}
                  {c.numerique ? <bdi>{bloc.total?.[c.id] ?? ""}</bdi> : (bloc.total?.[c.id] ?? "")}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

type BlocGraphique = Extract<BlocDeReponse, { type: "graphique" }>;

const BARRE: Record<ChiffreDeBloc["ton"], string> = {
  positif: "bg-signal-ok",
  negatif: "bg-signal-stop",
  neutre: "bg-muted-foreground/55",
};

/**
 * Des barres groupées par période. La hauteur de chaque barre est la `part`
 * que le serveur a calculée : rien n'est relu ni mis à l'échelle ici. Toucher
 * une période écrit ses valeurs sous le graphique — au doigt, il n'y a pas de
 * survol. Au-delà de la largeur, les périodes défilent dans le cadre.
 */
function Graphique({ bloc }: { bloc: BlocGraphique }) {
  const periodes = bloc.series[0]?.points.map((p) => p.etiquette) ?? [];
  // La dernière période qui porte une valeur : c'est elle qu'on lit d'abord.
  const derniere = periodes.reduce(
    (retenue, _, i) => (bloc.series.some((s) => s.points[i]?.valeur != null) ? i : retenue),
    periodes.length - 1,
  );
  const [choisie, setChoisie] = useState(derniere);
  return (
    <>
      <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
        {bloc.series.map((s) => (
          <li key={s.nom} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", BARRE[s.ton])} />
            {s.nom}
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto" tabIndex={0}>
        <div className="flex min-w-full items-end gap-1">
          {periodes.map((etiquette, i) => (
            <button
              key={etiquette}
              type="button"
              aria-pressed={choisie === i}
              aria-label={[
                etiquette,
                ...bloc.series.map((s) => `${s.nom} ${s.points[i]?.valeur ?? "—"}`),
              ].join(", ")}
              onClick={() => setChoisie(i)}
              className={cn(
                "grid min-w-7 flex-1 gap-1 rounded-[var(--bloc-r2,0px)] px-0.5 pb-1 pt-1.5",
                choisie === i && "bg-muted",
              )}
            >
              <span className="flex h-28 items-end justify-center gap-0.5">
                {bloc.series.map((s) => {
                  const p = s.points[i];
                  return (
                    <span
                      key={s.nom}
                      className={cn(
                        "w-full max-w-3.5 rounded-t-[3px] motion-safe:transition-[height] motion-safe:duration-500",
                        BARRE[s.ton],
                      )}
                      style={{
                        // Une valeur présente se voit toujours, même infime ; une absence ne dessine rien.
                        height: p?.valeur == null ? 0 : `max(2px, ${p.part * 100}%)`,
                      }}
                    />
                  );
                })}
              </span>
              <span className="truncate text-center text-[0.625rem] text-muted-foreground">
                {etiquette}
              </span>
            </button>
          ))}
        </div>
      </div>
      <dl
        className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2"
        aria-live="polite"
      >
        {bloc.series.map((s) => (
          <div key={s.nom} className="min-w-0 rounded-[var(--bloc-r2,0px)] bg-muted px-3 py-2">
            <dt className="text-[0.6875rem] text-muted-foreground">
              {s.nom} · {periodes[choisie]}
            </dt>
            <dd className="mt-0.5">
              <Valeur
                chiffre={{
                  libelle: s.nom,
                  valeur: s.points[choisie]?.valeur ?? "—",
                  unite: s.points[choisie]?.valeur == null ? null : bloc.unite,
                  ton: "neutre",
                }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Les blocs d'une réponse, dans l'ordre où Malica les a montrés. */
export function BlocsDeReponse({
  blocs,
  espace,
}: {
  blocs: readonly BlocDeReponse[];
  espace: Espace;
}) {
  return (
    <>
      {blocs.map((bloc, i) => (
        <figure
          key={i}
          data-bloc={bloc.type}
          className="mx-0 mt-3.5 min-w-0 max-w-[40rem] rounded-[var(--bloc-r,0px)] border border-border bg-background p-3.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
        >
          <figcaption className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <b className="text-[0.8125rem] font-semibold tracking-tight">{bloc.titre}</b>
            {bloc.periode ? (
              <span className="text-[0.6875rem] text-muted-foreground">{bloc.periode}</span>
            ) : null}
          </figcaption>
          {bloc.type === "reponse_cle" ? (
            <ReponseCle bloc={bloc} />
          ) : bloc.type === "tableau" ? (
            <Tableau bloc={bloc} espace={espace} />
          ) : (
            <Graphique bloc={bloc} />
          )}
          <p className="mt-3 border-t border-border pt-2.5 text-[0.6875rem] text-muted-foreground">
            {[bloc.source, bloc.perimetre].filter(Boolean).join(" · ")}
          </p>
        </figure>
      ))}
    </>
  );
}
