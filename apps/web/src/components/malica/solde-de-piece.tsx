import { useI18n } from "@/i18n";

/** Une absence de preuve ne se présente jamais comme une facture soldée. */
export function SoldeDePiece({
  paye,
  total,
  reste,
  soldee,
  progression,
  devise,
}: {
  paye: string | null;
  total: string | null;
  reste: string | null;
  soldee: boolean | null;
  progression: number | null;
  devise: string;
}) {
  const { t } = useI18n();
  const connu = soldee !== null;
  return (
    <div className="solde">
      <span className="hd">
        <b>
          {t(
            !connu
              ? "pme.paiement.indetermine"
              : soldee
                ? "pme.paiement.solde"
                : "pme.paiement.reste",
          )}
        </b>
        {connu ? (
          <span>
            {paye} / {total}
          </span>
        ) : null}
      </span>
      {progression !== null ? (
        <span className="bar" aria-hidden>
          <i style={{ width: `${progression}%` }} />
        </span>
      ) : null}
      <p className="ech">
        {!connu ? (
          t("pme.paiement.incomplet")
        ) : soldee ? (
          t("pme.paiement.solde")
        ) : (
          <>
            {t("pme.paiement.reste")}{" "}
            <b>
              {reste} {devise}
            </b>
          </>
        )}
      </p>
    </div>
  );
}
