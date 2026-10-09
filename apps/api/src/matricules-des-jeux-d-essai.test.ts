/**
 * Les matricules écrits dans les jeux d'essai existent vraiment.
 *
 * ================================================================= POURQUOI
 *
 * Le 5 octobre 2026, la saisie d'un matricule fiscal a été validée contre le
 * référentiel (`ref.identifiant_formats`) : sept chiffres, une lettre de
 * contrôle, un code de TVA, une catégorie, un numéro d'établissement.
 *
 * Les jeux d'essai, eux, portaient depuis le 24 août des matricules à SEPT
 * CHIFFRES SANS LETTRE — « 7654321/B/M/000 ». Ils sont devenus invalides le
 * jour même, et personne ne l'a vu pendant trois jours : `npm test` restait
 * vert, parce qu'aucune épreuve de `npm test` ne crée les organisations du
 * jeu de données. Seule l'épreuve de bout en bout les crée, et elle est
 * rouge depuis le 7 octobre — « 13 réussites · 14 échecs », les quatorze
 * découlant des six organisations refusées.
 *
 * ============================================================= CE QU'ON EXIGE
 *
 * Qu'une donnée d'essai respecte le référentiel qu'elle est censée illustrer.
 * Un jeu d'essai qui porte une valeur que le produit refuse ne prépare pas le
 * produit : il le bloque, et il le bloque LOIN du fichier fautif — le message
 * d'erreur accusait la création d'organisation, pas le fichier qui l'appelle.
 *
 * Cette épreuve est volontairement bête et rapide : elle relit les fichiers
 * du dépôt, y cherche tout ce qui a la FORME d'un matricule, et demande au
 * référentiel si chacun est valide. Elle ne connaît aucun motif : le motif
 * vit en base, daté et versionné (R4). Le jour où une série s'élargit, elle
 * suit sans être touchée.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Les dossiers qui sèment des organisations ou des tiers.
 *
 * Des DOSSIERS, pas une liste de fichiers : la première version de cette
 * épreuve nommait deux fichiers, et l'épreuve de bout en bout est retombée
 * aussitôt sur un septième matricule, dans `outils/epreuves/`. Une liste tenue
 * à la main manque ce qu'on y ajoute.
 *
 * Ce qui est volontairement HORS du périmètre : `docs/`, qui CITE des
 * matricules réellement observés, fautes comprises — un diagnostic qui corrige
 * ce qu'il a vu ne vaut plus rien ; et les épreuves du code, qui éprouvent
 * justement le refus des formes invalides.
 */
const DOSSIERS = ["outils", "db/dev"];

/**
 * Ce qui RESSEMBLE à un matricule : des chiffres, puis au moins deux groupes
 * séparés par des barres. Large à dessein — c'est au référentiel de dire si
 * la forme est bonne, pas à cette expression.
 */
const FORME = /\b\d{6,8}[A-Za-z]?(?:\s*\/\s*[A-Za-z0-9]{1,3}){2,4}\b/g;

describe("les matricules des jeux d'essai", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });

  after(async () => {
    await pool.end();
  });

  for (const dossier of DOSSIERS) {
    it(`${dossier}/ n'écrit que des matricules que le référentiel accepte`, async () => {
      const fichiers = readdirSync(join(RACINE, dossier), {
        recursive: true,
        withFileTypes: true,
      }).filter((e) => e.isFile() && (e.name.endsWith(".mjs") || e.name.endsWith(".js")));

      const parValeur = new Map<string, string>();
      for (const f of fichiers) {
        const chemin = join(f.parentPath, f.name);
        for (const m of readFileSync(chemin, "utf8").match(FORME) ?? []) {
          if (!parValeur.has(m)) parValeur.set(m, chemin.slice(RACINE.length + 1));
        }
      }
      const trouves = [...parValeur.keys()];
      assert.ok(
        trouves.length > 0,
        `aucun matricule trouvé dans ${dossier}/ : l'épreuve ne mesure plus rien`,
      );

      const { rows } = await pool.query<{ valeur: string; ok: boolean }>(
        `select v.valeur,
                coalesce(bool_or(v.valeur ~ f.pattern), false) as ok
           from unnest($1::text[]) as v(valeur)
           left join ref.identifiant_formats f
                  on f.jurisdiction = 'TN' and f.kind = 'matricule_fiscal'
          group by v.valeur`,
        [trouves],
      );

      const refuses = rows
        .filter((r) => !r.ok)
        .map((r) => `${parValeur.get(r.valeur)} : ${r.valeur}`);
      assert.deepEqual(
        refuses,
        [],
        "le produit refuserait ces matricules à la saisie, donc le jeu d'essai ne se monte pas",
      );
    });
  }
});
