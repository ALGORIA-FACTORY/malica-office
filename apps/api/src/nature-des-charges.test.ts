/**
 * La nature d'une charge se lit sur le libellé.
 *
 * ================================================================= POURQUOI
 *
 * 7 octobre 2026 : « charges non classées ». Une facture de SUARL CASA-ELECT —
 * prises, boîtes d'appareillage, câble souple — et les trois articles portaient
 * la famille `NON_CLASSE`.
 *
 * La cause immédiate était le sens de la pièce, lu « vente », qui donnait
 * l'imputation 701 — un compte sans aucune règle. Mais la corriger ne suffisait
 * pas : avec le sens juste l'imputation devient 601, et TOUT achat tombait alors
 * dans « Marchandises ». Du câble acheté par une société de services n'est pas
 * une marchandise : une marchandise se revend.
 *
 * `charge_famille_resolve` savait depuis toujours apparier sur le LIBELLÉ
 * (`designation_pattern`) autant que sur le compte. Les dix règles du pack
 * étaient toutes du second type : le mécanisme existait, la donnée manquait.
 *
 * Ces cas tiennent les règles livrées. Ce ne sont pas des vérités — R10 : deux
 * cabinets peuvent loger le même câble à deux endroits, et les deux ont raison
 * chez eux. Ils tiennent que le DÉFAUT est utilisable, et qu'il ne range pas
 * toute une comptabilité dans une seule famille.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

describe("la famille d'une charge, d'après son libellé", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let pack = "";

  /** Le compte d'imputation d'un achat : le même pour tous (ref.account_mappings). */
  const COMPTE_ACHAT = "601";

  const famille = async (designation: string, compte = COMPTE_ACHAT) => {
    const { rows } = await pool.query<{ famille_code: string; famille_source: string }>(
      `select r.famille_code, r.famille_source
         from public.charge_famille_resolve($1, $2, $3, $4::date) r`,
      [pack, compte, designation, "2026-07-01"],
    );
    return rows[0]!;
  };

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = rows[0]!.id;
  });

  after(async () => {
    await pool.end();
  });

  it("les trois lignes de la facture CASA-ELECT sont des fournitures", async () => {
    // Les libellés EXACTS relevés sur la pièce bfb52a45 du 6 octobre 2026.
    for (const ligne of [
      "Prise 2P+T somef 45",
      "Boite app 2 module",
      "Cable souple 3*2.5 extra cable",
    ]) {
      const r = await famille(ligne);
      assert.equal(r.famille_code, "FOURNITURES", ligne);
      assert.equal(r.famille_source, "designation_pattern", `${ligne} : le libellé doit décider`);
    }
  });

  it("les deux lignes de la facture de loyer sont du loyer", async () => {
    for (const ligne of [
      "Loyer mensuel local à usage de bureaux - Immeuble Le Prestige, 3e étage (Sept. 2026)",
      "Quote-part charges communes (syndic, ascenseur, gardiennage)",
    ]) {
      assert.equal((await famille(ligne)).famille_code, "LOYER", ligne);
    }
  });

  it("reconnaît les natures courantes d'une PME tunisienne", async () => {
    const attendus: ReadonlyArray<readonly [string, string]> = [
      ["Honoraires de conseil", "HONORAIRES"],
      ["Gasoil station Shell", "TRANSPORT"],
      ["Abonnement internet fibre", "TELECOM"],
      ["Facture Ooredoo mobile", "TELECOM"],
      ["Ramette papier A4", "FOURNITURES"],
      ["Commission bancaire sur virement", "SERVICES_BANCAIRES"],
      ["Droit de timbre", "IMPOTS_DROITS"],
    ];
    for (const [ligne, code] of attendus) {
      assert.equal((await famille(ligne)).famille_code, code, ligne);
    }
  });

  it("le libellé passe AVANT le compte", async () => {
    /*
     * L'imputation vient du SENS de la pièce et donne un seul compte pour tous
     * les achats. Si le compte gagnait, toutes les charges d'un dossier
     * tomberaient dans la même famille — ce qui était le cas, et ne servait à
     * personne.
     */
    const r = await famille("Loyer mensuel du bureau", "601");
    assert.equal(r.famille_code, "LOYER");
    assert.equal(r.famille_source, "designation_pattern");
  });

  it("ce qu'aucune règle ne reconnaît garde le défaut du compte", async () => {
    // R10 : un défaut n'est pas un blocage. Une charge non reconnue reçoit la
    // famille du compte, et le cabinet la corrige.
    const r = await famille("Écran Dell 24 pouces");
    assert.equal(r.famille_source, "account_prefix");
    assert.equal(r.famille_code, "MARCHANDISES");
  });

  it("une vente ne reçoit aucune famille de charge", async () => {
    // Le compte 701 n'a volontairement aucune règle : une vente n'est pas une
    // charge, et lui en attribuer une serait un faux rangement.
    const r = await famille("Prestation de développement", "701");
    assert.equal(r.famille_code, "NON_CLASSE");
  });
});
