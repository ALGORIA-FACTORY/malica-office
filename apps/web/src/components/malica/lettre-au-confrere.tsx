/**
 * Le modèle de lettre d'information au confrère remplacé (7.3).
 *
 * Le code des devoirs professionnels de l'OECT (art. 12) veut que l'expert
 * appelé à remplacer un confrère l'en informe par lettre recommandée avec
 * accusé de réception. Malica en propose le texte, rempli des éléments que la
 * base connaît ; elle ne l'envoie pas. Rien ne s'affiche sans comptabilité
 * précédente : la base répond `null`.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { dateEnLettres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

export function LettreAuConfrere({
  cabinetId,
  clientTenantId,
}: {
  cabinetId: string;
  clientTenantId: string;
}) {
  const { t, locale } = useI18n();
  const [copie, setCopie] = useState(false);
  const lettre = useQuery({
    queryKey: ["lettre-au-confrere", cabinetId, clientTenantId],
    queryFn: () => office().identity.lettreAuConfrere(cabinetId, clientTenantId),
  });
  if (!lettre.data) return null;
  const l = lettre.data;
  const texte = t("cab.confrere.lettre.modele", {
    confrere: l.confrere,
    client: l.client,
    matricule: l.matricule ?? "—",
    depuis: dateEnLettres(l.depuis, locale),
    comptabilite: l.comptabilite,
  });
  return (
    <section className="mb-6 space-y-3 border border-s-[3px] border-border bg-card p-4">
      <h3 className="text-[15px] font-semibold">{t("cab.confrere.lettre.titre")}</h3>
      <p className="text-[13px] leading-snug text-muted-foreground">
        {t("cab.confrere.lettre.aide")}
      </p>
      <p className="whitespace-pre-line border border-border bg-background p-3 text-[13px] leading-relaxed">
        {texte}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="cab-button cab-button-secondary"
          onClick={() => void navigator.clipboard?.writeText(texte).then(() => setCopie(true))}
        >
          {t("cab.confrere.lettre.copier")}
        </button>
        {copie ? (
          <span role="status" className="text-[12px] text-muted-foreground">
            {t("cab.confrere.lettre.copie")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
