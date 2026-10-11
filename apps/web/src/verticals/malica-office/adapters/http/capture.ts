/**
 * La capture, servie par l'API — le seul dépôt qui ne peut pas être un mandataire.
 *
 * Les neuf autres passent par `creerDepotHttp` sans une ligne à écrire. Celui-ci
 * a deux raisons de faire exception, et une seule ne suffirait pas.
 *
 * Il porte des octets. `enregistrer` ouvre la ligne par `/rpc`, puis dépose le
 * fichier sur `/pieces/:id/contenu`. L'ordre est imposé par le chemin, qui
 * contient l'identifiant : il n'existe qu'une fois la ligne écrite. Si le dépôt
 * échoue, la ligne reste sans octets — et la visionneuse le dira franchement,
 * plutôt que d'afficher un document vide. L'ancien adaptateur avait le défaut
 * symétrique, plus pénible : un fichier sans ligne, invisible et impossible à
 * retrouver.
 *
 * La lecture, elle, n'est plus ici : elle fait parler un modèle, et c'est
 * l'affaire de Malica — voir `malica.ts`, à côté.
 */

import type {
  CaptureRepository,
  Citation,
  Extraction,
  NewPiece,
  NouvellePiece,
  Piece,
  PieceDossier,
  PieceStatus,
  PieceLue,
  Token,
  PaiementDUnePiece,
} from "@malica/socle/ports/repositories";
import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";
import { appeler } from "./rpc";

/**
 * Le même appel que le mandataire générique, typé.
 *
 * Une première version recopiait ici le corps de `appeler` — deux fabriques
 * pour un seul protocole, dont la seconde aurait dérivé au premier changement
 * d'en-tête. Elle est réutilisée telle quelle ; seul le type de retour est
 * précisé, ce que le mandataire ne peut pas faire.
 */
async function rpc<T>(depot: string, methode: string, args: unknown[]): Promise<T> {
  return (await appeler(depot, methode, args)) as T;
}

function versPiece(p: Record<string, unknown>): Piece {
  return {
    id: p["id"] as string,
    tenantId: p["tenantId"] as string,
    entityId: (p["entityId"] as string | null) ?? null,
    status: p["status"] as PieceStatus,
    source: p["source"] as "photo" | "pdf",
    vis: p["vis"] as "personnel" | "partage",
    storagePath: p["storagePath"] as string,
    createdAt: p["createdAt"] as string,
    documentKind: (p["documentKind"] as string | null) ?? null,
    documentKindStatut:
      (p["documentKindStatut"] as Piece["documentKindStatut"] | undefined) ?? "a_determiner",
    // `null` = la question « cabinet ou espace privé » est encore ouverte.
    gardeeLe: (p["gardeeLe"] as string | null) ?? null,
  };
}

export function creerCaptureHttp(): CaptureRepository {
  return {
    // L'API rend déjà la forme du port : rien à transposer ici.
    async listAvecLecture(tenantId: string): Promise<PieceLue[]> {
      return rpc<PieceLue[]>("capture", "listAvecLecture", [tenantId]);
    },

    // Le paiement d'une pièce : l'API rend déjà la forme du port.
    async enregistrerPaiement(input: Parameters<CaptureRepository["enregistrerPaiement"]>[0]) {
      return rpc<string>("capture", "enregistrerPaiement", [input]);
    },

    async paiementsDUnePiece(pieceId: string) {
      return rpc<PaiementDUnePiece[]>("capture", "paiementsDUnePiece", [pieceId]);
    },

    async enregistrer(piece: NouvellePiece): Promise<string> {
      // Le type du fichier est écrit en base à l'enregistrement : c'est là
      // qu'on le connaît, et c'est de là qu'il sera relu.
      const { id } = await rpc<{ id: string; chemin: string }>("capture", "enregistrer", [piece]);
      return id;
    },

    async deposerOctets(pieceId: string, octets: Blob, contentType: string): Promise<void> {
      const depot = await transport().appeler(`/pieces/${pieceId}/contenu`, {
        method: "POST",
        headers: contentType ? { "Content-Type": contentType } : {},
        body: octets,
      });
      if (!depot.ok) {
        const corps = (await depot.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApi(corps?.erreur ?? "dépôt du fichier impossible", depot.status);
      }
    },

    async register(input: NewPiece): Promise<string> {
      const id = await this.enregistrer({
        tenantId: input.tenantId,
        entityId: input.entityId,
        source: input.source,
        vis: input.vis,
        idempotencyKey: input.idempotencyKey,
        contentType: input.file.type || null,
      });
      await this.deposerOctets(id, input.file, input.file.type);
      return id;
    },

    async list(tenantId: string): Promise<Piece[]> {
      const brut = await rpc<Record<string, unknown>[]>("capture", "lister", [tenantId]);
      return brut.map(versPiece);
    },

    async dossier(pieceId: string): Promise<PieceDossier> {
      const brut = await rpc<{
        piece: Record<string, unknown>;
        extraction: Extraction | null;
        precisions?: Record<string, string>;
        citations: Citation[];
        tokens: Token[];
      }>("capture", "dossier", [pieceId]);

      // Les octets viennent par leur propre route, avec la session : une URL
      // nue ne conviendrait pas — les pièces ne sont pas publiques, et un
      // `<img src>` vers une autre origine n'emporte ni cookie ni jeton.
      let contenu: ArrayBuffer | null = null;
      const reponse = await transport().appeler(`/pieces/${pieceId}/contenu`);
      if (reponse.ok) contenu = await reponse.arrayBuffer();

      return {
        piece: versPiece(brut.piece),
        contenu,
        extraction: brut.extraction,
        precisions: brut.precisions ?? {},
        citations: brut.citations,
        tokens: brut.tokens,
      };
    },

    async preciser(
      pieceId: string,
      champ: "document_kind",
      valeur: "facture_achat" | "facture_vente",
    ) {
      return (await appeler("capture", "preciser", [pieceId, champ, valeur])) as {
        id: string;
        champ: string;
        valeur: string;
      };
    },

    async supprimer(pieceId: string): Promise<boolean> {
      return (await appeler("capture", "supprimer", [pieceId])) as boolean;
    },
  };
}
