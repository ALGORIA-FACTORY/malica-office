/**
 * Les conversations avec Malica.
 *
 * ============================================================= L'ISOLATION
 *
 * Aucune méthode de ce fichier ne filtre par personne. Pas de `where
 * created_by = ...`, nulle part. C'est R6 : l'isolation est portée par la
 * base. Les politiques d'`agents.conversations` n'ouvrent la lecture qu'à
 * l'auteur, et encore faut-il qu'il ait toujours accès au dossier.
 *
 * Un filtre écrit ici serait au mieux redondant, au pire trompeur : le jour où
 * quelqu'un l'oublie sur une nouvelle méthode, rien ne se voit — alors qu'une
 * politique oubliée REFUSE. C'est la différence entre les deux, et c'est
 * pourquoi le filtre ne vit pas dans ce fichier.
 *
 * ====================================================== CE QUI N'EST PAS ICI
 *
 * L'appel au modèle. Ce dépôt garde ce qui a été dit ; il ne fait dire rien à
 * personne. Le raisonnement, l'invite et le corpus vivent côté web.
 */

import type { Requete } from "../db.ts";

export interface ConversationResume {
  id: string;
  titre: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
}

export interface MessageDuFil {
  id: string;
  role: "user" | "assistant";
  contenu: string;
  raisonnement: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  createdAt: string;
}

/** Le nombre de fils rendus à l'écran. Au-delà, on ne lit plus, on cherche. */
const PLAFOND_LISTE = 60;

export const conversations = {
  /** Les fils de cette personne sur ce dossier, le plus récent d'abord. */
  async lister(db: Requete, tenantId: string): Promise<ConversationResume[]> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select c.id, c.titre, c.created_at, c.updated_at,
              (select count(*) from agents.conversation_messages m
                where m.conversation_id = c.id) as messages
         from agents.conversations c
        where c.tenant_id = $1
        order by c.updated_at desc
        limit $2`,
      [tenantId, PLAFOND_LISTE],
    );
    return rows.map((r) => ({
      id: r["id"] as string,
      titre: r["titre"] as string,
      createdAt: String(r["created_at"]),
      updatedAt: String(r["updated_at"]),
      messages: Number(r["messages"]),
    }));
  },

  /** Le fil complet, dans l'ordre où il a été dit. */
  async ouvrir(db: Requete, conversationId: string): Promise<MessageDuFil[]> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select id, role, contenu, model, tokens_in, tokens_out,
              latency_ms, created_at
         from agents.conversation_messages
        where conversation_id = $1
        order by created_at, id`,
      [conversationId],
    );
    return rows.map((r) => ({
      id: r["id"] as string,
      role: r["role"] as "user" | "assistant",
      contenu: r["contenu"] as string,
      // Gardé au journal, jamais rendu au client (ANO-023, 21 octobre 2026).
      raisonnement: null,
      model: (r["model"] as string | null) ?? null,
      tokensIn: r["tokens_in"] === null ? null : Number(r["tokens_in"]),
      tokensOut: r["tokens_out"] === null ? null : Number(r["tokens_out"]),
      latencyMs: r["latency_ms"] === null ? null : Number(r["latency_ms"]),
      createdAt: String(r["created_at"]),
    }));
  },

  /** Un fil neuf, sans titre : Malica le nommera après le premier échange. */
  async ouvrirNouvelle(db: Requete, tenantId: string): Promise<{ id: string }> {
    const { rows } = await db.query<{ id: string }>(`select public.conversation_ouvrir($1) as id`, [
      tenantId,
    ]);
    return { id: rows[0]!.id };
  },

  /**
   * Une question du client, seule (21 octobre 2026, ANO-002).
   *
   * Le client écrit SES questions ; la réponse de Malica, elle, n'est écrite
   * que par le serveur (`ajouter`, réservée). Une question sans réponse est
   * un fil en attente — celui d'une question relue par le cabinet —, pas un
   * fil abîmé.
   */
  async poser(db: Requete, input: { conversationId: string; question: string }): Promise<void> {
    // La porte refuse une question vide et un fil qui n'est pas le sien.
    await db.query(`select public.conversation_poser($1, $2)`, [
      input.conversationId,
      input.question,
    ]);
  },

  /**
   * Un message au bout du fil.
   *
   * La question et la réponse arrivent ensemble : une question enregistrée
   * seule, si l'appel au modèle échoue ensuite, laisserait un fil qui pose une
   * question sans jamais y répondre.
   */
  async ajouter(
    db: Requete,
    input: {
      conversationId: string;
      question: string;
      reponse: string;
      raisonnement?: string | null;
      model?: string | null;
      tokensIn?: number | null;
      tokensOut?: number | null;
      latencyMs?: number | null;
    },
  ): Promise<void> {
    await db.query(`select public.conversation_repondre($1, $2, $3, $4, $5, $6, $7, $8)`, [
      input.conversationId,
      input.question,
      input.reponse,
      input.raisonnement ?? null,
      input.model ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.latencyMs ?? null,
    ]);
  },

  /**
   * Ce que les contrôles ont trouvé sur une réponse.
   *
   * Écrit après coup, sur le message déjà rangé : le contrôle ne retient pas
   * la réponse, il la juge. Une réponse qui n'a rien déclenché n'écrit aucune
   * ligne — l'absence EST le vert, et compter les lignes suffit à mesurer.
   */
  async journaliserControles(
    db: Requete,
    input: {
      tenantId: string;
      messageId: string | null;
      verdicts: Array<{ code: string; suite: string; detail: string }>;
    },
  ): Promise<void> {
    if (!Array.isArray(input.verdicts) || input.verdicts.length === 0) return;
    // La porte tronque le détail à 500 caractères.
    await db.query(
      `select public.conversation_controles_journaliser($1, $2, $3::text[], $4::text[], $5::text[])`,
      [
        input.tenantId,
        input.messageId,
        input.verdicts.map((v) => v.code),
        input.verdicts.map((v) => v.suite),
        input.verdicts.map((v) => v.detail),
      ],
    );
  },

  /** Le dernier message d'assistant d'un fil — celui qu'on vient d'écrire. */
  async dernierMessage(db: Requete, conversationId: string): Promise<{ id: string } | null> {
    const { rows } = await db.query<{ id: string }>(
      `select id from agents.conversation_messages
        where conversation_id = $1 and role = 'assistant'
        order by created_at desc, id desc limit 1`,
      [conversationId],
    );
    return rows[0] ?? null;
  },

  /**
   * Le geste du comptable : juste, ou faux.
   *
   * `attendu` est facultatif, et c'est pourtant lui qui compte : sans la
   * bonne réponse, un « faux » dit qu'il y a un problème sans dire lequel.
   */
  async juger(
    db: Requete,
    input: {
      tenantId: string;
      messageId: string;
      verdict: "juste" | "faux";
      attendu?: string | null;
    },
  ): Promise<void> {
    await db.query(`select public.conversation_juger($1, $2, $3, $4)`, [
      input.tenantId,
      input.messageId,
      input.verdict,
      input.attendu ?? null,
    ]);
  },

  /**
   * Le titre du fil.
   *
   * Sert à Malica pour le nommer, et à la personne pour le renommer : c'est
   * le même geste, et la base ne distingue pas les deux. La politique de mise
   * à jour n'ouvre le droit qu'à l'auteur, dans les deux cas.
   */
  async renommer(db: Requete, input: { conversationId: string; titre: string }): Promise<void> {
    // La porte coupe le titre à 120 caractères et refuse un titre vide.
    await db.query(`select public.conversation_renommer($1, $2)`, [
      input.conversationId,
      input.titre,
    ]);
  },

  /**
   * Effacer un fil, et ses messages avec lui.
   *
   * Ce que la suppression n'emporte PAS : `agents.agent_runs`, le journal des
   * appels — modèle, jetons, coût. Il ne porte aucun texte, et il reste.
   */
  async supprimer(db: Requete, conversationId: string): Promise<void> {
    await db.query(`select public.conversation_supprimer($1)`, [conversationId]);
  },
};
