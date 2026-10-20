/**
 * Un report exceptionnel d'échéance, tel que la base le rend — une seule
 * lecture pour le cabinet (`cabinet_reports_lire`) et pour la tour
 * (`plateforme.calendrier_lire`).
 */

export function versReport(r: Record<string, unknown>) {
  return {
    id: String(r["id"]),
    origine: (r["origine"] === "report_cabinet" ? "report_cabinet" : "report_algoria") as
      "report_cabinet" | "report_algoria",
    code: String(r["code"]),
    libelle: (r["libelle"] as string | null) ?? null,
    periode: String(r["periode"]),
    nouvelleDate: String(r["nouvelleDate"]),
    motif: String(r["motif"]),
    source: (r["source"] as string | null) ?? null,
    creeLe: String(r["creeLe"] ?? ""),
  };
}
