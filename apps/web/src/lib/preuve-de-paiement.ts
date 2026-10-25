/**
 * Photographier la preuve d'un règlement — un seul chemin, deux écrans.
 *
 * La feuille des règlements (`CommentCEstPaye`) la prend au paiement ou après ;
 * la fiche d'un justificatif la REPREND. Les deux passent par ici, pour que
 * la preuve naisse toujours de la même façon : même capture, même archive,
 * même chiffrement, et rattachée à sa facture.
 *
 * Elle passe par la FILE, comme toute pièce : hors ligne, la preuve attend
 * dans l'appareil et part au retour du réseau. Photographier un talon de
 * chèque dans un parking sans réseau est précisément le cas qui se présente.
 *
 * Son type, `justificatif_paiement`, porte `porte_ecriture = false` : un
 * document transmis au cabinet et comptabilisable une seconde fois est la
 * façon la plus simple de compter une charge deux fois.
 */
import { files } from "@/capabilities/files";
import { vidage } from "@/lib/hors-ligne";
import { ErreurReseau } from "@/lib/transport/erreurs";
import { office } from "@/verticals/malica-office/composition";
import type { Visibility } from "@malica/socle/ports/repositories";

/** L'identifiant de la nouvelle pièce, ou `null` si l'appareil a été refermé ou si elle attend le réseau. */
export async function photographierUnePreuve(p: {
  tenantId: string;
  entityId: string | null;
  /**
   * La preuve suit la facture : si celle-ci est partie au cabinet, le talon
   * part avec elle — « transmise au comptable avec la photo ».
   */
  vis: Visibility;
  /**
   * LA PREUVE SAIT DE QUELLE FACTURE ELLE VIENT.
   *
   * 13 octobre 2026 : le talon de chèque photographié apparaissait comme un
   * document flottant — dans la liste de la PME et chez le cabinet, sous
   * « pas encore classés », avec « Émetteur non trouvé ». Les deux étages de
   * la file font `?? null` : un oubli ne lève rien, la pièce naît orpheline.
   */
  sourcePieceId: string;
  /**
   * Remplacer une photo DÉTRUIT l'ancienne : on n'y va qu'avec la nouvelle
   * arrivée, octets compris. Sans dépôt confirmé dans le délai, la nouvelle
   * est abandonnée (file et pièce) et l'ancienne reste — `null`.
   */
  depotExige?: boolean;
}): Promise<string | null> {
  const [pris] = await files.takePhoto();
  if (!pris) return null;
  const cle = await vidage().deposer(
    {
      cle: files.newIdempotencyKey(),
      tenantId: p.tenantId,
      entityId: p.entityId,
      source: pris.source,
      vis: p.vis,
      contentType: pris.blob.type || "application/pdf",
      documentKind: "justificatif_paiement",
      sourcePieceId: p.sourcePieceId,
      nomFichier: pris.name,
    },
    pris.blob,
  );
  if (!p.depotExige) {
    const element = await vidage().attendre(cle, 8_000);
    return element?.pieceId ?? null;
  }
  const element = await vidage().attendre(cle, 30_000, "deposee");
  if (element && (element.etat === "deposee" || element.etat === "lecture_demandee"))
    return element.pieceId;
  // Un enregistrement encore en vol se laisse aboutir : sa pièce, si elle
  // naît, est supprimée ci-dessous plutôt que laissée vide sur le serveur.
  const pose =
    element && element.pieceId === null && element.etat === "a_envoyer"
      ? await vidage().attendre(cle, 30_000)
      : element;
  await vidage().abandonner(cle);
  if (pose?.pieceId)
    await office()
      .capture.supprimer(pose.pieceId)
      .catch(() => undefined);
  throw new ErreurReseau("hors_ligne");
}
