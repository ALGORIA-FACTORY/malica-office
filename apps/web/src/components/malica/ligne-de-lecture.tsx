/**
 * Une ligne de « Ce que j'ai lu, ligne par ligne », avec son crayon sur chaque
 * composante : le libellé, la quantité, le prix unitaire HT, le montant HT, le
 * code TVA (10 novembre 2026).
 *
 * Chaque composante est une cible de 44 px nommée par ce qu'elle corrige. Ce que
 * la personne a saisi ne passe jamais pour une lecture : sous la ligne, chaque
 * composante corrigée dit « saisi par », et ce que la lecture avait lu.
 *
 * Rien n'est calculé ici : le montant d'une ligne est celui que la lecture ou la
 * personne a posé ; que la ligne tienne ou non est le jugement, au serveur.
 */
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import type { CorrectionDeLecture } from "@malica/socle/ports/repositories";

export interface ArticleDeLecture {
  designation: string;
  quantity: string | null;
  unit_price_ht: string | null;
  unit_price_ttc: string | null;
  total_ht: string | null;
  tax_code: string | null;
}

/** Le crayon d'une composante : 44 px, nommé par ce qu'il corrige. */
function Composante({
  nom,
  onCorriger,
  children,
  className = "",
}: {
  nom: string;
  onCorriger: (() => void) | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!onCorriger) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onCorriger}
      aria-label={nom}
      title={nom}
      className={`inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-start hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground ${className}`}
    >
      {children}
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 flex-none fill-none stroke-current stroke-2 text-text-2"
        aria-hidden
      >
        <path d="M4 20h4L19 9l-4-4L4 16z" />
      </svg>
    </button>
  );
}

export function LigneDeLecture({
  index,
  article: a,
  lisible,
  quantite,
  corrections,
  devise,
  onCorriger,
}: {
  index: number;
  article: ArticleDeLecture;
  /** Un montant, dans la langue du lecteur (`null` s'il n'y en a pas). */
  lisible: (valeur: string | null | undefined) => string | null;
  quantite: (valeur: string) => string;
  /** Les précisions de la pièce, par chemin de citation. */
  corrections: ReadonlyMap<string, CorrectionDeLecture>;
  devise: string;
  /** Le crayon : corriger ce champ de cette ligne. Absent quand la pièce n'est plus à la personne. */
  onCorriger?: ((champ: string, libelle: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const nomDe = (cle: "designation" | "quantity" | "unit_price_ht" | "total_ht" | "tax_code") =>
    t("pme.crayon.ligne.de", { champ: t(`pme.crayon.ligne.${cle}`), n: index + 1 });
  const crayon = (cle: Parameters<typeof nomDe>[0]) =>
    onCorriger ? () => onCorriger(`articles[${index}].${cle}`, nomDe(cle)) : undefined;
  const saisies = (
    ["designation", "quantity", "unit_price_ht", "total_ht", "tax_code"] as const
  ).flatMap((cle) => {
    const c = corrections.get(`articles[${index}].${cle}`);
    return c ? [{ cle, c }] : [];
  });
  const montantLu = (cle: "unit_price_ht" | "total_ht", v: string | null) =>
    v === null ? null : lisible(v);

  return (
    <div className="border-t border-border py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Composante
          nom={t("pme.crayon.modifier", { champ: nomDe("designation") })}
          onCorriger={crayon("designation")}
          className="text-[14px] font-medium"
        >
          {a.designation}
        </Composante>
        <Composante
          nom={t("pme.crayon.modifier", { champ: nomDe("total_ht") })}
          onCorriger={crayon("total_ht")}
          className="num flex-none text-[13.5px] font-medium"
        >
          {lisible(a.total_ht) ?? "—"}
        </Composante>
      </div>
      <p className="num mt-0.5 flex flex-wrap items-center gap-x-1 text-[11.5px] text-muted-foreground">
        <Composante
          nom={t("pme.crayon.modifier", { champ: nomDe("quantity") })}
          onCorriger={crayon("quantity")}
        >
          {a.quantity ? t("pme.detail.qte", { q: quantite(a.quantity) }) : t("pme.detail.sansQte")}
        </Composante>
        <Composante
          nom={t("pme.crayon.modifier", { champ: nomDe("unit_price_ht") })}
          onCorriger={crayon("unit_price_ht")}
        >
          {a.unit_price_ht
            ? t("pme.detail.pu", { pu: lisible(a.unit_price_ht) ?? "—" })
            : a.unit_price_ttc
              ? t("pme.detail.puTtc", { pu: lisible(a.unit_price_ttc) ?? "—" })
              : t("pme.crayon.ligne.unit_price_ht")}
        </Composante>
        <Composante
          nom={t("pme.crayon.modifier", { champ: nomDe("tax_code") })}
          onCorriger={crayon("tax_code")}
        >
          {a.tax_code ?? t("pme.crayon.ligne.tax_code")}
        </Composante>
      </p>
      {saisies.map(({ cle, c }) => (
        <p key={cle} className="mt-1 grid text-[11.5px]">
          <span className="font-semibold text-foreground">
            <span aria-hidden className="text-signal-info">
              ✎
            </span>{" "}
            {t(`pme.crayon.ligne.${cle}`)} ·{" "}
            {c.par ? t("pme.crayon.etat.saisi", { nom: c.par }) : t("pme.crayon.etat.saisiSans")}
          </span>
          {c.lue !== null ? (
            <span className="num text-text-2">
              {t("pme.crayon.etat.valeurLue", {
                valeur:
                  cle === "unit_price_ht" || cle === "total_ht"
                    ? `${montantLu(cle, c.lue) ?? c.lue} ${devise}`
                    : cle === "quantity"
                      ? quantite(c.lue)
                      : c.lue,
              })}
            </span>
          ) : null}
        </p>
      ))}
    </div>
  );
}
