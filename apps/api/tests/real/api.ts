/**
 * Le client d'API des épreuves réelles.
 *
 * Ces scripts s'exécutent avec une vraie session utilisateur — c'était vrai
 * avec Supabase, ça le reste : la RLS s'applique, l'audit porte un auteur.
 * Seul le chemin change.
 *
 * Le fichier de session disparaît au passage. Il portait un `access_token`
 * Supabase qu'il fallait aller chercher dans un navigateur, coller dans un
 * fichier, et qui expirait entre deux passes. On ouvre désormais la session ici,
 * avec des identifiants d'environnement : une variable de moins à transporter,
 * et un jeton qui ne traîne pas sur le disque.
 *
 *   MALICA_API_URL=http://localhost:3000
 *   MALICA_EMAIL=...
 *   MALICA_MOTDEPASSE=...
 */

export interface ClientApi {
  rpc<T>(depot: string, methode: string, args?: unknown[]): Promise<T>;
  deposer(pieceId: string, octets: Uint8Array, type: string): Promise<void>;
}

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} requis`);
  return valeur;
}

export async function ouvrirSession(): Promise<ClientApi> {
  const base = (process.env["MALICA_API_URL"] ?? "http://localhost:3000").replace(/\/+$/, "");
  const email = exiger("MALICA_EMAIL");
  const motDePasse = exiger("MALICA_MOTDEPASSE");

  const connexion = await fetch(`${base}/auth/connexion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, motDePasse }),
  });
  if (!connexion.ok) {
    throw new Error(`connexion refusée (${connexion.status}) — vérifiez MALICA_EMAIL`);
  }
  const { jeton } = (await connexion.json()) as { jeton: string };
  const entetes = { Authorization: `Bearer ${jeton}` };

  return {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const reponse = await fetch(`${base}/rpc`, {
        method: "POST",
        headers: { ...entetes, "Content-Type": "application/json" },
        body: JSON.stringify({ depot, methode, args }),
      });
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new Error(`${depot}.${methode} : ${corps?.erreur ?? reponse.status}`);
      }
      const { resultat } = (await reponse.json()) as { resultat: T };
      return resultat;
    },

    async deposer(pieceId: string, octets: Uint8Array, type: string): Promise<void> {
      // Un Blob plutôt que le tableau brut : le typage de `fetch` ne connaît pas
      // Uint8Array comme corps, et l'enrobage ne copie pas les octets.
      const corps = new Blob([octets as BlobPart], { type });
      const reponse = await fetch(`${base}/pieces/${pieceId}/contenu`, {
        method: "POST",
        headers: { ...entetes, "Content-Type": type },
        body: corps,
      });
      if (!reponse.ok) throw new Error(`dépôt de ${pieceId} : ${reponse.status}`);
    },
  };
}
