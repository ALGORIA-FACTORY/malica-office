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
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface MontantDuPied {
  /** Le chemin du champ dans la lecture (« totals.vat ») : celui de sa source. */
  champ: string;
  libelle: string;
  /** Le montant déjà lisible, ou `null` s'il n'a pas été lu. */
  valeur: string | null;
  /** Le lecteur a-t-il situé ce montant sur la pièce ? */
  aUneSource: boolean;
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
}: {
  base: MontantDuPied;
  tva: MontantDuPied;
  droits: ReadonlyArray<{ cle: string; libelle: string; valeur: string | null }>;
  total: MontantDuPied;
  devise: string;
  /** Les montants viennent de l'écriture du cabinet : ils n'ont pas à être « lus ». */
  parLeCabinet: boolean;
  /** Le jugement dit que les montants lus ne ferment pas le total. */
  totalNeFermePas: boolean;
  onVoirLaSource: (champ: string) => void;
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

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
        <span className="text-[13.5px] font-semibold">{base.libelle}</span>
        <span className="num text-[13.5px] font-semibold">{valeur(base)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 pt-1.5">
        <span className="text-[13.5px]">{tva.libelle}</span>
        <span className="num text-[13.5px]">{valeur(tva)}</span>
      </div>
      {droits.map((d) => (
        <div key={d.cle} className="flex items-baseline justify-between gap-3 pt-1.5">
          <span className="text-[13.5px]">{d.libelle}</span>
          <span className="num text-[13.5px]">{d.valeur ?? "—"}</span>
        </div>
      ))}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
        <span className="text-[14px] font-semibold">{total.libelle}</span>
        <span
          className={cn(
            "num text-[15px] font-semibold",
            totalNeFermePas && total.valeur !== null && "text-[color:var(--ve)]",
          )}
        >
          {valeur(total, ` ${devise}`)}
        </span>
      </div>
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
