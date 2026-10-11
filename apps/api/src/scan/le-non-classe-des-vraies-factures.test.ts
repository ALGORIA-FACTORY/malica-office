/**
 * « Non classé » sur de VRAIES désignations.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026, troisième fois : « le non classé revient, check et
 * corrige ».
 *
 * Diagnostic fait sur le staging, sur les articles réellement projetés — pas
 * sur une reconstitution. Six désignations retombaient sur le repli, et la
 * cause n'est pas celle qu'on croit :
 *
 *   Bureau opérateur 160x80 plateau mélaminé chêne      → NON_CLASSE
 *   Fauteuil de direction cuir, mécanisme synchrone      → NON_CLASSE
 *   Station d'accueil USB-C                              → NON_CLASSE
 *   Extension de garantie 3 ans sur site                 → NON_CLASSE
 *   Boite app 2 module                                   → NON_CLASSE
 *   Cable souple 3*2.5                                   → NON_CLASSE
 *
 * La règle du mobilier dit, littéralement :
 *
 *     (ordinateur|écran|…|chaise|bureau +\(meuble\)|armoire|…)
 *
 * `bureau +\(meuble\)` exige les parenthèses DANS le texte de la facture. Une
 * règle écrite pour une facture imaginaire, que personne n'imprime. Et la
 * liste connaît « chaise » mais pas « fauteuil », « ordinateur » mais pas
 * « station d'accueil ».
 *
 * ============================== POURQUOI LE COMPTE NE SAUVE PAS LA SITUATION
 *
 * Le pack porte aussi des règles par préfixe de compte, et l'on pourrait
 * croire qu'un achat tombe dans sa famille par là. Non : le compte principal
 * des achats du pack tunisien est `601`, et la règle `601 → MARCHANDISES` est
 * CLOSE (valid_to = valid_from). C'était juste — imputer tout achat en
 * marchandises serait faux — mais cela laisse la désignation seule.
 *
 * Donc : pas de filet. Une désignation non prévue tombe au repli, et y reste.
 *
 * ============================================================ CE QUE CECI N'EST PAS
 *
 * Ce n'est pas la correction définitive. Avec des règles d'expression, il y
 * aura toujours une désignation non prévue — et le commanditaire la verra
 * encore. La réponse de fond est la couche par organisation (R10) : qu'une
 * ligne non classée se range à la main, et que ce choix serve la prochaine
 * fois. Ces épreuves tiennent le référentiel LIVRÉ, pas la fin de l'histoire.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool } from "../db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la famille d'une désignation réelle", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let packId = "";

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    packId = rows[0]!.id;
  });

  after(async () => {
    await pool.end();
    await fermerLePool();
  });

  /** La résolution telle que la projection l'appelle : sans compte, à une date. */
  const famille = async (designation: string) => {
    const { rows } = await pool.query<{ famille_code: string; famille_source: string }>(
      `select famille_code, famille_source
         from public.charge_famille_resolve($1, null, $2, date '2026-10-01')`,
      [packId, designation],
    );
    return rows[0] ?? { famille_code: "NON_CLASSE", famille_source: "fallback" };
  };

  /*
   * Les six désignations relevées sur le staging, mot pour mot. Ce sont des
   * factures que le commanditaire a photographiées lui-même.
   */
  const ATTENDUES: Array<[string, string]> = [
    ["Bureau opérateur 160x80 plateau mélaminé chêne", "PETIT_EQUIPEMENT"],
    ["Fauteuil de direction cuir, mécanisme synchrone", "PETIT_EQUIPEMENT"],
    ["Station d'accueil USB-C", "PETIT_EQUIPEMENT"],
    ["DK-USBC Station d'accueil USB-C", "PETIT_EQUIPEMENT"],
    ["GAR-3A Extension de garantie 3 ans sur site", "ENTRETIEN"],
    ["Boite app 2 module", "FOURNITURES"],
    ["Cable souple 3*2.5 extra cable", "FOURNITURES"],
    ["Post-it 76x76 (lot de 12)", "FOURNITURES"],
  ];

  for (const [designation, attendue] of ATTENDUES) {
    it(`« ${designation} » se range en ${attendue}`, async () => {
      const f = await famille(designation);
      assert.equal(
        f.famille_code,
        attendue,
        `relevé « ${f.famille_code} » (${f.famille_source}) — le repli n'est pas un classement`,
      );
      assert.notEqual(f.famille_source, "fallback");
    });
  }

  it("et une désignation qui ne dit rien tombe toujours au repli, sans inventer", async () => {
    /*
     * Le repli doit rester. Une règle attrape-tout rangerait n'importe quoi
     * quelque part, et un classement faux est pire qu'un « non classé » —
     * celui-ci se voit et se corrige.
     */
    const f = await famille("XZ-42");
    assert.equal(f.famille_code, "NON_CLASSE");
    assert.equal(f.famille_source, "fallback");
  });

  it("le préfixe de compte garde la priorité la plus basse, et la désignation gagne", async () => {
    // Un compte de fournitures (606) sur une désignation d'honoraires doit
    // rendre HONORAIRES : la désignation est plus précise que le compte.
    const { rows } = await pool.query<{ famille_code: string; famille_source: string }>(
      `select famille_code, famille_source
         from public.charge_famille_resolve($1, '6061', 'Honoraires de conseil', date '2026-10-01')`,
      [packId],
    );
    assert.equal(rows[0]!.famille_code, "HONORAIRES");
    assert.equal(rows[0]!.famille_source, "designation_pattern");
  });
});
