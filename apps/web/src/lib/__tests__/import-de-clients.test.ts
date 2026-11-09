// @vitest-environment jsdom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { lignesDuTableur, lireTexte, lireXlsx, reconnaitreColonnes } from "../import-de-clients";

describe("la liste de clients importée", () => {
  it("reconnaît les colonnes quel que soit leur nom ou leur ordre", () => {
    expect(
      reconnaitreColonnes(["E-mail du dirigeant", "Raison sociale", "Matricule Fiscal", "Offre"]),
    ).toEqual({ email: 0, raison_sociale: 1, matricule: 2, offre: 3 });
  });

  it("lit un CSV au point-virgule, avec guillemets", () => {
    const t = lireTexte(
      'Matricule fiscal;Raison sociale;E-mail du dirigeant\n1234567A/A/M/000;"Épicerie ""Fine""";Leila@Epicerie.tn\n',
    );
    const { lignes } = lignesDuTableur(t);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      matricule: "1234567A/A/M/000",
      raison_sociale: 'Épicerie "Fine"',
      email: "leila@epicerie.tn",
    });
  });

  it("lit des lignes collées depuis un tableur, sans en-tête", () => {
    const t = lireTexte("1234567a/a/m/000\tGarage Atlas\tatlas@garage.tn\n\n");
    const { lignes } = lignesDuTableur(t);
    expect(lignes[0]).toMatchObject({
      matricule: "1234567A/A/M/000",
      raison_sociale: "Garage Atlas",
      email: "atlas@garage.tn",
    });
  });

  it("lit la première feuille d'un classeur Excel", () => {
    const sst =
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      "<si><t>Matricule</t></si><si><t>Société</t></si><si><t>Mail</t></si>" +
      "<si><t>Librairie</t></si><si><t>a@b.tn</t></si></sst>";
    const feuille =
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>1432109L/A/M/000</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
      "</sheetData></worksheet>";
    const octets = zipSync({
      "xl/sharedStrings.xml": strToU8(sst),
      "xl/worksheets/sheet1.xml": strToU8(feuille),
    });
    const { lignes } = lignesDuTableur(lireXlsx(octets));
    expect(lignes[0]).toMatchObject({
      matricule: "1432109L/A/M/000",
      raison_sociale: "Librairie",
      email: "a@b.tn",
    });
  });
});
