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
 * Et il porte une lecture qui ne se fait pas ici. `read` appelle une fonction
 * serveur du web, parce que l'œil et le raisonneur ont besoin de clés qui ne
 * doivent jamais atteindre le navigateur.
 */

import { readPiece } from "@/lib/office-capture.functions";

import type {
  CaptureRepository,
  Citation,
  Extraction,
  NewPiece,
  Piece,
  PieceDossier,
  PieceStatus,
  Token,
} from "../../ports/repositories";
import { baseApi, ErreurApi } from "./rpc";

async function rpc<T>(depot: string, methode: string, args: unknown[]): Promise<T> {
  const reponse = await fetch(`${baseApi()}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ depot, methode, args }),
  });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
    throw new ErreurApi(corps?.erreur ?? `appel ${depot}.${methode} refusé`, reponse.status);
  }
  const { resultat } = (await reponse.json()) as { resultat: T };
  return resultat;
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
  };
}

export function creerCaptureHttp(): CaptureRepository {
  return {
    async register(input: NewPiece): Promise<string> {
      const { id } = await rpc<{ id: string; chemin: string }>("capture", "enregistrer", [
        {
          tenantId: input.tenantId,
          entityId: input.entityId,
          source: input.source,
          vis: input.vis,
          idempotencyKey: input.idempotencyKey,
          // Le type du fichier est écrit en base à l'enregistrement : c'est là
          // qu'on le connaît, et c'est de là qu'il sera relu.
          contentType: input.file.type || null,
        },
      ]);

      const depot = await fetch(`${baseApi()}/pieces/${id}/contenu`, {
        method: "POST",
        headers: input.file.type ? { "Content-Type": input.file.type } : {},
        credentials: "include",
        body: input.file,
      });
      if (!depot.ok) {
        throw new ErreurApi("dépôt du fichier impossible", depot.status);
      }
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
        citations: Citation[];
        tokens: Token[];
      }>("capture", "dossier", [pieceId]);

      // Les octets viennent par leur propre route, avec le cookie de session :
      // une URL nue ne conviendrait pas — les pièces ne sont pas publiques, et
      // un `<img src>` vers une autre origine n'emporte pas le cookie.
      let contenu: ArrayBuffer | null = null;
      const reponse = await fetch(`${baseApi()}/pieces/${pieceId}/contenu`, {
        credentials: "include",
      });
      if (reponse.ok) contenu = await reponse.arrayBuffer();

      return {
        piece: versPiece(brut.piece),
        contenu,
        extraction: brut.extraction,
        citations: brut.citations,
        tokens: brut.tokens,
      };
    },

    async read(pieceId: string) {
      const res = await readPiece({ data: { pieceId } });
      return { contract: res.contract, citations: res.citations, valid: res.valid };
    },
  };
}
