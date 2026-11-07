/**
 * Une date d'écriture, dans la langue de la personne — jamais un horodatage
 * brut. Lue par la file du cabinet et par ses échéances.
 */
export function jourDeLEcriture(iso: string, locale: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
