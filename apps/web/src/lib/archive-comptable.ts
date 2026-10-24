import type { DossierComptable, DocumentComptable } from "@malica/socle/ports/repositories";
import type { Zip as ZipEnFlux, ZipPassThrough as FichierDuZip } from "fflate";

/*
 * ============================================ UN DOSSIER DE 2 000 PIÈCES
 *
 * La première forme lisait chaque original en entier, le copiait, en
 * recalculait l'empreinte, puis compressait le tout d'un bloc : tout le
 * dossier vivait plusieurs fois en mémoire, et un plafond de 100 Mo tenait
 * lieu de garde-fou. Un mois chargé le dépassait.
 *
 * Désormais l'archive se construit EN FLUX : chaque original passe dans le ZIP
 * par morceaux, et la sortie est versée dans un `Blob` par tranches, que le
 * navigateur peut garder hors du tas JavaScript. En mémoire vive ne restent
 * que les originaux en cours de chargement — `PARALLELISME` au plus.
 *
 * L'empreinte est celle SCELLÉE à la réception (`capture.pieces.sha256`),
 * relue par l'API : c'est elle qui prouve que l'original n'a pas changé
 * depuis, et la recalculer ici aurait exigé de tenir chaque fichier entier.
 */

/** Téléchargements simultanés : assez pour masquer la latence, assez peu pour la mémoire. */
const PARALLELISME = 4;

/** Taille d'une tranche versée dans le Blob de sortie. */
const TRANCHE = 8 * 1024 * 1024;

/**
 * La borne du FORMAT, pas un choix : sans ZIP64 — que l'écriture en flux de
 * `fflate` ne produit pas —, un décalage au-delà de 4 Gio rend l'archive
 * illisible. On s'arrête avant d'en remettre une corrompue.
 */
const LIMITE_ZIP = 0xffff_ffff;

export function extensionDuContenu(type: string): string {
  const types: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/tiff": "tiff",
    "text/plain": "txt",
  };
  return types[type.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}

function nomSur(texte: string): string {
  // Les noms viennent de pièces utilisateur ; les caractères de contrôle
  // n'ont aucune place dans un chemin de restitution.
  // eslint-disable-next-line no-control-regex
  const interdits = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;
  return (
    texte
      .normalize("NFKC")
      .replace(interdits, "-")
      .replace(/\.{2,}/g, "-")
      .trim()
      .slice(0, 100) || "document"
  );
}

/** Échapper les séparateurs ET les formules des tableurs provenant des pièces. */
function csv(lignes: unknown[][]): string {
  return (
    "\uFEFF" +
    lignes
      .map((l) =>
        l
          .map((v) => {
            let s = v == null ? "" : String(v);
            if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n") +
    "\r\n"
  );
}

/** Un original chargé : son contenu, prêt à être versé dans le ZIP. */
interface Original {
  contenu: Blob;
  type: string;
}

/** Charger un original, morceau par morceau, sans jamais le copier. */
async function chargerOriginal(reponse: Promise<Response>, signal: AbortSignal): Promise<Original> {
  const r = await reponse;
  if (!r.ok || !r.body) throw new Error("cab.biblio.missing");
  const lecteur = r.body.getReader();
  const morceaux: Uint8Array<ArrayBuffer>[] = [];
  let taille = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await lecteur.read();
      if (done) break;
      taille += value.length;
      morceaux.push(value as Uint8Array<ArrayBuffer>);
    }
  } catch (e) {
    await lecteur.cancel().catch(() => undefined);
    throw e;
  } finally {
    lecteur.releaseLock();
  }
  if (taille === 0) throw new Error("cab.biblio.missing");
  const type = r.headers.get("content-type") ?? "";
  return { contenu: new Blob(morceaux, { type }), type };
}

/** La sortie du ZIP, versée dans un Blob par tranches. */
class Sortie {
  private tranches: Blob[] = [];
  private enCours: Uint8Array<ArrayBuffer>[] = [];
  private tailleEnCours = 0;
  ecrit = 0;

  verser(morceau: Uint8Array) {
    this.ecrit += morceau.length;
    if (this.ecrit > LIMITE_ZIP) throw new Error("cab.biblio.tooLarge");
    this.enCours.push(morceau as Uint8Array<ArrayBuffer>);
    this.tailleEnCours += morceau.length;
    if (this.tailleEnCours >= TRANCHE) this.vider();
  }

  private vider() {
    if (!this.enCours.length) return;
    this.tranches.push(new Blob(this.enCours));
    this.enCours = [];
    this.tailleEnCours = 0;
  }

  blob(): Blob {
    this.vider();
    return new Blob(this.tranches, { type: "application/zip" });
  }
}

/**
 * Construire l'archive du dossier.
 *
 * `charger` reçoit le signal d'annulation : une pièce manquante arrête les
 * téléchargements encore en cours, et aucun dossier incomplet n'est remis.
 */
export async function construireArchiveComptable(
  dossier: DossierComptable,
  charger: (id: string, signal: AbortSignal) => Promise<Response>,
  progression: (n: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const uniques = [...new Map(dossier.documents.map((d) => [d.id, d])).values()];
  if (!uniques.length) throw new Error("cab.biblio.missing");
  signal?.throwIfAborted();

  // Un arrêt — de la personne, ou d'une pièce en échec — arrête tout.
  const arret = new AbortController();
  const relayer = () => arret.abort(signal?.reason);
  signal?.addEventListener("abort", relayer, { once: true });

  const { Zip, ZipPassThrough } = await import("fflate");
  const sortie = new Sortie();
  let erreurZip: unknown = null;
  let fin: () => void = () => undefined;
  const termine = new Promise<void>((resoudre) => (fin = resoudre));
  const zip: ZipEnFlux = new Zip((erreur, morceau, final) => {
    if (erreur) erreurZip ??= erreur;
    else {
      try {
        sortie.verser(morceau);
      } catch (e) {
        erreurZip ??= e;
      }
    }
    if (final || erreur) fin();
  });
  const verifier = () => {
    arret.signal.throwIfAborted();
    if (erreurZip) throw erreurZip;
  };
  const ajouterTexte = (nom: string, texte: string) => {
    const f = new ZipPassThrough(nom);
    zip.add(f);
    f.push(new TextEncoder().encode(texte), true);
    verifier();
  };

  // Les téléchargements partent par fenêtre de PARALLELISME ; l'écriture suit
  // l'ordre du dossier, pour que l'index et l'archive se lisent pareil.
  const chargements: Promise<Original>[] = [];
  let premiereErreur: unknown = null;
  const lancer = (i: number) => {
    const d = uniques[i];
    if (!d || chargements[i]) return;
    const p = chargerOriginal(charger(d.id, arret.signal), arret.signal);
    // La première pièce en échec arrête les autres, et c'est elle qu'on rapporte.
    p.catch((e: unknown) => {
      premiereErreur ??= e;
      arret.abort();
    });
    chargements[i] = p;
  };

  const index: unknown[][] = [
    [
      "id",
      "reference",
      "type",
      "tiers",
      "date_document",
      "recu_le",
      "montant",
      "devise",
      "statut",
      "source_piece_id",
      "fichier",
      "sha256",
    ],
  ];
  try {
    for (let i = 0; i < PARALLELISME; i++) lancer(i);
    for (const [i, d] of uniques.entries()) {
      const original = await chargements[i]!;
      verifier();
      const nom = `Originaux/${nomSur(d.reference ?? d.type ?? "document")}_${d.id}.${extensionDuContenu(original.type)}`;
      await verserOriginal(zip, new ZipPassThrough(nom), original.contenu, verifier);
      delete chargements[i];
      lancer(i + PARALLELISME);
      index.push(ligneDIndex(d, nom));
      progression(i + 1, uniques.length);
    }
    ajouterTexte("Index.csv", csv(index));
    ajouterTexte(
      "Ecritures.csv",
      csv([
        [
          "id",
          "piece_id",
          "paiement_id",
          "nature",
          "journal",
          "date",
          "libelle",
          "statut",
          "compte",
          "intitule_compte",
          "devise",
          "revue",
          "debit",
          "credit",
        ],
        ...dossier.ecritures.map((e) => [
          e.id,
          e.pieceId,
          e.paiementId,
          e.nature,
          e.journal,
          e.date,
          e.libelle,
          e.statut,
          e.compte,
          e.compteLibelle,
          e.devise,
          e.revue,
          e.debit,
          e.credit,
        ]),
      ]),
    );
    ajouterTexte(
      "Dossier.json",
      JSON.stringify(
        { genereLe: new Date().toISOString(), ...dossier, documents: uniques },
        null,
        2,
      ),
    );
    ajouterTexte(
      "Controles.csv",
      csv([
        ["piece_id", "analyse_id", "analyse_a_jour", "controle", "statut", "motif"],
        ...(dossier.controles ?? []).flatMap((a) =>
          a.controles.map((c) => [a.pieceId, a.analyseId, a.aJour, c.code, c.statut, c.motif]),
        ),
      ]),
    );
    zip.end();
    await termine;
    verifier();
    return sortie.blob();
  } catch (e) {
    arret.abort();
    zip.terminate();
    // L'annulation de la personne prime : c'est elle qu'on rapporte.
    if (signal?.aborted) throw signal.reason;
    throw premiereErreur ?? e;
  } finally {
    signal?.removeEventListener("abort", relayer);
  }
}

/** Verser un original dans le ZIP, par morceaux lus dans son Blob. */
async function verserOriginal(
  zip: ZipEnFlux,
  fichier: FichierDuZip,
  contenu: Blob,
  verifier: () => void,
): Promise<void> {
  zip.add(fichier);
  const lecteur = contenu.stream().getReader();
  try {
    while (true) {
      verifier();
      const { value, done } = await lecteur.read();
      if (done) break;
      fichier.push(value);
    }
    fichier.push(new Uint8Array(0), true);
    verifier();
  } finally {
    lecteur.releaseLock();
  }
}

function ligneDIndex(d: DocumentComptable, nom: string): unknown[] {
  return [
    d.id,
    d.reference,
    d.type,
    d.tiers,
    d.dateDocument,
    d.recuLe,
    d.montant,
    d.devise,
    d.status,
    d.sourcePieceId,
    nom,
    d.empreinte,
  ];
}
