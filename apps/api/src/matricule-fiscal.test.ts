/**
 * Le matricule fiscal se vérifie à la saisie.
 *
 * ================================================================= POURQUOI
 *
 * 4 octobre 2026. Une facture de loyer parfaitement lue est rejetée : « La
 * pièce concerne 1876543W/A/M/000, pas ALGORIA FACTORY SARL (1856324/A/M/000). »
 *
 * Le contrôle avait raison. Il avait bien lu la pièce. C'est la FICHE de
 * l'organisation qui était fausse — et elle portait `1856324/A/M/000`, sept
 * chiffres SANS la lettre de clé. Ce n'est pas un matricule tunisien valide, et
 * la création l'avait accepté sans rien dire.
 *
 * Une fiche mal saisie fait échouer TOUTES les pièces du dossier, et le motif
 * affiché accuse la pièce. C'est la seule classe de défaut du diagnostic
 * qu'aucun test ne pouvait attraper — un test compare une fiche qu'il a semée à
 * une pièce qu'il a fabriquée, donc les deux concordent toujours. Ce qui PEUT
 * être tenu, c'est le format, et il ne l'était pas.
 *
 * ============================================ POURQUOI PAS UNE EXPRESSION EN DUR
 *
 * La forme d'un matricule est une règle TUNISIENNE. L'écrire en TypeScript ou
 * dans un `check` de colonne violerait R4 et R5 : le jour où le produit sert
 * l'UEMOA, il faudrait forker le code au lieu d'activer un pack.
 *
 * Le motif vit donc dans `ref.identifiant_formats`, daté et versionné par
 * juridiction, avec son exemple et sa référence légale — comme un taux de TVA.
 * Une juridiction sans format déclaré ne valide rien : ce n'est pas un repli
 * implicite, c'est une absence de règle, visible dans le référentiel.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le format du matricule fiscal", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `mf-${Date.now()}`;
  let u: Utilisateur;
  const creees: string[] = [];

  /** Tente de créer une PME avec ce matricule ; rend l'erreur, ou null. */
  async function creer(legalId: string | null): Promise<string | null> {
    // Un matricule n'appartient qu'à une société active (20 octobre 2026) :
    // cette épreuve juge la FORME, elle range donc ses sociétés précédentes
    // avant d'en créer une autre, pour pouvoir rejouer un même matricule.
    await archiver();
    try {
      const id = await sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [`${marque} ${legalId ?? "sans"}`, legalId],
        );
        return rows[0]!.id;
      });
      creees.push(id);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
  });

  async function archiver(): Promise<void> {
    if (creees.length === 0) return;
    await sousIdentite(u.id, (db) =>
      db.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [creees],
      ),
    );
  }

  after(async () => {
    await archiver();
    await fermerLePool();
  });

  it("accepte le vrai matricule d'ALGORIA FACTORY", async () => {
    assert.equal(await creer("1876543W/A/M/000"), null);
  });

  it("accepte celui de l'émetteur de la facture de loyer", async () => {
    // 1456987L/A/P/000 : le troisième groupe n'est pas toujours « M ».
    assert.equal(await creer("1456987L/A/P/000"), null);
  });

  it("REFUSE celui qui était sur le staging : sept chiffres sans lettre de clé", async () => {
    const erreur = await creer("1856324/A/M/000");
    assert.ok(erreur, "ce matricule n'est pas valide et doit être refusé");
    assert.match(
      erreur,
      /matricule|identifiant/i,
      `le refus doit nommer ce qui est en cause : ${erreur}`,
    );
  });

  it("le refus montre la forme attendue, pas seulement « invalide »", async () => {
    /*
     * Un message qui dit « format invalide » laisse la personne deviner. Celui-ci
     * doit porter l'exemple du référentiel, pour qu'elle voie ce qui manque —
     * ici, la lettre après les sept chiffres.
     */
    const erreur = (await creer("1856324/A/M/000")) ?? "";
    assert.match(erreur, /1876543W\/A\/M\/000/, `le message doit montrer un exemple : ${erreur}`);
  });

  /**
   * ===================== LES VARIANTES, ET POURQUOI « A/M » NE SUFFIT PAS
   *
   * Corrigé le 5 octobre 2026 sur signalement du commanditaire. Le premier
   * motif posé ce matin acceptait n'importe quelle lettre aux deux positions du
   * milieu, ce qui couvrait les variantes par accident — mais acceptait aussi
   * « /Z/Q/ », qui n'existe pas. Permissif et faux à la fois.
   *
   * La forme complète :
   *
   *   7 chiffres + lettre de contrôle / code de TVA / catégorie / 3 chiffres
   *                                     A B P D N     M C P N E
   *
   * Les deux séries sont énumérées : c'est ce qui distingue une validation
   * d'une apparence de validation. Une faute de frappe sur la catégorie est
   * exactement le genre d'erreur qui bloque ensuite TOUTES les pièces du
   * dossier, et c'est ici qu'on l'arrête.
   *
   * Si une série devait s'élargir, elle s'élargit dans `ref.identifiant_formats`
   * — daté, versionné, sans déploiement. C'est tout l'intérêt d'avoir sorti le
   * motif du code (R4).
   */
  const CODES_TVA = ["A", "B", "P", "D", "N"] as const;
  const CATEGORIES = ["M", "C", "P", "N", "E"] as const;

  it("accepte les vingt-cinq combinaisons déclarées", async () => {
    const refuses: string[] = [];
    for (const tva of CODES_TVA) {
      for (const cat of CATEGORIES) {
        const mf = `1234567A/${tva}/${cat}/000`;
        if (await creer(mf)) refuses.push(mf);
      }
    }
    assert.deepEqual(refuses, [], `ces formes sont valides et doivent passer`);
  });

  it("accepte un établissement secondaire, dont le numéro n'est pas 000", async () => {
    // Le dernier groupe numérote l'établissement : une succursale ne porte pas
    // « 000 ». Le refuser couperait les PME à plusieurs établissements.
    assert.equal(await creer("1234567A/A/E/001"), null);
    assert.equal(await creer("1234567A/A/E/042"), null);
  });

  it("accepte la minuscule, que l'OCR rend parfois ainsi — et la RANGE en capitales", async () => {
    /*
     * On accepte large, on range net.
     *
     * Refuser pour une casse n'apprend rien à la personne. Mais ENREGISTRER la
     * minuscule préparerait un défaut silencieux : le contrôle `destinataire`
     * compare la fiche au matricule lu sur la pièce, qui est imprimé en
     * capitales. Une fiche en minuscules ferait rejeter toutes les pièces du
     * dossier, pour une différence invisible à l'œil.
     */
    assert.equal(await creer("1234567a/a/m/000"), null);
    const rangee = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ legal_id: string }>(
        `select legal_id from identity.organizations where id = $1`,
        [creees[creees.length - 1]],
      );
      return rows[0]!.legal_id;
    });
    assert.equal(rangee, "1234567A/A/M/000");
  });

  it("REFUSE un code de TVA qui n'existe pas", async () => {
    // « Z » n'est pas un code de TVA tunisien. Le motif du matin l'acceptait.
    for (const faux of ["1234567A/Z/M/000", "1234567A/X/M/000", "1234567A/1/M/000"]) {
      assert.ok(await creer(faux), `« ${faux} » doit être refusé`);
    }
  });

  it("REFUSE une catégorie d'établissement qui n'existe pas", async () => {
    for (const faux of ["1234567A/A/Q/000", "1234567A/A/Z/000", "1234567A/A/0/000"]) {
      assert.ok(await creer(faux), `« ${faux} » doit être refusé`);
    }
  });

  it("refuse les autres façons de se tromper", async () => {
    for (const faux of [
      "1876543W/A/M/00", // trois chiffres attendus à la fin
      "187654W/A/M/000", // six chiffres
      "1876543W/A/M", // un groupe manquant
      "1876543W-A-M-000", // mauvais séparateur
      "ALGORIA FACTORY", // pas un matricule du tout
    ]) {
      assert.ok(await creer(faux), `« ${faux} » doit être refusé`);
    }
  });

  it("tolère les espaces autour, qui viennent du copier-coller", async () => {
    // Refuser pour une espace apprend à la personne que le produit est tatillon,
    // pas qu'elle s'est trompée. On nettoie ce qui ne change pas la valeur.
    assert.equal(await creer("  1876543W/A/M/000  "), null);
  });

  it("un matricule absent reste permis : toutes les PME n'en ont pas encore", async () => {
    /*
     * Une entreprise en cours d'immatriculation s'inscrit sans matricule, et le
     * renseigne ensuite. Exiger le matricule à la création bloquerait
     * l'inscription — R10 : un défaut n'est pas un blocage.
     */
    assert.equal(await creer(null), null);
  });
});
