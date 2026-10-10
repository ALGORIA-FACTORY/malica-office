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

  it("la facture de loyer se range en DEUX natures, et c'est plus juste", async () => {
    /*
     * Le loyer et la quote-part de charges communes ne sont pas la même chose
     * dans le plan comptable tunisien : 613 « Locations » d'un côté, 614
     * « Charges locatives et de copropriété » de l'autre.
     *
     * Ce cas attendait « LOYER » pour les deux, faute d'une famille pour les
     * secondes. Les distinguer n'est pas un raffinement : c'est ce qui permet
     * de comparer un loyer d'un mois sur l'autre sans que le syndic le brouille.
     */
    assert.equal(
      (await famille("Loyer mensuel local à usage de bureaux - Immeuble Le Prestige")).famille_code,
      "LOYER",
    );
    assert.equal(
      (await famille("Quote-part charges communes (syndic, ascenseur, gardiennage)")).famille_code,
      "CHARGES_LOCATIVES",
    );
  });

  /**
   * ============ LES NATURES D'UNE PME TUNISIENNE, UNE PAR UNE
   *
   * Vingt et une familles, et ces libellés sont écrits comme une facture les
   * écrit — avec le nom du fournisseur quand la facture ne dit pas sa nature.
   * Une facture STEG ne porte pas le mot « électricité », une facture Ooredoo
   * ne porte pas « télécom » : nommer les monopoles et les opérateurs
   * tunisiens n'est pas un raccourci, c'est la seule façon de les reconnaître.
   *
   * La liste est exhaustive par famille, exprès : une famille sans cas est une
   * famille dont personne ne sait si elle marche.
   */
  const CAS: ReadonlyArray<readonly [string, string]> = [
    // Les trois lignes de la facture CASA-ELECT du 6 octobre 2026.
    ["Prise 2P+T somef 45", "FOURNITURES"],
    ["Boite app 2 module", "FOURNITURES"],
    ["Cable souple 3*2.5 extra cable", "FOURNITURES"],
    // Les deux lignes de la facture de loyer du 4 octobre 2026.
    ["Loyer mensuel local à usage de bureaux", "LOYER"],
    ["Quote-part charges communes (syndic, ascenseur, gardiennage)", "CHARGES_LOCATIVES"],
    // Les deux monopoles tunisiens.
    ["Facture STEG consommation électricité", "ENERGIE_EAU"],
    ["SONEDE consommation d'eau", "ENERGIE_EAU"],
    // Les opérateurs et fournisseurs d'accès.
    ["Abonnement internet fibre TOPNET", "TELECOM"],
    ["Facture Ooredoo mobile", "TELECOM"],
    ["Affranchissement Rapide Poste", "TELECOM"],
    // Le reste des natures, une chacune.
    ["Honoraires expert-comptable", "HONORAIRES"],
    ["Prime d'assurance multirisque COMAR", "ASSURANCE"],
    ["Gasoil station AGIL", "TRANSPORT"],
    ["Nuitée hôtel Tunis mission", "DEPLACEMENT"],
    ["Écran Dell 24 pouces", "PETIT_EQUIPEMENT"],
    ["Licence Microsoft 365", "LOGICIELS"],
    ["Nom de domaine et hébergement", "LOGICIELS"],
    ["Entretien climatiseur", "ENTRETIEN"],
    ["Impression de flyers", "PUBLICITE"],
    ["Intérim 3 jours", "PERSONNEL_EXTERIEUR"],
    ["Travail à façon découpe", "SOUS_TRAITANCE"],
    ["Bureau d'études structure", "ETUDES"],
    ["Ramette papier A4", "FOURNITURES"],
    ["Commission bancaire sur virement", "SERVICES_BANCAIRES"],
    ["Droit de timbre", "IMPOTS_DROITS"],
    ["Matière première résine", "MATIERES_PREMIERES"],
    ["Marchandises destinées à la revente", "MARCHANDISES"],
  ];

  it("reconnaît les vingt-six natures, et par le LIBELLÉ", async () => {
    const rates: string[] = [];
    for (const [ligne, code] of CAS) {
      const r = await famille(ligne);
      if (r.famille_code !== code) rates.push(`${ligne} → ${r.famille_code} (attendu ${code})`);
      else if (r.famille_source !== "designation_pattern")
        rates.push(`${ligne} : reconnu par le COMPTE et non par le libellé`);
    }
    assert.deepEqual(rates, [], `\n  ${rates.join("\n  ")}`);
  });

  it("couvre toutes les familles livrées : aucune n'est sans cas", async () => {
    /*
     * Une famille déclarée mais qu'aucun libellé n'atteint est une famille
     * morte : elle gonfle le référentiel sans rien classer. Ce cas compare la
     * liste ci-dessus aux familles de la base.
     */
    const { rows } = await pool.query<{ code: string }>(
      `select code from ref.charge_familles where not is_fallback and valid_to is null`,
    );
    const atteintes = new Set(CAS.map(([, code]) => code));
    const orphelines = rows.map((r) => r.code).filter((c) => !atteintes.has(c));
    assert.deepEqual(orphelines, [], "familles qu'aucun libellé n'atteint");
  });

  it("chaque famille porte un compte du plan comptable, et il existe", async () => {
    /*
     * `main_account` est documentaire au 7 octobre 2026 — la proposition
     * d'écriture ne le lit pas encore. Mais un compte inventé y resterait
     * invisible jusqu'au jour où on s'en servirait, et ce jour-là il produirait
     * une écriture fausse. On vérifie donc qu'il existe VRAIMENT.
     */
    const { rows } = await pool.query<{ code: string; main_account: string | null }>(
      `select f.code, f.main_account
         from ref.charge_familles f
        where not f.is_fallback and f.valid_to is null`,
    );
    const manquants: string[] = [];
    for (const f of rows) {
      if (!f.main_account) {
        manquants.push(`${f.code} : aucun compte`);
        continue;
      }
      const { rows: trouve } = await pool.query(
        `select 1 from ref.accounts where account_code = $1`,
        [f.main_account],
      );
      if (trouve.length === 0)
        manquants.push(`${f.code} : compte ${f.main_account} inconnu du plan`);
    }
    assert.deepEqual(manquants, []);
  });

  it("les deux règles fausses sont closes, pas effacées", async () => {
    /*
     * « Marchandises » pointait le compte 601, qui est « Matières premières »
     * dans le Système Comptable des Entreprises — les marchandises sont au 607.
     * Et « Honoraires » pointait le 665, qui est « Autres impôts et taxes » —
     * les honoraires sont au 622.
     *
     * Elles sont CLOSES par une date d'effet et non supprimées : une règle qui
     * a servi à ranger des pièces reste dans le référentiel, pour qu'on puisse
     * expliquer un classement ancien.
     */
    const { rows } = await pool.query<{ famille_code: string; valid_to: string | null }>(
      `select famille_code, valid_to::text from ref.charge_famille_rules
        where match_kind = 'account_prefix'
          and ((famille_code = 'MARCHANDISES' and pattern = '601')
            or (famille_code = 'HONORAIRES' and pattern = '665'))`,
    );
    assert.equal(rows.length, 2, "les deux règles doivent encore exister");
    for (const r of rows) assert.ok(r.valid_to, `${r.famille_code} : doit être close`);
  });

  it("et les deux comptes justes sont en place", async () => {
    assert.equal((await famille("article quelconque", "607")).famille_code, "MARCHANDISES");
    assert.equal((await famille("article quelconque", "622")).famille_code, "HONORAIRES");
  });

  it("un service de développement n'est pas une licence de logiciel", async () => {
    /*
     * Mesuré, et corrigé avant de livrer : le motif attrapait le mot
     * « logiciel » seul, et rangeait « prestation de développement logiciel »
     * en redevances. C'est un service.
     *
     * Il tombe donc en « non classée », ce qui est la bonne réponse : le
     * produit ne sait pas, et il le dit.
     */
    assert.equal(
      (await famille("Prestation de développement logiciel")).famille_code,
      "NON_CLASSE",
    );
    assert.equal((await famille("Progiciel de gestion")).famille_code, "LOGICIELS");
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

  it("le consommable de bureau de la facture PAPETERIE NOUR est une fourniture", async () => {
    /*
     * 10 octobre 2026, 21 h 58. « Non classé revient encore une fois » :
     * « Post-it 76×76 (lot de 12) », 47,700 TND, à côté de 467,000 de
     * fournitures bien reconnues. Le motif énumérait stylo, classeur,
     * agrafeuse — et pas le post-it.
     *
     * Les libellés ci-dessous sont écrits comme une facture tunisienne les
     * écrit, abréviations comprises.
     */
    for (const ligne of [
      "Post-it 76×76 (lot de 12)",
      "Post it 50x40",
      "Bloc-notes A5 quadrillé",
      "Cahier 96 pages",
      "Chemise cartonnée à sangle",
      "Ruban adhésif transparent 19mm",
      "Scotch double face",
      "Marqueur permanent noir",
      "Surligneur fluo jaune",
      "Boîte de trombones n°3",
      "Calculatrice de bureau 12 chiffres",
      "قرطاسية مكتبية",
    ]) {
      const r = await famille(ligne);
      assert.equal(r.famille_code, "FOURNITURES", ligne);
      assert.equal(r.famille_source, "designation_pattern", `${ligne} : le libellé doit décider`);
    }
  });

  it("et élargir le motif n'a pas rendu « non classé » impossible", async () => {
    /*
     * La garantie qui empêche la dérive. Il serait facile d'élargir le motif
     * jusqu'à ce que plus rien ne tombe en « non classé » — et ce serait la
     * pire issue : une ligne faussement classée ne se voit jamais, une ligne
     * visiblement non classée se corrige en un geste.
     *
     * « lot de » qualifie un conditionnement, pas une nature : s'il entrait
     * dans le motif, un lot de n'importe quoi deviendrait une fourniture.
     */
    assert.equal((await famille("Lot de 12 pneus 205/55 R16")).famille_code, "NON_CLASSE");
    assert.equal((await famille("Prestation XJ-440 selon devis")).famille_code, "NON_CLASSE");
  });

  it("ce qu'aucune règle ne reconnaît reste NON CLASSÉ, et le dit", async () => {
    /*
     * ======================= POURQUOI « JE NE SAIS PAS » PLUTÔT QU'UNE FAMILLE
     *
     * Il serait facile de ne jamais afficher « non classée » : il suffirait
     * d'une règle « compte 601 → matières premières », et comme l'imputation
     * vaut 601 pour TOUT achat, chaque charge recevrait une famille.
     *
     * Elle serait fausse pour presque toutes. Et une famille plausible se
     * propage dans l'analyse sans que personne la corrige — alors qu'un
     * « non classée » se voit et se corrige d'un geste.
     *
     * C'est le même arbitrage que partout dans ce dépôt : un refus vaut mieux
     * qu'une valeur inventée. Vingt-sept règles de libellé rendent le cas rare ;
     * elles ne le rendent pas impossible, et c'est tant mieux.
     */
    const r = await famille("Article divers réf. 44821");
    assert.equal(r.famille_code, "NON_CLASSE");
  });

  it("une vente ne reçoit aucune famille de charge", async () => {
    // Le compte 701 n'a volontairement aucune règle : une vente n'est pas une
    // charge, et lui en attribuer une serait un faux rangement.
    const r = await famille("Prestation de développement", "701");
    assert.equal(r.famille_code, "NON_CLASSE");
  });
});
