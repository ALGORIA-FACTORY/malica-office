/**
 * L'accueil sous « Toutes les sociétés » (maquette approuvée le 13 novembre 2026).
 *
 * Les compteurs de toutes les sociétés, leurs prochaines échéances avec la société nommée, et
 * une ligne par société (un toucher ouvre son accueil). « Voir mes sociétés » mène à l'écran
 * « Mes sociétés », qui reste : l'accueil consolidé s'y ajoute, il ne le remplace pas.
 * Aucun montant : ce que le moteur ne rend pas pour une société ne s'additionne pas (R3).
 */
import { useNavigate } from "@tanstack/react-router";

import { useSocietesEnBref } from "@/hooks/use-societes-en-bref";
import { useI18n } from "@/i18n";

import { usePme } from "./pme-context";

/** Combien d'échéances l'accueil en montre. */
const ECHEANCES_MONTREES = 3;

export function AccueilConsolide() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const { lignes, total, charge, echeances } = useSocietesEnBref();

  const nomDe = (id: string) => pme.dossiers.find((d) => d.id === id)?.name ?? "";
  const prochaines = echeances
    .filter((e) => e.status !== "fait")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, ECHEANCES_MONTREES);
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const etat = (l: (typeof lignes)[number]) =>
    [
      l.enRetard > 0 ? t("pme.mesSocietes.enRetardN", { count: l.enRetard }) : null,
      l.aTraiter > 0 ? t("pme.mesSocietes.aTraiterN", { count: l.aTraiter }) : null,
      l.aLire > 0 ? t("pme.mesSocietes.aLireN", { count: l.aLire }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("pme.mesSocietes.aJour");

  return (
    <div data-ecran="a-la-ligne" data-famille="papiers" className="accueil-consolide">
      <div className="tot">
        <div>
          <small>{t("pme.notifs.onglet.aTraiter")}</small>
          <b>{charge ? "—" : total("aTraiter")}</b>
        </div>
        <div>
          <small>{t("pme.mesSocietes.aLire")}</small>
          <b>{charge ? "—" : total("aLire")}</b>
        </div>
        <div data-alerte={!charge && total("enRetard") > 0 ? "" : undefined}>
          <small>{t("pme.mesSocietes.enRetard")}</small>
          <b>{charge ? "—" : total("enRetard")}</b>
        </div>
      </div>

      <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("pme.toutes.prochainesEcheances")}
      </h2>
      {prochaines.length === 0 ? (
        <p className="invite">{charge ? "…" : t("pme.toutes.aucuneEcheance")}</p>
      ) : (
        <ul className="lignes mt-2">
          {prochaines.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => void navigate({ to: "/pme/echeances" })}>
                <span className="bd">
                  <b>{e.label}</b>
                  <span>
                    {nomDe(e.tenantId)} · {jour(e.dueDate)}
                  </span>
                </span>
                {e.status === "en_retard" ? <em>{t("pme.mesSocietes.retard")}</em> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("pme.toutes.vosSocietes")}
      </h2>
      <ul className="lignes mt-2">
        {lignes.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => pme.afficherSociete(l.id)}>
              <span className="bd">
                <b>{l.name}</b>
                <span>{charge ? "…" : etat(l)}</span>
              </span>
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center border border-border px-4 text-sm font-medium"
        onClick={() => void navigate({ to: "/pme/societes" })}
      >
        {t("pme.toutes.voirMesSocietes")}
      </button>
    </div>
  );
}
