import type { DossierComptable } from "@malica/socle/ports/repositories";

/** Un ZIP en mémoire doit avoir une borne, y compris lorsque le serveur omet sa taille. */
const MAX_OCTETS = 100 * 1024 * 1024;

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

export async function construireArchiveComptable(
  dossier: DossierComptable,
  charger: (id: string) => Promise<Response>,
  progression: (n: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const fichiers: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
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
  const uniques = [...new Map(dossier.documents.map((d) => [d.id, d])).values()];
  if (!uniques.length) throw new Error("cab.biblio.missing");
  let taille = 0;
  for (const [i, d] of uniques.entries()) {
    signal?.throwIfAborted();
    const r = await charger(d.id);
    if (!r.ok) throw new Error("cab.biblio.missing");
    const annonce = Number(r.headers.get("content-length"));
    if (Number.isFinite(annonce) && taille + annonce > MAX_OCTETS)
      throw new Error("cab.biblio.tooLarge");
    // Lire par morceaux pour arrêter AVANT de matérialiser un fichier surdimensionné.
    if (!r.body) throw new Error("cab.biblio.missing");
    const lecteur = r.body.getReader();
    const morceaux: Uint8Array[] = [];
    let taillePiece = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await lecteur.read();
        if (done) break;
        taille += value.length;
        taillePiece += value.length;
        if (taille > MAX_OCTETS) throw new Error("cab.biblio.tooLarge");
        morceaux.push(value);
      }
    } catch (e) {
      await lecteur.cancel().catch(() => undefined);
      throw e;
    } finally {
      lecteur.releaseLock();
    }
    if (taillePiece === 0) throw new Error("cab.biblio.missing");
    const octets = new Uint8Array(taillePiece);
    let offset = 0;
    for (const m of morceaux) {
      octets.set(m, offset);
      offset += m.length;
    }
    const nom = `Originaux/${nomSur(d.reference ?? d.type ?? "document")}_${d.id}.${extensionDuContenu(r.headers.get("content-type") ?? "")}`;
    fichiers[nom] = octets;
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", octets)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    index.push([
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
      sha,
    ]);
    progression(i + 1, uniques.length);
  }
  signal?.throwIfAborted();
  fichiers["Index.csv"] = enc.encode(csv(index));
  fichiers["Ecritures.csv"] = enc.encode(
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
  fichiers["Dossier.json"] = enc.encode(
    JSON.stringify({ genereLe: new Date().toISOString(), ...dossier, documents: uniques }, null, 2),
  );
  fichiers["Controles.csv"] = enc.encode(
    csv([
      ["piece_id", "analyse_id", "analyse_a_jour", "controle", "statut", "motif"],
      ...(dossier.controles ?? []).flatMap((a) =>
        a.controles.map((c) => [a.pieceId, a.analyseId, a.aJour, c.code, c.statut, c.motif]),
      ),
    ]),
  );
  const { zip } = await import("fflate");
  return new Promise((resolve, reject) => {
    const terminer = zip(fichiers, { level: 0 }, (erreur, resultat) => {
      signal?.removeEventListener("abort", annuler);
      if (signal?.aborted) reject(signal.reason);
      else if (erreur) reject(erreur);
      else resolve(resultat);
    });
    function annuler() {
      terminer();
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", annuler, { once: true });
    if (signal?.aborted) annuler();
  });
}
