/**
 * Les blocs d'une réponse de Malica : ce que la bulle sait dessiner au-delà du
 * texte — un chiffre clé avec son détail, un tableau qui se trie et s'ouvre sur
 * ses pièces, des barres ou des courbes par période, une cascade — et de quoi
 * sortir chacun de l'écran, en classeur ou en PDF.
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
import { blocImprimable } from "@/lib/bloc-imprimable";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

/** Où s'ouvre une pièce : l'espace de la PME ou celui de la comptabilité. */
type Espace = "pme" | "cabinet";

const TON: Record<ChiffreDeBloc["ton"], string> = {
  positif: "text-signal-ok",
  negatif: "text-signal-stop",
  neutre: "text-foreground",
};

/** Un montant et son unité : les chiffres gardent leur sens de lecture, même en arabe. */
function Valeur({
  chiffre,
  taille = "courante",
}: {
  chiffre: ChiffreDeBloc;
  /** « grande » pour le chiffre qui répond ; « serree » là où trois valeurs tiennent côte à côte. */
  taille?: "grande" | "courante" | "serree";
}) {
  const grande = taille === "grande";
  return (
    <span
      className={cn(
        "flex flex-wrap items-baseline gap-x-1.5 font-mono font-semibold tabular-nums tracking-tight",
        grande
          ? "text-[clamp(1.5rem,7vw,2rem)] leading-tight"
          : taille === "serree"
            ? "text-[0.8125rem]"
            : "text-[1.0625rem]",
        TON[chiffre.ton],
      )}
    >
      {/* Un montant ne se coupe jamais entre ses milliers. */}
      <bdi className="whitespace-nowrap">{chiffre.valeur}</bdi>
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
        <Valeur chiffre={bloc.cle} taille="grande" />
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

const TRAIT: Record<ChiffreDeBloc["ton"], string> = {
  positif: "stroke-signal-ok",
  negatif: "stroke-signal-stop",
  neutre: "stroke-muted-foreground/70",
};

/**
 * Une courbe par série. Les points sont posés à la `part` que le serveur a
 * calculée ; une période sans valeur COUPE le trait — relier deux mois par-dessus
 * un mois vide dirait une tendance que personne n'a mesurée.
 */
function Courbes({ bloc }: { bloc: BlocGraphique }) {
  const n = bloc.series[0]?.points.length ?? 0;
  const x = (i: number) => (n <= 1 ? 50 : ((i + 0.5) / n) * 100);
  const y = (part: number) => 96 - part * 92;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-1.5 h-28 w-full overflow-visible"
    >
      {bloc.series.map((s) => {
        const troncons: string[] = [];
        let courant = "";
        s.points.forEach((p, i) => {
          if (p.valeur == null) {
            // Un point seul n'a pas de trait : il est marqué plus bas.
            if (courant.includes("L")) troncons.push(courant);
            courant = "";
            return;
          }
          courant += `${courant ? "L" : "M"}${x(i).toFixed(2)} ${y(p.part).toFixed(2)} `;
        });
        if (courant.includes("L")) troncons.push(courant);
        return (
          <g key={s.nom} className={TRAIT[s.ton]} fill="none">
            {troncons.map((d) => (
              <path
                key={d}
                d={d}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Un point isolé entre deux périodes vides n'a pas de trait : on le marque. */}
            {s.points.map((p, i) =>
              p.valeur != null &&
              s.points[i - 1]?.valeur == null &&
              s.points[i + 1]?.valeur == null ? (
                <path
                  key={i}
                  d={`M${x(i).toFixed(2)} ${y(p.part).toFixed(2)} l0.01 0`}
                  strokeWidth="6"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Des barres groupées par période, ou des courbes quand les périodes sont
 * nombreuses. La hauteur de chaque point est la `part` que le serveur a
 * calculée : rien n'est relu ni mis à l'échelle ici. Toucher une période écrit
 * ses valeurs sous le graphique — au doigt, il n'y a pas de survol. Au-delà de
 * la largeur, les périodes défilent dans le cadre.
 */
function Graphique({ bloc }: { bloc: BlocGraphique }) {
  const periodes = bloc.series[0]?.points.map((p) => p.etiquette) ?? [];
  const courbe = bloc.forme === "courbe";
  // La dernière période qui porte une valeur : c'est elle qu'on lit d'abord.
  const derniere = periodes.reduce(
    (retenue, _, i) => (bloc.series.some((s) => s.points[i]?.valeur != null) ? i : retenue),
    periodes.length - 1,
  );
  const [choisie, setChoisie] = useState(derniere);
  // Sur une courbe longue, une étiquette sur trois suffit à situer : les autres se lisent au toucher.
  const pas = periodes.length > 12 ? 3 : 1;
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
        <div className={cn("relative flex min-w-full items-end", courbe ? "gap-0" : "gap-1")}>
          {courbe ? <Courbes bloc={bloc} /> : null}
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
                "grid flex-1 gap-1 rounded-[var(--bloc-r2,0px)] px-0.5 pb-1 pt-1.5",
                courbe ? "min-w-3.5" : "min-w-7",
                choisie === i && "bg-muted",
              )}
            >
              <span className="flex h-28 items-end justify-center gap-0.5">
                {courbe
                  ? null
                  : bloc.series.map((s) => {
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
                {i % pas === 0 || i === choisie ? etiquette : "\u00a0"}
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

type BlocCascade = Extract<BlocDeReponse, { type: "cascade" }>;

/**
 * De ce qui entre à ce qui reste. Chaque barre va de `debut` à `fin`, que le
 * serveur a calculés : les charges pendent du sommet des produits, le résultat
 * repart du sol. La valeur de chaque étape est écrite dessous, toujours — une
 * cascade se lit sans avoir à toucher.
 */
function Cascade({ bloc }: { bloc: BlocCascade }) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-2">
      {bloc.etapes.map((e) => (
        <li key={e.libelle} className="grid min-w-0 gap-1.5">
          <span className="relative block h-28 border-b border-border">
            <span
              className={cn(
                "absolute inset-x-[18%] rounded-[3px] motion-safe:transition-[top,bottom] motion-safe:duration-500",
                BARRE[e.ton],
              )}
              style={{
                bottom: `${e.debut * 100}%`,
                // Une étape présente se voit toujours, même infime.
                height: `max(2px, ${Math.round((e.fin - e.debut) * 1000) / 10}%)`,
              }}
            />
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">{e.libelle}</span>
          <Valeur
            taille="serree"
            chiffre={{ libelle: e.libelle, valeur: e.valeur, unite: bloc.unite, ton: e.ton }}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * Sortir un bloc de l'écran : en classeur (les montants y sont des nombres, le
 * serveur l'écrit) ou en PDF (ce que l'écran montre, dessiné ici). Le fichier
 * est remis par le seul geste qui sait le faire dans les deux coques.
 */
function Exporter({ bloc }: { bloc: BlocDeReponse }) {
  const { t, locale } = useI18n();
  const [etat, setEtat] = useState<"repos" | "enCours" | "fait" | "echec">("repos");
  const rtl = locale === "ar";
  const sortir = async (fabriquer: () => Promise<Blob>, extension: string) => {
    setEtat("enCours");
    try {
      const { enregistrerUnFichier } = await import("@/capabilities/enregistrer-un-fichier");
      await enregistrerUnFichier(await fabriquer(), `${bloc.titre}.${extension}`);
      setEtat("fait");
    } catch {
      setEtat("echec");
    }
  };
  const bouton =
    "inline-flex min-h-7 items-center rounded-full border border-border bg-muted px-2.5 text-[0.6875rem] font-semibold text-foreground disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {etat === "fait" || etat === "echec" ? (
        <span role="status" className={etat === "echec" ? "text-signal-stop" : undefined}>
          {t(etat === "fait" ? "pme.bloc.exporter.fait" : "pme.bloc.exporter.echec")}
        </span>
      ) : null}
      {bloc.feuille ? (
        <button
          type="button"
          className={bouton}
          disabled={etat === "enCours"}
          onClick={() =>
            void sortir(
              () =>
                office().malica.exporterUnBloc({
                  titre: bloc.titre,
                  droiteAGauche: rtl,
                  feuille: bloc.feuille!,
                }),
              "xlsx",
            )
          }
        >
          {t("pme.bloc.exporter.xlsx")}
        </button>
      ) : null}
      <button
        type="button"
        className={bouton}
        disabled={etat === "enCours"}
        onClick={() =>
          void sortir(async () => {
            const { rendreBlocEnPdf } = await import("@/capabilities/bloc-pdf");
            return rendreBlocEnPdf(blocImprimable(bloc), rtl ? "rtl" : "ltr");
          }, "pdf")
        }
      >
        {t("pme.bloc.exporter.pdf")}
      </button>
    </span>
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
          ) : bloc.type === "graphique" ? (
            <Graphique bloc={bloc} />
          ) : (
            <Cascade bloc={bloc} />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-2.5 text-[0.6875rem] text-muted-foreground">
            <p className="m-0 min-w-0">
              {[bloc.source, bloc.perimetre].filter(Boolean).join(" · ")}
            </p>
            <Exporter bloc={bloc} />
          </div>
        </figure>
      ))}
    </>
  );
}
