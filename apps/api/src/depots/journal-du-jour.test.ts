/**
 * Le journal du jour, prouvé sans base : le rangement, les totaux exacts, ce
 * qui a changé entre deux exports, et le classeur Excel.
 *
 * Les montants et comptes d'essai sont des valeurs de forme, pas des données
 * comptables.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { classeurXlsx, lettreDeColonne } from "../xlsx.ts";
import { ecartEntre, rangerLeJournal } from "./journal-du-jour.ts";

const INSTANT = new Date("2026-10-28T09:15:00Z");

function ligne(partiel: Record<string, unknown>) {
  return {
    client_tenant_id: "c",
    client_nom: "Dossier d'essai",
    ecriture_id: "e1",
    journal: "J1",
    journal_libelle: "Journal un",
    piece_id: null,
    ecriture_libelle: "Écriture d'essai",
    ordinal: 1,
    compte: "A",
    compte_libelle: "Compte A",
    debit: "0",
    credit: "0",
    devise: "XXX",
    origine: "validee" as const,
    inscrite_le: INSTANT,
    heure: "09:15",
    par: null,
    reverses_id: null,
    contre_passee_le: null,
    ...partiel,
  };
}

describe("le rangement du journal", () => {
  it("groupe par journal dans l'ordre reçu, puis par écriture, et additionne sans flottant", () => {
    const journaux = rangerLeJournal(
      [
        ligne({ ecriture_id: "e1", ordinal: 1, debit: "9007199254740.993" }),
        ligne({ ecriture_id: "e1", ordinal: 2, compte: "B", credit: "9007199254740.993" }),
        ligne({ ecriture_id: "e2", ordinal: 1, debit: "0.1" }),
        ligne({ ecriture_id: "e2", ordinal: 2, compte: "B", credit: "0.1" }),
        ligne({ journal: "J2", ecriture_id: "e3", ordinal: 1, debit: "0.2" }),
        ligne({ journal: "J2", ecriture_id: "e3", ordinal: 2, compte: "B", credit: "0.1" }),
      ],
      3,
    );
    assert.deepEqual(
      journaux.map((j) => [j.code, j.ecritures.map((e) => e.id)]),
      [
        ["J1", ["e1", "e2"]],
        ["J2", ["e3"]],
      ],
    );
    assert.deepEqual(journaux[0]!.soldes, [
      { devise: "XXX", debit: "9007199254741.093", credit: "9007199254741.093", equilibre: true },
    ]);
    // Un journal qui ne tient pas le dit : le contrôle n'arrondit rien.
    assert.deepEqual(journaux[1]!.soldes, [
      { devise: "XXX", debit: "0.200", credit: "0.100", equilibre: false },
    ]);
  });
});

describe("ce qui a changé depuis l'export précédent", () => {
  it("compte les écritures ajoutées, contre-passées depuis, et retirées", () => {
    assert.deepEqual(
      ecartEntre(
        { ecritures: ["a", "b", "c"], contrePassees: ["c"] },
        { ecritures: ["a", "b", "c", "d", "e"], contrePassees: ["b", "c"] },
      ),
      { ajoutees: 2, contrePassees: 1, retirees: 0 },
    );
    assert.deepEqual(
      ecartEntre({ ecritures: ["a"], contrePassees: [] }, { ecritures: [], contrePassees: [] }),
      { ajoutees: 0, contrePassees: 0, retirees: 1 },
    );
  });
});

describe("le classeur Excel", () => {
  const feuille = (droiteAGauche = false) =>
    strFromU8(
      unzipSync(
        classeurXlsx(
          {
            nom: "Journal",
            entete: ["libelle", "debit"],
            lignes: [[{ texte: 'a < b & "c"' }, { montant: "9007199254740.993" }]],
            totaux: [[{ texte: "total" }, { montant: "9007199254740.993" }]],
            droiteAGauche,
          },
          3,
          INSTANT,
        ),
      )["xl/worksheets/sheet1.xml"]!,
    );

  it("écrit le montant tel quel, échappe le texte, met les totaux en gras", () => {
    const xml = feuille();
    assert.ok(xml.includes('<c r="B2" s="1"><v>9007199254740.993</v></c>'));
    assert.ok(xml.includes("a &lt; b &amp; &quot;c&quot;"));
    assert.ok(xml.includes('<c r="B3" s="3"><v>9007199254740.993</v></c>'));
    assert.ok(!xml.includes("rightToLeft"));
    assert.ok(feuille(true).includes('rightToLeft="1"'));
  });

  it("donne les mêmes octets pour le même contenu, et refuse un montant qui n'en est pas un", () => {
    const f = { nom: "J", entete: ["x"], lignes: [[{ montant: "1.5" }]] };
    assert.deepEqual(classeurXlsx(f, 3, INSTANT), classeurXlsx(f, 3, INSTANT));
    assert.throws(() => classeurXlsx({ ...f, lignes: [[{ montant: "1e3" }]] }, 3, INSTANT));
  });

  it("nomme les colonnes au-delà de Z", () => {
    assert.deepEqual([0, 25, 26, 27, 701].map(lettreDeColonne), ["A", "Z", "AA", "AB", "ZZ"]);
  });
});
