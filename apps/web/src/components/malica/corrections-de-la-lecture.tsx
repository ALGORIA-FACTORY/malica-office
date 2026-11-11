/**
 * Ce que la personne a corrigé à la main sur la pièce — vu du cabinet.
 *
 * Le cabinet voit, pour chaque composante corrigée : la valeur SAISIE, la valeur
 * LUE (la lecture n'est jamais modifiée, R7), l'auteur et le moment. La photo
 * est la pièce elle-même, juste à côté : on compare, on ne devine pas.
 */
import { useI18n } from "@/i18n";
import { libelleDuChamp, valeurLisible } from "@/lib/champ-lisible";
import type { CorrectionDeLecture } from "@malica/socle/ports/repositories";

export function CorrectionsDeLaLecture({
  corrections,
}: {
  corrections: readonly CorrectionDeLecture[];
}) {
  const { t, locale } = useI18n();
  if (corrections.length === 0) return null;
  const moment = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="border border-s-2 border-border border-s-signal-info bg-card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
        <span aria-hidden className="text-signal-info">
          ✎
        </span>{" "}
        {t("pme.crayon.cabinet.titre")}
      </p>
      <ul className="mt-2 space-y-2 text-[12.5px]">
        {corrections.map((c) => (
          <li key={c.champ}>
            <span className="font-medium text-foreground">{libelleDuChamp(c.champ, t)}</span>
            <span className="num block text-text-2">
              {t("pme.crayon.cabinet.valeurs", {
                saisi: valeurLisible(c.champ, c.valeur, locale),
                lu:
                  c.lue === null
                    ? t("pme.crayon.cabinet.luRien")
                    : valeurLisible(c.champ, c.lue, locale),
              })}
            </span>
            <span className="block text-text-2">
              {c.par ? t("pme.crayon.etat.saisi", { nom: c.par }) : t("pme.crayon.etat.saisiSans")}
              {" · "}
              {moment.format(new Date(c.le))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-text-2">{t("pme.crayon.cabinet.note")}</p>
    </div>
  );
}
