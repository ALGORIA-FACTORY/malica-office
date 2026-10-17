/**
 * Le stockage des pièces — la seule chose que `/rpc` ne peut pas porter.
 *
 * Un flux binaire n'a pas sa place dans un appel JSON : l'encoder en base64
 * ferait grossir chaque pièce d'un tiers, et interdirait de servir un PDF en
 * flux. Cette route existe pour cette raison, et pour aucune autre.
 *
 * Trois règles la tiennent, et il faut les lire ensemble.
 *
 * **L'autorisation est un `select`.** Pas une comparaison de `tenant_id` écrite
 * ici. On demande la pièce à la base, sous l'identité de l'appelant ; si la RLS
 * ne la rend pas, elle n'existe pas pour lui. Un `where tenant_id = ...` écrit à
 * la main dans ce fichier serait une seconde autorisation, plus faible que la
 * première, qu'un oubli ouvrirait — alors qu'un oubli de RLS ferme.
 *
 * **Ligne absente : 404, jamais 403.** Un 403 dirait « cette pièce existe, mais
 * pas pour vous » — et permettrait de sonder les identifiants d'un concurrent
 * une requête à la fois. Le 404 ne distingue pas l'inexistant de l'interdit,
 * parce que du point de vue de l'appelant ce sont la même chose.
 *
 * **Le chemin ne vient jamais du client.** Il se calcule à partir de la ligne
 * lue : `<STOCKAGE_RACINE>/<tenant_id>/<piece_id>`. Aucun segment n'est
 * concaténé depuis l'URL. La vérification de confinement qui suit est donc une
 * ceinture par-dessus des bretelles — on la garde quand même : c'est le genre de
 * garantie qu'on ne veut pas voir dépendre d'une relecture attentive.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Request, Response } from "express";

import { sousLAppelant } from "./cles-api.ts";
import type { Requete } from "./db.ts";

/**
 * La racine du stockage, exigée au démarrage comme `JWT_SECRET`.
 *
 * Une valeur par défaut serait pire que l'absence : elle écrirait les pièces
 * d'un client dans un répertoire temporaire, sans que personne ne s'en aperçoive
 * avant la première restitution.
 */
export function racine(): string {
  const valeur = process.env["STOCKAGE_RACINE"];
  if (!valeur) {
    throw new Error(
      "STOCKAGE_RACINE absente : l'API refuse de démarrer plutôt que d'écrire les pièces au hasard",
    );
  }
  return path.resolve(valeur);
}

/** Le type par défaut n'est pas une devinette : c'est l'aveu qu'on ne sait pas. */
const TYPE_INCONNU = "application/octet-stream";

/**
 * Un identifiant de pièce est un uuid, et rien d'autre.
 *
 * Sans ce filtre, « ../../etc/passwd » descendrait jusqu'à PostgreSQL, qui
 * refuserait le transtypage — et l'API rendrait 500. Ce serait sûr, mais bavard :
 * un 500 dit « votre saisie a voyagé », là où un 404 ne dit rien. La forme se
 * vérifie donc ici, avant la base.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Le chemin absolu d'une pièce, dérivé de la base et de rien d'autre.
 *
 * Les deux identifiants viennent d'un `select`, donc de PostgreSQL, donc ce sont
 * des uuid. On vérifie tout de même que le chemin résolu reste sous la racine :
 * si un jour quelqu'un fait passer un segment par là, la fonction refuse au lieu
 * de servir `/etc/passwd`.
 */
function cheminAbsolu(tenantId: string, pieceId: string): string {
  const base = racine();
  const resolu = path.resolve(base, tenantId, pieceId);
  const prefixe = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolu.startsWith(prefixe)) {
    throw new Error("chemin hors du stockage");
  }
  return resolu;
}

/**
 * Effacer les octets d'une pièce supprimée.
 *
 * ============================================================== POURQUOI
 *
 * La base supprime la ligne ; le fichier, lui, reste sur le disque. Une photo
 * qu'un dirigeant a demandé d'effacer et qui survit quelque part n'est pas une
 * suppression — c'est une promesse non tenue, et sur un document d'entreprise
 * elle se paie cher.
 *
 * Un fichier déjà absent n'est pas une erreur : la suppression est un état
 * qu'on atteint, pas une opération qu'on compte.
 */
export async function effacerContenu(tenantId: string, pieceId: string): Promise<void> {
  await rm(cheminAbsolu(tenantId, pieceId), { force: true });
}

interface LignePiece {
  id: string;
  tenant_id: string;
  content_type: string | null;
}

/**
 * Demande la pièce à la base sous l'identité de l'appelant — une session, ou
 * une clé d'API du cabinet : les deux passent par la même RLS.
 *
 * Aucun filtre de tenant ici — c'est le point. Ce que ce `select` rend est
 * exactement ce que les politiques autorisent.
 */
async function pieceAutorisee(
  req: Request,
  pieceId: string | undefined,
): Promise<LignePiece | null> {
  if (!pieceId || !UUID.test(pieceId)) return null;
  return sousLAppelant(req, (db) => lignePiece(db, pieceId));
}

async function lignePiece(db: Requete, pieceId: string): Promise<LignePiece | null> {
  const { rows } = await db.query<LignePiece>(
    `select id, tenant_id, content_type from pieces_v where id = $1`,
    [pieceId],
  );
  return rows[0] ?? null;
}

/**
 * Les octets d'une pièce, pour Malica — sur une connexion déjà placée sous
 * l'identité de l'appelant. Même `select`, même RLS que la route : ce que la
 * base ne rend pas n'existe pas, et `null` ne distingue pas l'interdit de
 * l'absent.
 */
export async function lireContenu(
  db: Requete,
  pieceId: string,
): Promise<{ octets: Uint8Array; type: string } | null> {
  if (!UUID.test(pieceId)) return null;
  const piece = await lignePiece(db, pieceId);
  if (!piece) return null;
  try {
    const octets = await readFile(cheminAbsolu(piece.tenant_id, piece.id));
    return { octets: new Uint8Array(octets), type: piece.content_type ?? TYPE_INCONNU };
  } catch {
    // La ligne existe, les octets non : le dépôt n'a jamais abouti.
    return null;
  }
}

/**
 * Quarante mégaoctets : vingt-quatre pages photographiées et emballées en PDF
 * tiennent dessous. Au-delà, ce n'est plus une pièce comptable — et sans
 * borne, un seul envoi remplirait le disque de tout le monde.
 */
const TAILLE_MAX_PIECE = 40 * 1024 * 1024;

class PieceTropGrosse extends Error {}

/** Un passe-plat qui compte, et coupe le flux au-delà de la borne. */
function borneDeTaille(max: number): Transform {
  let recu = 0;
  return new Transform({
    transform(morceau: Buffer, _encodage, suite) {
      recu += morceau.length;
      if (recu > max) {
        suite(new PieceTropGrosse());
        return;
      }
      suite(null, morceau);
    },
  });
}

/** Un passe-plat qui hache ce qui passe : l'empreinte des octets écrits, pas d'autres. */
function hacheur(): { flux: Transform; empreinte: () => string } {
  const h = createHash("sha256");
  const flux = new Transform({
    transform(morceau: Buffer, _encodage, suite) {
      h.update(morceau);
      suite(null, morceau);
    },
  });
  return { flux, empreinte: () => h.digest("hex") };
}

/**
 * La sonde de `/sante/profonde` : le stockage accepte-t-il d'écrire, puis de
 * relire ? Un disque plein ou un volume démonté se voient ici, avant la
 * première pièce d'un client.
 */
export async function sonderLeStockage(): Promise<void> {
  const temoin = path.join(racine(), `.sonde-${process.pid}`);
  await mkdir(racine(), { recursive: true });
  await writeFile(temoin, "ok");
  const relu = await readFile(temoin, "utf8");
  await rm(temoin, { force: true });
  if (relu !== "ok") throw new Error("le stockage ne relit pas ce qu'il écrit");
}

/**
 * Dépose les octets d'une pièce, et scelle leur empreinte SHA-256.
 *
 * Redéposer les MÊMES octets est sans effet (un renvoi réseau) ; d'autres
 * octets sur une pièce scellée sont refusés (409) — le contenu d'une pièce
 * comptable ne change pas sous son identifiant. Un doublon strict du tenant est
 * reçu, puis désigné (`doublonDe`) : le refuser ferait réessayer sans fin les
 * versions installées de l'application.
 */
export async function deposerContenu(req: Request, res: Response): Promise<void> {
  const piece = await pieceAutorisee(req, req.params["id"]);
  if (!piece) {
    res.status(404).json({ erreur: "pièce introuvable" });
    return;
  }

  const destination = cheminAbsolu(piece.tenant_id, piece.id);
  await mkdir(path.dirname(destination), { recursive: true });

  // On écrit à côté puis on renomme : une écriture interrompue laisse un fichier
  // partiel, et un fichier partiel servi comme une pièce comptable est pire
  // qu'une pièce absente. Le renommage, lui, est atomique.
  /*
   * ======================================= UN PROVISOIRE PAR REQUÊTE, PAS PAR PROCESSUS
   *
   * Le nom ne portait que le numéro du processus. Deux dépôts de la même pièce
   * arrivant ensemble — deux onglets, ou l'application rouverte pendant qu'un
   * envoi lent est en vol — visaient alors le MÊME fichier provisoire : leurs
   * octets s'intercalaient pendant que chacun hachait son propre flux, et la
   * seconde ne trouvait plus rien à renommer (`ENOENT`, rendu en 500).
   *
   * Mesuré le 18 octobre 2026 : quatre dépôts simultanés des mêmes octets →
   * trois 201 et un 500. Avec un nom par requête, chacun écrit chez lui et
   * renomme sur la même destination ; le dernier arrivé pose des octets
   * identiques, et la base a déjà scellé l'empreinte.
   *
   * Voir `depots/deux-depots-simultanes-ne-se-marchent-pas-dessus.test.ts`.
   */
  const provisoire = `${destination}.${randomUUID()}.partiel`;
  const hache = hacheur();
  let scelle: { sha256: string; doublonDe: string | null };
  try {
    await pipeline(req, borneDeTaille(TAILLE_MAX_PIECE), hache.flux, createWriteStream(provisoire));
    // La base d'abord, le renommage ensuite : un contenu refusé ne remplace
    // jamais les octets scellés.
    const sha256 = hache.empreinte();
    scelle = await sousLAppelant(req, async (db) => {
      const { rows } = await db.query<{ r: { sha256: string; doublonDe: string | null } }>(
        `select public.capture_sceller_empreinte($1, $2) as r`,
        [piece.id, sha256],
      );
      return rows[0]!.r;
    });
    await rename(provisoire, destination);
  } catch (erreur) {
    await rm(provisoire, { force: true });
    if (erreur instanceof PieceTropGrosse) {
      res.status(413).json({ erreur: "pièce trop volumineuse" });
      return;
    }
    if ((erreur as { code?: string }).code === "23514") {
      res.status(409).json({ erreur: "le contenu de cette pièce est scellé" });
      return;
    }
    throw erreur;
  }

  const { size } = await stat(destination);
  res.status(201).json({
    pieceId: piece.id,
    octets: size,
    sha256: scelle.sha256,
    doublonDe: scelle.doublonDe,
  });
}

/** Rend les octets d'une pièce, avec le type que porte la base. */
export async function servirContenu(req: Request, res: Response): Promise<void> {
  const piece = await pieceAutorisee(req, req.params["id"]);
  if (!piece) {
    res.status(404).json({ erreur: "pièce introuvable" });
    return;
  }

  const source = cheminAbsolu(piece.tenant_id, piece.id);
  let taille: number;
  try {
    taille = (await stat(source)).size;
  } catch {
    // La ligne existe, les octets non : la pièce a été enregistrée mais son
    // dépôt n'a jamais abouti. On le dit comme tel plutôt que de rendre un
    // fichier vide qui passerait pour un document illisible.
    res.status(404).json({ erreur: "contenu absent" });
    return;
  }

  // Le type vient de la base, jamais de l'extension ni du contenu. Absent, on
  // l'avoue au lieu de deviner.
  res.setHeader("Content-Type", piece.content_type ?? TYPE_INCONNU);
  res.setHeader("Content-Length", String(taille));
  // Les pièces ne sont pas publiques : aucun cache partagé ne doit les garder.
  res.setHeader("Cache-Control", "private, no-store");
  await pipeline(createReadStream(source), res);
}
