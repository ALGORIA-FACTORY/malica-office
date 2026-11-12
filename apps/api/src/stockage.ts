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
import { fabrique } from "./miniature.ts";
import { consigner, type Issue } from "./observabilite/journal.ts";
import { noterLObjet } from "./observabilite/trace.ts";

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

/*
 * ============================================ UNE PIÈCE N'EST JAMAIS UNE PAGE
 *
 * Audit de sécurité du 6 novembre 2026, constat S1 : une « pièce » déclarée
 * `text/html` était rendue comme une page, sur l'origine de l'application —
 * son script s'exécutait avec la session de qui l'ouvrait.
 *
 * Les types admis sont ceux que produisent le scanner, l'import d'images et
 * le dépôt de PDF ; la porte de la base tient la même liste
 * (`capture_piece_poser_chemin`, migration `20261205092500`). Chacun se
 * reconnaît à ses premiers octets : un type déclaré que les octets démentent
 * est refusé au dépôt.
 */

/** Ce qu'il faut lire du début d'un fichier pour le reconnaître : un PDF peut tarder. */
const TETE = 1024;

const latin1 = (tete: Buffer, debut: number, fin: number) =>
  tete.subarray(debut, fin).toString("latin1");

/** Les marques ISO-BMFF d'une image HEIF/HEIC (`ftyp` à l'octet 4). */
const MARQUES_HEIF = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

const SIGNATURES: Readonly<Record<string, (tete: Buffer) => boolean>> = {
  // La norme tolère quelques octets avant l'en-tête : on le cherche dans le
  // premier kilo, comme l'écran (`capabilities/files.ts`).
  "application/pdf": (t) => latin1(t, 0, TETE).includes("%PDF-"),
  "image/jpeg": (t) => t[0] === 0xff && t[1] === 0xd8 && t[2] === 0xff,
  "image/png": (t) => latin1(t, 0, 8) === "\x89PNG\r\n\x1a\n",
  "image/webp": (t) => latin1(t, 0, 4) === "RIFF" && latin1(t, 8, 12) === "WEBP",
  "image/heic": (t) => latin1(t, 4, 8) === "ftyp" && MARQUES_HEIF.has(latin1(t, 8, 12)),
};

/** Le type est-il de la liste fermée ? */
function typeAdmis(type: string | null): type is string {
  return type !== null && Object.hasOwn(SIGNATURES, type);
}

/**
 * Les octets disent-ils le type déclaré ? Sans type déclaré (un client
 * ancien), ils doivent au moins être l'un des types admis.
 */
function octetsConformes(type: string | null, tete: Buffer): boolean {
  if (type === null) return Object.values(SIGNATURES).some((reconnait) => reconnait(tete));
  return typeAdmis(type) && SIGNATURES[type]!(tete);
}

class TypeRefuse extends Error {}

/**
 * Un passe-plat qui retient le début du flux, le juge, puis le laisse passer
 * — ou coupe le flux avant qu'un octet ne soit écrit.
 */
function signatureAttendue(type: string | null): Transform {
  const tete: Buffer[] = [];
  let lus = 0;
  let jugee = false;
  const juger = (): Buffer | null => {
    jugee = true;
    const debut = Buffer.concat(tete);
    return octetsConformes(type, debut) ? debut : null;
  };
  return new Transform({
    transform(morceau: Buffer, _encodage, suite) {
      if (jugee) {
        suite(null, morceau);
        return;
      }
      tete.push(morceau);
      lus += morceau.length;
      if (lus < TETE) {
        suite();
        return;
      }
      const debut = juger();
      suite(debut ? null : new TypeRefuse(), debut ?? undefined);
    },
    flush(suite) {
      if (jugee) {
        suite();
        return;
      }
      const debut = juger();
      suite(debut ? null : new TypeRefuse(), debut ?? undefined);
    },
  });
}

/**
 * Ce qui accompagne tout contenu servi — une pièce, un export : jamais une
 * page active sur l'origine de l'application. Pièce jointe (l'écran lit les
 * octets par `fetch`, il ne navigue jamais vers cette route), aucun reniflage
 * du type, et une CSP qui ôte au document tout script, toute origine, toute
 * ressource, s'il venait malgré tout à s'afficher.
 */
const CSP_DU_CONTENU = "sandbox; default-src 'none'";

/**
 * Un identifiant de pièce est un uuid, et rien d'autre.
 *
 * Sans ce filtre, « ../../etc/passwd » descendrait jusqu'à PostgreSQL, qui
 * refuserait le transtypage — et l'API rendrait 500. Ce serait sûr, mais bavard :
 * un 500 dit « votre saisie a voyagé », là où un 404 ne dit rien. La forme se
 * vérifie donc ici, avant la base.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Sa miniature aussi : une petite photo de la pièce reste la pièce.
  await rm(cheminDeLaMiniature(tenantId, pieceId), { force: true });
}

/**
 * La miniature vit à côté de la pièce, sous le même dossier de tenant, et son
 * nom se dérive du même identifiant lu en base. Voir `miniature.ts`.
 */
function cheminDeLaMiniature(tenantId: string, pieceId: string): string {
  return cheminAbsolu(tenantId, `${pieceId}.miniature.jpg`);
}

/**
 * Le constat « pas de miniature », gardé à la place de la miniature. Il porte
 * sa version : jusqu'au 29 octobre 2026, seul un PDF scanné avait sa page,
 * et un PDF de texte gardait ce constat sous la forme d'un fichier VIDE —
 * devenu faux depuis que toute page de PDF se rend. Un fichier vide se lit
 * donc comme périmé, et la miniature se refait à la demande suivante. Si ce
 * qui donne une miniature change encore, la version change avec lui.
 */
const SANS_MINIATURE = Buffer.from("malica:sans-miniature:2");

/**
 * Ce qui est gardé pour une pièce : sa miniature, le constat « pas de
 * miniature » (un `Buffer` vide), ou `null` — rien de gardé, ou un constat
 * périmé : elle est à faire.
 */
async function miniatureGardee(chemin: string): Promise<Buffer | null> {
  let garde: Buffer;
  try {
    garde = await readFile(chemin);
  } catch {
    return null;
  }
  if (garde.equals(SANS_MINIATURE)) return Buffer.alloc(0);
  // Une miniature est un JPEG (FF D8 FF) ; tout le reste est périmé.
  return garde[0] === 0xff && garde[1] === 0xd8 && garde[2] === 0xff ? garde : null;
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
 * Les pièces d'une impression : où sont leurs octets, et combien ils pèsent.
 *
 * Même `select`, même RLS que la route : une pièce que la base ne rend pas à
 * l'appelant n'est pas dans la réponse, et l'impression la refuse. Le chemin
 * se dérive de la ligne lue ; il sert à relire les octets APRÈS la
 * transaction, parce qu'une composition dure plus qu'elle ne doit rester
 * ouverte (`impression.ts`). Une pièce sans octets pèse zéro.
 */
export interface OriginalDUnePiece {
  chemin: string;
  octets: number;
  /** Le nombre de pages que la base en connaît ; une, à défaut. */
  pages: number;
}

export async function originauxDesPieces(
  db: Requete,
  pieces: readonly string[],
): Promise<Map<string, OriginalDUnePiece>> {
  const { rows } = await db.query<{ id: string; tenant_id: string; pages: number | null }>(
    `select id, tenant_id, page_count as pages from pieces_v where id = any($1::uuid[])`,
    [pieces.filter((id) => UUID.test(id))],
  );
  const originaux = new Map<string, OriginalDUnePiece>();
  for (const piece of rows) {
    const chemin = cheminAbsolu(piece.tenant_id, piece.id);
    const octets = await stat(chemin).then(
      (s) => s.size,
      () => 0,
    );
    // Sans nombre de pages connu (une photo, une pièce ancienne) : une page.
    originaux.set(piece.id, { chemin, octets, pages: Math.max(1, piece.pages ?? 1) });
  }
  return originaux;
}

/**
 * Quarante mégaoctets : vingt-quatre pages photographiées et emballées en PDF
 * tiennent dessous. Au-delà, ce n'est plus une pièce comptable — et sans
 * borne, un seul envoi remplirait le disque de tout le monde.
 */
const TAILLE_MAX_PIECE = 40 * 1024 * 1024;

export class PieceTropGrosse extends Error {}

/** Un passe-plat qui compte, et coupe le flux au-delà de la borne. */
export function borneDeTaille(max: number): Transform {
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
  noterLObjet({ tenant: piece.tenant_id, piece: piece.id });
  /*
   * L'étape `upload`, une fois par pièce et par trace : le renvoi des mêmes
   * octets après une reconnexion (même `x-malica-trace`) compte une
   * répétition. Ni les octets ni leur empreinte n'y entrent : leur taille, ce
   * que la base en a dit, et la pièce dont ils sont le doublon.
   */
  const debut = new Date();
  const etape = (issue: Issue, detail: Record<string, string | number | null>) =>
    consigner("upload", issue, {
      cle: `${piece.id}:upload`,
      piece: piece.id,
      debut,
      dureeMs: Date.now() - debut.getTime(),
      detail,
    });

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
    await pipeline(
      req,
      borneDeTaille(TAILLE_MAX_PIECE),
      signatureAttendue(piece.content_type),
      hache.flux,
      createWriteStream(provisoire),
    );
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
      etape("refus", { statut: "trop_grosse" });
      res.status(413).json({ erreur: "pièce trop volumineuse" });
      return;
    }
    // Des octets qui démentent le type de la pièce, ou un type hors liste :
    // rien n'est écrit, rien n'est scellé (audit S1).
    if (erreur instanceof TypeRefuse) {
      etape("refus", { statut: "type_refuse" });
      res.status(415).json({ erreur: "refus.piece.type_de_contenu" });
      return;
    }
    // Remplacée pendant que ses octets voyageaient : ils arrivent trop tard.
    // Ce n'est ni « déjà scellée » (409, que la file tient pour arrivée), ni
    // une panne : la pièce n'en veut plus, et la file n'en demande pas la
    // lecture.
    if ((erreur as { message?: string }).message === "refus.piece.remplacee") {
      etape("refus", { statut: "remplacee" });
      res.status(410).json({ erreur: "refus.piece.remplacee" });
      return;
    }
    if ((erreur as { code?: string }).code === "23514") {
      etape("refus", { statut: "deja_scellee" });
      res.status(409).json({ erreur: "le contenu de cette pièce est scellé" });
      return;
    }
    etape("erreur", { statut: "panne" });
    throw erreur;
  }

  const { size } = await stat(destination);
  etape("ok", {
    statut: "scellee",
    octets: size,
    type_contenu: piece.content_type ?? null,
    doublon_de: scelle.doublonDe,
  });
  res.status(201).json({
    pieceId: piece.id,
    octets: size,
    sha256: scelle.sha256,
    doublonDe: scelle.doublonDe,
  });
}

/**
 * Rend les octets d'une pièce, avec le type que porte la base — s'il est de
 * la liste fermée. Une ligne ancienne d'un autre type (d'avant l'audit S1) se
 * rend en `application/octet-stream` : jamais comme une page ni une image
 * vectorielle.
 */
export async function servirContenu(req: Request, res: Response): Promise<void> {
  const piece = await pieceAutorisee(req, req.params["id"]);
  if (!piece) {
    res.status(404).json({ erreur: "pièce introuvable" });
    return;
  }

  const type = typeAdmis(piece.content_type) ? piece.content_type : null;
  await envoyerLesOctets(res, cheminAbsolu(piece.tenant_id, piece.id), type, null);
}

/**
 * Envoie un fichier du stockage — une pièce, ou un export gardé : le même
 * geste, les mêmes en-têtes, un seul endroit.
 */
async function envoyerLesOctets(
  res: Response,
  source: string,
  type: string | null,
  nomDeFichier: string | null,
): Promise<void> {
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

  enTetesDuContenu(res, type, taille, nomDeFichier);
  await pipeline(createReadStream(source), res);
}

/**
 * Les en-têtes de tout contenu servi — une pièce, un export, un PDF
 * d'impression composé à la demande : un seul endroit les pose.
 */
export function enTetesDuContenu(
  res: Response,
  type: string | null,
  taille: number,
  nomDeFichier: string | null,
): void {
  // Le type vient de la base, jamais de l'extension ni du contenu. Absent, on
  // l'avoue au lieu de deviner.
  res.setHeader("Content-Type", type ?? TYPE_INCONNU);
  res.setHeader("Content-Length", String(taille));
  // Les pièces ne sont pas publiques : aucun cache partagé ne doit les garder.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    nomDeFichier
      ? `attachment; filename*=UTF-8''${encodeURIComponent(nomDeFichier)}`
      : "attachment",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", CSP_DU_CONTENU);
}

/* ================================================== LES EXPORTS DU JOURNAL, GARDÉS
 *
 * Spec §4 : « chaque export est numéroté et gardé ». Le journal des exports
 * (`collab.exports`) dit le numéro et l'empreinte ; les octets vivent ici, sous
 * le dossier du cabinet (`<racine>/<cabinet>/exports/<export>`), et se relisent
 * sous la même règle que les pièces : la ligne, demandée à la base sous
 * l'identité de l'appelant — la RLS du journal des exports décide, rien d'autre.
 */

function cheminDUnExport(cabinetId: string, exportId: string): string {
  return cheminAbsolu(cabinetId, path.join("exports", exportId));
}

/**
 * Garde les octets d'un export que la base vient de numéroter. Appelé dans la
 * transaction qui le numérote : si l'écriture échoue, la transaction tombe et
 * le numéro n'est pas consommé.
 */
export async function garderUnExport(
  cabinetId: string,
  exportId: string,
  octets: string | Uint8Array,
): Promise<void> {
  const destination = cheminDUnExport(cabinetId, exportId);
  await mkdir(path.dirname(destination), { recursive: true });
  const provisoire = `${destination}.${randomUUID()}.partiel`;
  try {
    await writeFile(provisoire, octets);
    await rename(provisoire, destination);
  } catch (erreur) {
    await rm(provisoire, { force: true });
    throw erreur;
  }
}

interface LigneExport {
  id: string;
  tenant_id: string;
  nom_de_fichier: string;
  type_mime: string;
}

async function ligneDUnExport(db: Requete, exportId: string): Promise<LigneExport | null> {
  if (!UUID.test(exportId)) return null;
  const { rows } = await db.query<LigneExport>(
    `select id, tenant_id, nom_de_fichier, type_mime from exports_v
      where id = $1 and numero is not null and nom_de_fichier is not null`,
    [exportId],
  );
  return rows[0] ?? null;
}

/** Les octets d'un export gardé, sous l'identité de l'appelant ; `null` : absent ou interdit. */
export async function lireUnExport(
  db: Requete,
  exportId: string,
): Promise<{ octets: Uint8Array; nomDeFichier: string; typeMime: string } | null> {
  const ligne = await ligneDUnExport(db, exportId);
  if (!ligne) return null;
  try {
    const octets = await readFile(cheminDUnExport(ligne.tenant_id, ligne.id));
    return {
      octets: new Uint8Array(octets),
      nomDeFichier: ligne.nom_de_fichier,
      typeMime: ligne.type_mime,
    };
  } catch {
    return null;
  }
}

/** Rend un export gardé, en pièce jointe, sous son nom. */
export async function servirUnExport(req: Request, res: Response): Promise<void> {
  const exportId = req.params["id"] ?? "";
  const ligne = await sousLAppelant(req, (db) => ligneDUnExport(db, exportId));
  if (!ligne) {
    res.status(404).json({ erreur: "export introuvable" });
    return;
  }
  await envoyerLesOctets(
    res,
    cheminDUnExport(ligne.tenant_id, ligne.id),
    ligne.type_mime,
    ligne.nom_de_fichier,
  );
}

/**
 * Combien de miniatures se fabriquent EN MÊME TEMPS, au plus. Décoder une
 * photo de 50 mégapixels prend environ 200 Mo et plusieurs centaines de
 * millisecondes de processeur : une liste de cent pièces jamais vues, ouverte
 * d'un coup, ne doit pas mettre l'API à genoux. Réglable par l'environnement
 * (`MINIATURES_SIMULTANEES`), comme `AUTH_ESSAIS_PAR_MINUTE` ; vide : 2.
 */
function simultaneesPermises(): number {
  const n = Number(process.env["MINIATURES_SIMULTANEES"] || 2);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

let enFabrication = 0;
const enAttente: (() => void)[] = [];

/** Un sémaphore minimal : la tâche attend son tour, puis rend le sien. */
async function aSonTour<T>(tache: () => Promise<T>): Promise<T> {
  if (enFabrication >= simultaneesPermises()) {
    await new Promise<void>((suivant) => enAttente.push(suivant));
  }
  enFabrication += 1;
  try {
    return await tache();
  } finally {
    enFabrication -= 1;
    enAttente.shift()?.();
  }
}

/**
 * Une fabrication par pièce, partagée : vingt demandes simultanées de la même
 * miniature (une liste ouverte deux fois, deux onglets) attendent la même
 * promesse au lieu de décoder vingt fois la même photo.
 */
const fabrications = new Map<string, Promise<Buffer | "absent" | "passager">>();

/**
 * La lecture d'une source, dans un objet : une épreuve la compte
 * (`mock.method`) pour vérifier combien de photos entières sont tenues en
 * mémoire à la fois.
 */
export const disque = { lire: (chemin: string) => readFile(chemin) };

class ContenuAbsent extends Error {}

const existe = (chemin: string) =>
  stat(chemin).then(
    () => true,
    () => false,
  );

/**
 * Fabrique, garde et rend la miniature d'une pièce.
 *
 *   — `Buffer` (vide : « pas de miniature », par nature, gardé comme
 *     `SANS_MINIATURE`) ;
 *   — `"absent"` : la pièce n'a pas d'octets, ou ils ont été effacés pendant
 *     la fabrication ;
 *   — `"passager"` : la fabrication a échoué. RIEN n'est gardé : la demande
 *     suivante réessaiera, une panne d'un instant ne devient pas une absence
 *     définitive.
 */
async function fabriquerEtGarder(
  tenantId: string,
  pieceId: string,
): Promise<Buffer | "absent" | "passager"> {
  const source = cheminAbsolu(tenantId, pieceId);
  const miniature = cheminDeLaMiniature(tenantId, pieceId);
  try {
    /*
     * La source se lit DANS le tour de fabrication, jamais avant : lue avant
     * d'attendre, chaque demande en file tenait sa photo entière en mémoire
     * (relu par Codex, PR #128 : vingt demandes, deux décodeurs, vingt
     * sources tenues). Le sémaphore borne ainsi la mémoire, pas seulement le
     * processeur.
     */
    const octets = await aSonTour(async () => {
      let octetsSource: Buffer;
      try {
        octetsSource = await disque.lire(source);
      } catch {
        throw new ContenuAbsent();
      }
      try {
        return (await fabrique.miniature(new Uint8Array(octetsSource))) ?? Buffer.alloc(0);
      } catch (cause) {
        // Au journal, jamais au client : l'écran sait seulement qu'il peut réessayer.
        console.error("[miniature]", pieceId, cause);
        return "passager" as const;
      }
    });
    if (octets === "passager") return "passager";
    // Écrite à côté puis renommée, comme une pièce : aucune demande ne lit un
    // fichier à moitié écrit.
    const provisoire = `${miniature}.${randomUUID()}.partiel`;
    try {
      await writeFile(provisoire, octets.length > 0 ? octets : SANS_MINIATURE);
      await rename(provisoire, miniature);
    } finally {
      await rm(provisoire, { force: true });
    }
    // La pièce a pu être supprimée PENDANT la fabrication : `effacerContenu` a
    // alors effacé une miniature qui n'existait pas encore, et celle-ci lui
    // survivrait. Elle part avec la pièce.
    if (!(await existe(source))) {
      await rm(miniature, { force: true });
      throw new ContenuAbsent();
    }
    return octets;
  } catch (erreur) {
    if (erreur instanceof ContenuAbsent) return "absent";
    throw erreur;
  }
}

/**
 * Rend la miniature d'une pièce : même `select`, même RLS, mêmes 404 que
 * `servirContenu` — une miniature montre la pièce, elle n'est pas moins
 * protégée qu'elle.
 *
 * Faite à la première demande, puis gardée (les octets d'une pièce sont
 * scellés). Un contenu qui n'en donne pas PAR NATURE (un PDF chiffré, un
 * format refusé) se garde aussi, comme constat (`SANS_MINIATURE`), et se rend
 * en 204 : sans cela, chaque ouverture de liste relirait le PDF pour rien. Un échec
 * passager se rend en 503 (`miniature.indisponible`), rien n'est gardé, et
 * l'écran réessaie.
 */
export async function servirMiniature(req: Request, res: Response): Promise<void> {
  const piece = await pieceAutorisee(req, req.params["id"]);
  if (!piece) {
    res.status(404).json({ erreur: "pièce introuvable" });
    return;
  }

  let resultat: Buffer | "absent" | "passager" | null = await miniatureGardee(
    cheminDeLaMiniature(piece.tenant_id, piece.id),
  );
  if (!resultat) {
    const cle = `${piece.tenant_id}/${piece.id}`;
    let enCours = fabrications.get(cle);
    if (!enCours) {
      enCours = fabriquerEtGarder(piece.tenant_id, piece.id).finally(() =>
        fabrications.delete(cle),
      );
      fabrications.set(cle, enCours);
    }
    resultat = await enCours;
  }

  if (resultat === "absent") {
    res.status(404).json({ erreur: "contenu absent" });
    return;
  }
  // Le cache reste celui de l'application, en mémoire : un cache HTTP du
  // navigateur ne distingue pas deux comptes sur le même appareil, et rendrait
  // la miniature à quiconque redemande l'URL après une déconnexion.
  res.setHeader("Cache-Control", "private, no-store");
  // Passager : un code À PART, que l'écran réessaie. 204 ne dit plus que
  // « ce document n'a pas de miniature », et l'écran le garde.
  if (resultat === "passager") {
    res.setHeader("Retry-After", "2");
    res.status(503).json({ erreur: "miniature.indisponible" });
    return;
  }
  if (resultat.length === 0) {
    res.status(204).end();
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(resultat.length));
  res.end(resultat);
}
