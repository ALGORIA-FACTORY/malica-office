/**
 * Le pied de facture de « Ce que j'ai lu, ligne par ligne ».
 *
 * ================================================================= POURQUOI
 *
 * 10 novembre 2026, facture manuscrite scannée sur le staging : la TVA et le
 * total sortaient « — », et l'écran disait « Les montants lus ne vérifient pas
 * ce total » — d'un total qu'il n'avait pas lu. La source de la TVA existait
 * pourtant : le lecteur avait trouvé le jeton, sans pouvoir le lire comme un
 * montant.
 *
 * Deux choses distinctes se disent donc à part :
 *   - un montant NON LU : on le nomme, et s'il a une source on y mène ;
 *   - un total LU que la somme des montants lus ne donne pas : le message
 *     d'avant, inchangé.
 *
 * Rien n'est calculé ici (R2, R3) : un montant non lu reste non lu.
 */
import { Fragment, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * D'où vient un montant du pied — trois états distincts, visibles par champ :
 * lu sur la photo, prouvé par le calcul, saisi par une personne. Une saisie
 * n'est jamais présentée comme une lecture.
 */
export type EtatDuMontant =
  | { genre: "lu" }
  | { genre: "prouve" }
  | { genre: "saisi"; par: string | null; lue: string | null };

export interface MontantDuPied {
  /** Le chemin du champ dans la lecture (« totals.vat ») : celui de sa source. */
  champ: string;
  libelle: string;
  /** Le montant déjà lisible, ou `null` s'il n'a pas été lu. */
  valeur: string | null;
  /** Le lecteur a-t-il situé ce montant sur la pièce ? */
  aUneSource: boolean;
  /** Lu, prouvé par le calcul, ou saisi — avec l'auteur et ce qui avait été lu. */
  etat?: EtatDuMontant;
}

/** Un droit du pied : son chemin de citation, pour que le crayon le désigne. */
export interface DroitDuPied {
  cle: string;
  champ: string;
  libelle: string;
  valeur: string | null;
  etat?: EtatDuMontant;
}

/** Le crayon d'un champ : 44 px, nommé par le champ qu'il corrige. */
function Crayon({ libelle, onClick }: { libelle: string; onClick: () => void }) {
  const { t } = useI18n();
  const nom = t("pme.crayon.modifier", { champ: libelle });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={nom}
      title={nom}
      className="-my-2 -me-2.5 inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-text-2 hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" aria-hidden>
        <path d="M4 20h4L19 9l-4-4L4 16z" />
      </svg>
    </button>
  );
}

/** L'état d'un montant, en mots — jamais par la seule couleur. */
function EtatDuChamp({ etat, devise }: { etat: EtatDuMontant; devise: string }) {
  const { t } = useI18n();
  if (etat.genre === "lu")
    return <span className="text-[11.5px] text-text-2">· {t("pme.crayon.etat.lu")}</span>;
  if (etat.genre === "prouve")
    return (
      <span className="text-[11.5px] font-semibold text-foreground">
        <span aria-hidden className="text-signal-ok">
          ✓
        </span>{" "}
        {t("pme.crayon.etat.prouve")}
      </span>
    );
  return (
    <span className="grid">
      <span className="text-[11.5px] font-semibold text-foreground">
        <span aria-hidden className="text-signal-info">
          ✎
        </span>{" "}
        {etat.par ? t("pme.crayon.etat.saisi", { nom: etat.par }) : t("pme.crayon.etat.saisiSans")}
      </span>
      {etat.lue !== null ? (
        <span className="num text-[11.5px] text-text-2">
          {t("pme.crayon.etat.valeurLue", { valeur: `${etat.lue} ${devise}`.trim() })}
        </span>
      ) : null}
    </span>
  );
}

export function PiedDeLecture({
  base,
  tva,
  droits,
  total,
  devise,
  parLeCabinet,
  totalNeFermePas,
  onVoirLaSource,
  onCorriger,
}: {
  base: MontantDuPied;
  tva: MontantDuPied;
  droits: ReadonlyArray<DroitDuPied>;
  total: MontantDuPied;
  devise: string;
  /** Les montants viennent de l'écriture du cabinet : ils n'ont pas à être « lus ». */
  parLeCabinet: boolean;
  /** Le jugement dit que les montants lus ne ferment pas le total. */
  totalNeFermePas: boolean;
  onVoirLaSource: (champ: string) => void;
  /**
   * Le crayon : corriger ce champ. Absent quand la pièce n'est plus à la
   * personne (engagée : la correction passe par le cabinet).
   */
  onCorriger?: ((champ: string, libelle: string) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const nonLus = parLeCabinet ? [] : [base, tva, total].filter((m) => m.valeur === null);
  const valeur = (m: MontantDuPied, suffixe = "") =>
    m.valeur !== null ? (
      `${m.valeur}${suffixe}`
    ) : parLeCabinet ? (
      "—"
    ) : m.aUneSource ? (
      <button
        type="button"
        onClick={() => onVoirLaSource(m.champ)}
        className="min-h-[44px] text-signal-warn underline underline-offset-2"
      >
        {t("pme.detail.nonLuVoir")}
      </button>
    ) : (
      <span className="text-signal-warn">{t("pme.detail.nonLu")}</span>
    );

  /** Une ligne du pied : le libellé et son état, la valeur et son crayon. */
  const ligne = (
    champ: string,
    libelle: string,
    contenu: ReactNode,
    etat: EtatDuMontant | undefined,
    classes: { ligne: string; libelle: string; valeur: string },
  ) => (
    <div className={cn("flex items-baseline justify-between gap-3", classes.ligne)}>
      <span className="grid">
        <span className={classes.libelle}>{libelle}</span>
        {!parLeCabinet && etat ? <EtatDuChamp etat={etat} devise={devise} /> : null}
      </span>
      <span className="flex items-baseline gap-1">
        <span className={cn("num", classes.valeur)}>{contenu}</span>
        {!parLeCabinet && onCorriger ? (
          <Crayon libelle={libelle} onClick={() => onCorriger(champ, libelle)} />
        ) : null}
      </span>
    </div>
  );

  return (
    <>
      {ligne(base.champ, base.libelle, valeur(base), base.etat, {
        ligne: "border-t border-foreground pt-3",
        libelle: "text-[13.5px] font-semibold",
        valeur: "text-[13.5px] font-semibold",
      })}
      {ligne(tva.champ, tva.libelle, valeur(tva), tva.etat, {
        ligne: "pt-1.5",
        libelle: "text-[13.5px]",
        valeur: "text-[13.5px]",
      })}
      {droits.map((d) => (
        <Fragment key={d.cle}>
          {ligne(d.champ, d.libelle, d.valeur ?? "—", d.etat, {
            ligne: "pt-1.5",
            libelle: "text-[13.5px]",
            valeur: "text-[13.5px]",
          })}
        </Fragment>
      ))}
      {ligne(
        total.champ,
        total.libelle,
        <span
          className={cn(
            "text-[15px] font-semibold",
            totalNeFermePas && total.valeur !== null && "text-[color:var(--ve)]",
          )}
        >
          {valeur(total, ` ${devise}`)}
        </span>,
        total.etat,
        {
          ligne: "mt-2 border-t border-foreground pt-3",
          libelle: "text-[14px] font-semibold",
          valeur: "",
        },
      )}
      {nonLus.length > 0 ? (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.45] text-signal-warn">
          {t("pme.detail.montantsNonLus", {
            champs: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
              nonLus.map((m) => m.libelle),
            ),
          })}
        </p>
      ) : totalNeFermePas ? (
        /*
         * Un total que la somme des montants lus ne donne pas (2 novembre
         * 2026 : « 510,000 » relevé « 810,000 ») : le jugement le refuse, et
         * l'écran ne l'affiche plus comme s'il était juste.
         */
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.45] text-[color:var(--ve)]">
          {t("pme.detail.totalNeFermePas")}
        </p>
      ) : null}
    </>
  );
}
