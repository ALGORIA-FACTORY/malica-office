/**
 * Les blocs d'une réponse de Malica : ce que la bulle sait dessiner au-delà du
 * texte — un chiffre clé avec son détail, un tableau.
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
import type { BlocDeReponse, ChiffreDeBloc } from "@malica/socle/ports/assistant";

import { cn } from "@/lib/utils";

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

function Tableau({ bloc }: { bloc: Extract<BlocDeReponse, { type: "tableau" }> }) {
  const cellule = (numerique: boolean) =>
    cn("px-2.5 py-2 text-start", numerique && "text-end font-mono tabular-nums");
  return (
    // Le tableau défile dans son cadre, dans les deux sens : la bulle ne s'élargit pas.
    <div
      className="max-h-[17rem] overflow-auto rounded-[var(--bloc-r2,0px)] border border-border"
      tabIndex={0}
    >
      <table className="w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr>
            {bloc.colonnes.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn(
                  cellule(c.numerique),
                  "sticky top-0 whitespace-nowrap bg-muted text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground",
                )}
              >
                {c.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloc.lignes.map((l, i) => (
            <tr key={i} className="border-t border-border">
              {bloc.colonnes.map((c) => (
                <td
                  key={c.id}
                  className={cn(cellule(c.numerique), c.numerique && "whitespace-nowrap")}
                >
                  {c.numerique ? <bdi>{l[c.id] ?? ""}</bdi> : (l[c.id] ?? "")}
                </td>
              ))}
            </tr>
          ))}
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
                  {bloc.total?.[c.id] ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Les blocs d'une réponse, dans l'ordre où Malica les a montrés. */
export function BlocsDeReponse({ blocs }: { blocs: readonly BlocDeReponse[] }) {
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
          {bloc.type === "reponse_cle" ? <ReponseCle bloc={bloc} /> : <Tableau bloc={bloc} />}
          <p className="mt-3 border-t border-border pt-2.5 text-[0.6875rem] text-muted-foreground">
            {[bloc.source, bloc.perimetre].filter(Boolean).join(" · ")}
          </p>
        </figure>
      ))}
    </>
  );
}
