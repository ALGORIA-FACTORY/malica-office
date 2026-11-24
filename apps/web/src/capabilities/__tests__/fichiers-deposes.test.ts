// @vitest-environment jsdom
/**
 * Glisser ou coller des fichiers au poste de bureau : les mêmes contrôles qu'« Importer des
 * images / PDF ». Un PDF doit en être un, une image est cadrée et encodée en PDF, et tout autre
 * fichier refuse le lot avant qu'une lecture soit consommée.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../scanner", () => ({
  scanToPdf: async (_blob: Blob, base: string) => ({
    blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
    name: `${base}.pdf`,
    cropped: true,
    defauts: [],
  }),
}));

import { FichierNonPdf, files } from "../files";

const pdf = (nom: string) =>
  new File([new Uint8Array([37, 80, 68, 70, 45])], nom, { type: "application/pdf" });

describe("des fichiers déposés ou collés", () => {
  it("un vrai PDF entre tel quel, une image est cadrée en PDF, dans l'ordre du dépôt", async () => {
    const lot = await files.deposer([
      pdf("mars.pdf"),
      new File([new Uint8Array([1, 2, 3])], "ticket.jpg", { type: "image/jpeg" }),
    ]);
    expect(lot.map((p) => [p.name, p.source])).toEqual([
      ["mars.pdf", "pdf"],
      ["ticket.pdf", "photo"],
    ]);
    expect(lot[1]!.cropped).toBe(true);
  });

  it("un faux PDF refuse le lot, nommé, comme au sélecteur", async () => {
    const faux = new File(["bonjour"], "faux.pdf", { type: "application/pdf" });
    await expect(files.deposer([pdf("vrai.pdf"), faux])).rejects.toEqual(
      new FichierNonPdf(["faux.pdf"]),
    );
  });

  it("un fichier qui n'est ni une image ni un PDF refuse le lot", async () => {
    const texte = new File(["x"], "notes.docx", { type: "application/msword" });
    await expect(files.deposer([texte])).rejects.toBeInstanceOf(FichierNonPdf);
  });
});
