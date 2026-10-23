/**
 * Payer en ligne — la page de choix du moyen, pour la société et pour le
 * cabinet (23 octobre 2026).
 *
 * Ce module n'est chargé QUE par les routes `/pme/payer/$paiementId` et
 * `/cabinet/payer/$paiementId`, en import différé et sous `COMMERCE` : dans
 * l'application Android, l'import disparaît du paquet avec la constante, et
 * rien de ce qui vend n'y entre (`outils/coque-sans-commerce.mjs`). Les deux
 * pages partagent leur logique (`hooks/use-paiement-en-ligne.ts`) et gardent
 * l'habillage de leur surface.
 */
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { EnTeteCabinet } from "@/components/malica/office-ui";
import { useChoixDuMoyen, useRetourDuPrestataire } from "@/hooks/use-paiement-en-ligne";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { libelleDuPaiement } from "@/lib/paiement";

const routeSociete = getRouteApi("/_authenticated/pme/payer/$paiementId");
const routeCabinet = getRouteApi("/_authenticated/cabinet/payer/$paiementId");
const OU_SOCIETE = "components/malica/payer-en-ligne#societe";
const OU_CABINET = "components/malica/payer-en-ligne#cabinet";

/**
 * Le choix du moyen de paiement — web et PWA seulement.
 *
 * Tout ce que la page montre vient des tables (20261023110000) : les moyens,
 * leur logo, leur rang, leur nom dans la langue de la personne
 * (`ref.labels`, `moyen_en_ligne`), s'ils sont actifs et si le prestataire
 * que la tour a ouvert les accepte. La page ne décide de rien : un moyen
 * inactif se dit « bientôt disponible » (D17, tant que l'intégration de La
 * Poste n'est pas contractée), un moyen que le prestataire en service
 * n'accepte pas se dit « indisponible ici ». Le montant est celui que la base
 * a calculé ; la page de carte est celle du PRESTATAIRE.
 *
 * Au retour, la personne arrive sur les réglages, où le paiement est vérifié
 * auprès du prestataire (`ARegler`, `abonnement-pilote.tsx`).
 */
export function PayerEnLigneSociete() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { paiementId } = routeSociete.useParams();
  const { paiements, choix, paiement, prestataire, payer, message, empechement } = useChoixDuMoyen(
    paiementId,
    OU_SOCIETE,
  );

  return (
    <div data-ecran="paiement" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme/reglages" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.payer.titre")}</span>
      </div>

      <div className="corps">
        {paiements.isPending || choix.isPending ? (
          <p className="et" aria-busy>
            {t("common.loading")}
          </p>
        ) : paiements.isError || choix.isError ? (
          <p className="warn" role="alert">
            {texteDeLErreur(paiements.error ?? choix.error, OU_SOCIETE, t("common.error"))}
          </p>
        ) : !paiement || paiement.etat === "paye" ? (
          <p className="et">{t("pme.payer.rienARegler")}</p>
        ) : (
          <>
            <div className="du">
              <b>{libelleDuPaiement(paiement, t)}</b>
              <span className="px">
                {t("pme.reglages.paiement.montant", {
                  ttc: montant(paiement.montant_ttc, locale),
                  devise: paiement.devise,
                })}
              </span>
            </div>

            {prestataire ? null : <p className="et">{t("pme.reglages.paiement.ferme")}</p>}

            <ul className="moyens">
              {(choix.data?.moyens ?? []).map((m) => {
                const pourquoi = empechement(m);
                return (
                  <li key={m.code}>
                    <button
                      type="button"
                      className="moyen"
                      data-moyen={m.code}
                      disabled={pourquoi !== null || payer.isPending}
                      aria-describedby={pourquoi ? `moyen-${m.code}` : undefined}
                      onClick={() => payer.mutate(m.code)}
                    >
                      <span className="logo">
                        <img src={m.logo} alt="" />
                      </span>
                      <span className="nm">{m.libelle}</span>
                      {pourquoi ? (
                        <span className="et" id={`moyen-${m.code}`}>
                          {pourquoi}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            {prestataire ? (
              <p className="securise">
                {prestataire.logo ? (
                  <span className="logo">
                    <img src={prestataire.logo} alt="" />
                  </span>
                ) : null}
                {t("pme.payer.securise", { prestataire: prestataire.libelle })}
              </p>
            ) : null}
          </>
        )}
        {message ? (
          <p className="t-body" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Le choix du moyen de paiement, côté cabinet (23 octobre 2026).
 *
 * La même logique que la page de la société (`useChoixDuMoyen`) — moyens,
 * logos et noms lus en table, montant calculé par la base, page de carte du
 * PRESTATAIRE —, dans l'habillage de la console du cabinet. Le prestataire
 * ramène ICI (`ECRANS_DE_RETOUR.cabinet`) : le paiement s'y vérifie.
 */
export function PayerEnLigneCabinet() {
  const { t, locale } = useI18n();
  const { paiementId } = routeCabinet.useParams();
  const { paiements, choix, paiement, prestataire, payer, message, empechement } = useChoixDuMoyen(
    paiementId,
    OU_CABINET,
  );
  const qc = useQueryClient();
  const retour = useRetourDuPrestataire(true, OU_CABINET, async () => {
    await qc.invalidateQueries({ queryKey: ["cab-abo-factures"] });
  });

  return (
    <div className="space-y-6">
      <EnTeteCabinet
        surtitre={<>{t("cab.payer.kicker")}</>}
        titre={<>{t("pme.payer.titre")}</>}
        retour={
          <Link
            to="/cabinet/abonnements"
            aria-label={t("pme.regler.retour")}
            className="mt-1 grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-muted"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              aria-hidden
            >
              <path d="M14.5 5.5L8 12l6.5 6.5" strokeWidth="2" />
            </svg>
          </Link>
        }
      />

      {paiements.isPending || choix.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : paiements.isError || choix.isError ? (
        <p className="text-sm text-signal-warn" role="alert">
          {texteDeLErreur(paiements.error ?? choix.error, OU_CABINET, t("common.error"))}
        </p>
      ) : !paiement || paiement.etat === "paye" ? (
        <p className="text-sm text-muted-foreground">{t("pme.payer.rienARegler")}</p>
      ) : (
        <div className="max-w-xl space-y-4">
          <div className="rounded-lg border border-border p-4">
            <p className="font-medium">{libelleDuPaiement(paiement, t)}</p>
            <p className="num text-sm text-muted-foreground">
              {t("pme.reglages.paiement.montant", {
                ttc: montant(paiement.montant_ttc, locale),
                devise: paiement.devise,
              })}
            </p>
          </div>

          {prestataire ? null : (
            <p className="text-sm text-muted-foreground">{t("pme.reglages.paiement.ferme")}</p>
          )}

          <ul className="space-y-2">
            {(choix.data?.moyens ?? []).map((m) => {
              const pourquoi = empechement(m);
              return (
                <li key={m.code}>
                  <button
                    type="button"
                    data-moyen={m.code}
                    disabled={pourquoi !== null || payer.isPending}
                    aria-describedby={pourquoi ? `moyen-${m.code}` : undefined}
                    onClick={() => payer.mutate(m.code)}
                    className="flex w-full items-center gap-4 rounded-lg border border-border p-3 text-start hover:border-foreground disabled:cursor-default disabled:hover:border-border"
                  >
                    {/* Les marques se posent sur blanc, dans les deux thèmes. */}
                    <span className="grid h-10 w-16 shrink-0 place-items-center rounded-md bg-white p-1">
                      <img src={m.logo} alt="" className="max-h-full max-w-full object-contain" />
                    </span>
                    <span className="flex-1 font-medium">{m.libelle}</span>
                    {pourquoi ? (
                      <span id={`moyen-${m.code}`} className="text-xs text-muted-foreground">
                        {pourquoi}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {prestataire ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {prestataire.logo ? (
                <span className="grid h-7 place-items-center rounded bg-white px-1.5">
                  <img src={prestataire.logo} alt="" className="h-5 object-contain" />
                </span>
              ) : null}
              {t("pme.payer.securise", { prestataire: prestataire.libelle })}
            </p>
          ) : null}
        </div>
      )}
      {retour.simulateur && retour.revenu === paiementId && !retour.retour ? (
        <div className="max-w-xl space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm">{t("pme.reglages.paiement.simulateur")}</p>
          <div className="flex flex-wrap gap-2">
            {(["paye", "refuse"] as const).map((decision) => (
              <button
                key={decision}
                type="button"
                className="rounded-md border border-foreground px-2.5 py-1 text-[12px] font-medium disabled:opacity-40"
                disabled={retour.simuler.isPending}
                onClick={() => retour.simuler.mutate({ id: paiementId, decision })}
              >
                {t(
                  decision === "paye"
                    ? "pme.reglages.paiement.simuler.payer"
                    : "pme.reglages.paiement.simuler.refuser",
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {retour.retour || message ? (
        <p className="text-sm" aria-live="polite">
          {retour.retour ?? message}
        </p>
      ) : null}
    </div>
  );
}
