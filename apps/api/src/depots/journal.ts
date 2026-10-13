/**
 * Le journal des pannes survenues sur l'appareil de quelqu'un.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. Le dirigeant appuie sur « Générer le reçu », et « il ne se
 * passe rien ». La base ne contient aucun reçu, son dossier porte bien son
 * matricule : l'échec est réel, et antérieur au dépôt.
 *
 * La raison existait, et elle a été perdue deux fois — le message s'affichait
 * à deux cent vingt pixels sous le bouton, donc hors écran, et le journal qui
 * l'aurait gardée ne tourne qu'en développement.
 *
 * La seule façon de savoir ce qui avait échoué était alors de demander une
 * photo de l'écran. Ce n'est pas un diagnostic, c'est une devinette à deux.
 *
 * ======================================================= CE QUE CE DÉPÔT N'EST PAS
 *
 * Ce n'est pas `audit.event_log`, qui inscrit des faits MÉTIER relus par les
 * écrans et par les contrôles. Une pile d'appels JavaScript n'est pas
 * l'histoire d'un dossier, et son volume noierait celle-ci.
 *
 * Et ce n'est pas une mesure d'usage : rien n'est consigné qu'une panne. On
 * n'y verse aucune charge utile, aucune valeur de pièce — l'endroit du code,
 * le message, la pile, la version et la plateforme, et c'est tout.
 */
import type { Requete } from "../db.ts";

export const journal = {
  /**
   * Inscrire une panne. Rend l'identifiant de la trace.
   *
   * La fonction du Socle tronque plutôt que de refuser : signaler une panne
   * ne doit pas en créer une seconde. Le seul refus possible est celui de la
   * RLS — on n'écrit pas dans le dossier d'un autre.
   */
  async consigner(
    db: Requete,
    input: {
      tenantId: string;
      ou: string;
      message: string;
      pile?: string | null;
      version?: string | null;
      plateforme?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.journal_client_consigner($1, $2, $3, $4, $5, $6) as id`,
      [
        input.tenantId,
        input.ou,
        input.message,
        input.pile ?? null,
        input.version ?? null,
        input.plateforme ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /**
   * Les dernières pannes d'un dossier, de la plus récente.
   *
   * Lue par l'écran de réglages du dirigeant : une trace que personne ne peut
   * relire depuis le produit retomberait dans le défaut qu'elle corrige — il
   * faudrait un accès à la base pour savoir ce qui a échoué.
   */
  async dernieres(db: Requete, tenantId: string, limite = 50) {
    const { rows } = await db.query(
      `select id, ou, message, version, plateforme, at
         from journal_client_v
        where tenant_id = $1
        order by at desc
        limit $2`,
      [tenantId, Math.min(Math.max(limite, 1), 200)],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      ou: r["ou"] as string,
      message: r["message"] as string,
      version: (r["version"] as string | null) ?? null,
      plateforme: (r["plateforme"] as string | null) ?? null,
      at: (r["at"] as Date).toISOString(),
    }));
  },
};
