/**
 * L'API, vue de l'intérieur — ce que Regalica appelle pour lire la base.
 *
 * ============================================================== POURQUOI
 *
 * Les modules de Regalica ont été écrits pour le serveur web, où ils
 * parlaient à l'API par HTTP sous l'identité de l'appelant. Ils reçoivent
 * donc une interface — `rpc`, `contenu` — et rien d'autre. Ici, cette
 * interface est réalisée en mémoire : le même registre de dépôts, la même
 * RLS, sans réseau.
 *
 * ================================================ UNE TRANSACTION PAR APPEL
 *
 * Chaque `rpc` ouvre sa propre transaction sous l'identité, et la referme
 * aussitôt. Ce n'est pas une facilité : une lecture dure des minutes, et une
 * connexion tenue pendant ce temps serait coupée par la base après dix
 * secondes d'inactivité — sans compter le pool qu'elle assécherait. Les
 * appels de modèle se font donc entre deux transactions, jamais dedans.
 *
 * ================================================== LE DÉTOUR PAR LE JSON
 *
 * Par HTTP, chaque résultat traversait `JSON.stringify` : les dates devenaient
 * des chaînes, les `undefined` disparaissaient. Les modules ont été éprouvés
 * sur ces formes-là. On les leur rend à l'identique, pour qu'un déplacement de
 * code ne change pas ce qu'ils lisent.
 */
import { sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";
import { lireContenu } from "../stockage.ts";

export interface AppelApi {
  /** Un appel de dépôt, sous l'identité de l'appelant. */
  rpc<T>(depot: string, methode: string, args?: unknown[]): Promise<T>;
  /** Les octets d'une pièce, et le type que porte la base. */
  contenu(pieceId: string): Promise<{ octets: Uint8Array; type: string }>;
}

export class PieceIntrouvable extends Error {}

export function creerAppelLocal(utilisateurId: string): AppelApi {
  return {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const resultat = await sousIdentite(utilisateurId, (db) =>
        executerRpc(db, { depot, methode, args }),
      );
      return (resultat === undefined ? undefined : JSON.parse(JSON.stringify(resultat))) as T;
    },

    async contenu(pieceId: string) {
      const contenu = await sousIdentite(utilisateurId, (db) => lireContenu(db, pieceId));
      if (!contenu) throw new PieceIntrouvable(`pièce introuvable : ${pieceId}`);
      return contenu;
    },
  };
}
