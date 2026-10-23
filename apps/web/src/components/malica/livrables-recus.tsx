import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { CHIFFRES_PV, SOURCES_PV } from "@/lib/pv-chiffres";
import { office } from "@/verticals/malica-office/composition";

/** Les livrables déjà publiés, jamais une copie d'un brouillon du cabinet. */
export function LivrablesRecus({ tenantId }: { tenantId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ["pv-client", tenantId],
    queryFn: () => office().collab.pvDuClient(tenantId),
  });
  const recevoir = useMutation({
    mutationFn: (id: string) => office().collab.pvAccuserReception(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pv-client", tenantId] }),
  });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
  if (docs.isPending)
    return (
      <p role="status" className="regle">
        {t("common.loading")}
      </p>
    );
  if (docs.isError)
    return (
      <div className="card" role="alert">
        <p>{texteDeLErreur(docs.error, "livrables-recus", t("common.error"))}</p>
        <button type="button" className="btn" onClick={() => void docs.refetch()}>
          {t("doc.retry")}
        </button>
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="regle">{t("relation.documents.regle")}</p>
      {recevoir.isError ? (
        <p role="alert">{texteDeLErreur(recevoir.error, "livrables-recus", t("common.error"))}</p>
      ) : null}
      {docs.data.length === 0 ? (
        <div className="card">
          <p>{t("relation.documents.vide")}</p>
        </div>
      ) : (
        docs.data.map(({ document: pv, recuLe, comptabilite }) => (
          <article key={pv.id} className="card">
            <div className="hd">
              <h2>{pv.titre}</h2>
              <span>{date(pv.envoyeLe ?? pv.at)}</span>
            </div>
            <details>
              <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
                {t("relation.documents.ouvrir")}
              </summary>
              {comptabilite ? (
                <p className="regle">{t("relation.documents.auteur", { cabinet: comptabilite })}</p>
              ) : null}
              {pv.sections.map((s, i) => (
                <section key={i} className="my-4">
                  <h3 className="font-semibold">{s.kicker}</h3>
                  <p className="whitespace-pre-line">{s.corps}</p>
                </section>
              ))}
              {pv.decisions ? (
                <section className="my-4">
                  <h3 className="font-semibold">{t("cab.pv.decisions.titre")}</h3>
                  <p className="whitespace-pre-line">{pv.decisions}</p>
                </section>
              ) : null}
              {pv.chiffres.length > 0 ? (
                <table className="my-4 w-full text-sm">
                  <caption className="text-start font-semibold">
                    {t("cab.pv.chiffres.titre")}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="text-start">
                        {t("cab.pv.col.chiffre")}
                      </th>
                      <th scope="col">{t("cab.pv.col.valeur")}</th>
                      <th scope="col">{t("cab.pv.col.source")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pv.chiffres.map((c, i) => (
                      <tr key={i}>
                        <td>{CHIFFRES_PV[c.label] ? t(CHIFFRES_PV[c.label]!) : c.label}</td>
                        <td className="text-end">
                          {c.genre === "montant"
                            ? `${montant(c.valeur, locale)} ${c.devise ?? ""}`
                            : c.valeur}
                        </td>
                        <td className="text-end">
                          {SOURCES_PV[c.source] ? t(SOURCES_PV[c.source]!) : c.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </details>
            <p className="regle">{t("relation.documents.receptionNote")}</p>
            {recuLe ? (
              <p role="status">{t("relation.documents.recu", { date: date(recuLe) })}</p>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={recevoir.isPending}
                onClick={() => recevoir.mutate(pv.id)}
              >
                {t("relation.documents.recevoir")}
              </button>
            )}
          </article>
        ))
      )}
    </div>
  );
}
