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
 *
 * ============================================ ET LES ÉTAPES DE L'APPAREIL
 *
 * `etapes` est l'autre porte de l'appareil, et elle ne va PAS ici dans
 * `audit.journal_client` : cette table est sous RLS du dossier, relue par
 * l'écran de réglages du dirigeant, sans déduplication — y verser chaque
 * capture la noierait, et montrerait au dirigeant ce qui n'est pas une panne.
 * Les étapes partent au journal d'observabilité (`observabilite/journal.ts`),
 * que seul l'exploitant lit, dédoublonnées par (trace, étape, clé).
 */
import { z } from "zod";

import type { Requete } from "../db.ts";
import { referentielDuJournal } from "../observabilite/gestes.ts";
import { consigner } from "../observabilite/journal.ts";
import { nouvelleTrace, traceCourante } from "../observabilite/trace.ts";

/** Un lot borné : cinquante étapes, des scalaires courts, ni photo ni texte. */
const LOT_MAX = 50;
const EtapeDeLAppareil = z.object({
  trace: z.string().uuid(),
  etape: z.string().regex(/^[a-z][a-z_]{1,39}$/),
  issue: z.enum(["ok", "refus", "erreur", "ignore"]),
  cle: z.string().regex(/^[\w.:|-]{1,100}$/),
  debut: z.string().datetime({ offset: true }),
  dureeMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 3600 * 1000)
    .nullish(),
  piece: z.string().uuid().nullish(),
  detail: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      z.union([z.string().max(64), z.number().finite(), z.boolean(), z.null()]),
    )
    .refine((d) => Object.keys(d).length <= 12)
    .default({}),
});

/** Une panne hors dossier : des textes courts, bornés avant même la porte. */
const PanneHorsDossier = z.object({
  ou: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(100),
  detail: z.string().max(500).nullish(),
  version: z.string().max(120).nullish(),
  plateforme: z.string().max(300).nullish(),
});

export const journal = {
  /**
   * Les étapes que l'appareil a vécues hors de toute requête : la capture, la
   * file hors ligne, la synchronisation, et ce que l'écran a AFFICHÉ.
   *
   * Ce que la porte garantit :
   *   - seules les étapes que la base dit émises par l'appareil passent
   *     (`observabilite.etapes.emise_par_l_appareil`) ; une étape `rpc` ou
   *     `validation` venue d'un téléphone est écartée ;
   *   - l'acteur est l'appelant, jamais ce que le lot prétend ; la trace d'un
   *     autre acteur ne reçoit rien (`observabilite.consigner` l'isole) ;
   *   - une pièce n'est nommée que si l'appelant la VOIT (sa RLS) : une pièce de
   *     l'espace privé d'un autre, ou d'un autre dossier, n'y entre pas ;
   *   - un élément mal formé est écarté et compté, jamais une exception : un
   *     lot rejoué après une reconnexion ne s'empoisonne pas.
   */
  async etapes(db: Requete, lot: unknown): Promise<{ acceptees: number; ecartees: number }> {
    if (!Array.isArray(lot) || lot.length > LOT_MAX) {
      throw Object.assign(new Error("refus.saisie.mal_formee"), { code: "22023" });
    }
    const { etapesDeLAppareil } = await referentielDuJournal();
    const valides = lot
      .map((brut) => EtapeDeLAppareil.safeParse(brut))
      .flatMap((r) =>
        r.success && etapesDeLAppareil.has(r.data.etape)
          ? [{ ...r.data, piece: r.data.piece?.toLowerCase() ?? null }]
          : [],
      );
    if (valides.length === 0) return { acceptees: 0, ecartees: lot.length };

    const { rows } = await db.query<{ moi: string | null }>("select auth.uid()::text as moi");
    const moi = rows[0]?.moi ?? null;
    const demandees = [...new Set(valides.flatMap((e) => (e.piece ? [e.piece] : [])))];
    const visibles = new Map(
      demandees.length === 0
        ? []
        : (
            await db.query<{ id: string; tenant_id: string }>(
              "select id::text, tenant_id::text from capture.pieces where id = any ($1::uuid[])",
              [demandees],
            )
          ).rows.map((p) => [p.id, p.tenant_id] as const),
    );

    // L'origine et la version sont celles que la requête a déclarées.
    const requete = traceCourante();
    const maintenant = Date.now();
    for (const e of valides) {
      const piece = e.piece && visibles.has(e.piece) ? e.piece : null;
      const debut = new Date(Math.min(Date.parse(e.debut), maintenant));
      const trace = {
        ...nouvelleTrace(requete?.origine ?? "api", {
          id: e.trace,
          version: requete?.version ?? null,
          acteur: moi,
          tenant: piece ? (visibles.get(piece) ?? null) : null,
        }),
        debut,
      };
      trace.piece = piece;
      consigner(
        e.etape,
        e.issue,
        {
          cle: e.cle,
          debut,
          ...(e.dureeMs == null ? {} : { dureeMs: e.dureeMs }),
          piece,
          detail: e.detail,
        },
        trace,
      );
    }
    return { acceptees: valides.length, ecartees: lot.length - valides.length };
  },

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
   * Inscrire une panne vue HORS de tout dossier : accepter une invitation,
   * ouvrir le dossier d'un client depuis le cabinet, la tour. Le journal des
   * pannes exige un dossier (sa RLS) ; celle-ci va à `app.signalements`,
   * origine `panne`, que seul l'opérateur relit
   * (`20261205093300_une_panne_sans_dossier_laisse_une_trace.sql`).
   *
   * Qui : la session, jamais la saisie. Le détail arrive expurgé par
   * l'appareil, et la porte le coupe quand même. Elle est bornée — vingt par
   * personne et par dix minutes — et rend `false` au-delà, sans lever :
   * signaler une panne ne doit pas en créer une seconde.
   */
  async consignerHorsDossier(db: Requete, saisie: unknown): Promise<{ inscrite: boolean }> {
    const s = PanneHorsDossier.parse(saisie);
    const { rows } = await db.query<{ inscrite: boolean }>(
      `select public.journal_hors_dossier_consigner($1, $2, $3, $4, $5) as inscrite`,
      [s.ou, s.code, s.detail ?? null, s.version ?? null, s.plateforme ?? null],
    );
    return { inscrite: rows[0]?.inscrite === true };
  },

  /**
   * Les dernières pannes d'un dossier, de la plus récente.
   *
   * Lue par l'écran de réglages du dirigeant : une trace que personne ne peut
   * relire depuis le produit retomberait dans le défaut qu'elle corrige — il
   * faudrait un accès à la base pour savoir ce qui a échoué.
   */
  async dernieres(db: Requete, tenantId: string, limite = 50) {
    // Après la dernière marque « tout est réglé » (`regler`) : ce qui précède
    // reste en base, l'écran ne le montre plus.
    const { rows } = await db.query(
      `select id, ou, message, version, plateforme, at
         from journal_client_v
        where tenant_id = $1
          and at > coalesce((select max(r.at) from journal_client_reglements_v r
                              where r.tenant_id = $1), '-infinity')
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

  /**
   * « Tout est réglé » : une marque datée, en ajout seul. Rien n'est effacé
   * (R7) ; `dernieres` ne rend plus que ce qui la suit.
   */
  async regler(db: Requete, tenantId: string): Promise<{ le: string }> {
    const { rows } = await db.query<{ le: Date }>(`select public.journal_client_regler($1) as le`, [
      tenantId,
    ]);
    return { le: rows[0]!.le.toISOString() };
  },
};
