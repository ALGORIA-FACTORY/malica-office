/**
 * Ce qui attend de partir, dans « Vos documents » — et la pastille de l'accueil.
 *
 * Une pièce en file n'est pas une pièce de l'API : elle n'a ni lecture, ni
 * montant, ni statut comptable. Elle a un état à elle — en attente, envoi,
 * refusée — et deux gestes sur un refus. Elle se distingue d'un liseré, pour
 * qu'on ne la confonde jamais avec ce que le cabinet a déjà.
 */
import { Link } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import type { ElementDeFile } from "@/lib/hors-ligne/file";

function tailleLisible(octets: number, locale: string): string {
  const mo = octets / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mo)} Mo`;
}

function Ligne({ e }: { e: ElementDeFile }) {
  const { t, locale } = useI18n();
  const { file } = usePme();
  const etat = t(`pme.file.etat.${e.etat}` as MessageKey, { raison: e.derniereErreur ?? "" });
  const jour = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(
    new Date(e.creeLe),
  );
  return (
    <div className="grid grid-cols-[auto_38px_1fr_auto] items-center gap-2.5 border-t border-border border-s-2 border-s-line-strong py-2.5 ps-2">
      <span aria-hidden className="h-[6px] w-[6px] bg-line-strong" />
      <span className="num text-[11px] text-muted-foreground">{jour}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium">{e.nomFichier}</span>
        <span className="mt-px block text-[11px] text-muted-foreground">{etat}</span>
      </span>
      {e.etat === "echec_definitif" ? (
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => file.reessayer(e.cle)}
            className="min-h-[44px] px-2 text-[11px] font-medium uppercase tracking-wider"
          >
            {t("pme.file.reessayer")}
          </button>
          <button
            type="button"
            onClick={() => file.abandonner(e.cle)}
            className="min-h-[44px] px-2 text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            {t("pme.file.abandonner")}
          </button>
        </span>
      ) : (
        <span className="num text-[11px] text-muted-foreground">
          {tailleLisible(e.taille, locale)}
        </span>
      )}
    </div>
  );
}

/** La section, en tête de la liste. Rien si rien n'attend. */
export function FileLocale() {
  const { t } = useI18n();
  const { file } = usePme();
  if (file.elements.length === 0) return null;
  return (
    <div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2.5 border-t border-foreground pb-[5px] pt-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
          {t("pme.file.titre")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t("pme.file.pastille", { count: file.elements.length })}
        </span>
      </div>
      {file.elements.map((e) => (
        <Ligne key={e.cle} e={e} />
      ))}
    </div>
  );
}

/** Sur l'accueil : « 3 à envoyer », qui mène à la liste. Rien si rien n'attend. */
export function PastilleAEnvoyer() {
  const { t } = useI18n();
  const { file } = usePme();
  if (file.elements.length === 0) return null;
  return (
    <Link
      to="/pme/list"
      className="mx-[22px] mt-2 flex min-h-[44px] items-center justify-between border border-border bg-card px-3 text-[12px]"
    >
      <span>{t("pme.file.pastille", { count: file.elements.length })}</span>
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
    </Link>
  );
}
