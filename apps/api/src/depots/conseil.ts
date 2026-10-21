/**
 * Le conseil — la file d'arbitrage du cabinet, et la veille du corpus.
 *
 * ================================================================ LE PRINCIPE
 *
 * Quand un client mandaté pose une question de droit, Malica compose une
 * réponse citée et mesure sa certitude. Au-dessus du seuil du cabinet elle
 * répond seule ; en dessous elle retient sa réponse et la remet à l'expert.
 * Ce dépôt garde ces remises et ce que le cabinet en fait. Il ne fait dire
 * rien à personne : l'appel au modèle vit dans `malica.ts`, où est la clé.
 *
 * ============================================================= L'ISOLATION
 *
 * Aucune méthode ne filtre par personne ni ne vérifie un mandat : la vue
 * `arbitrages_v` est `security_invoker`, et les deux gestes qui écrivent sont
 * des fonctions gardées en base. R6 — une politique oubliée refuse, un filtre
 * oublié ouvre.
 */

import type { Requete } from "../db.ts";
import { enDate } from "./dates.ts";

/** Un article sur lequel une réponse s'appuie, tel qu'il a été transmis. */
export interface SourceCitee {
  corpus: string;
  numero: string;
  validFrom: string | null;
  validTo: string | null;
  langue: string | null;
}

type StatutArbitrage = "en_attente" | "repondue" | "approuvee" | "corrigee" | "ecartee";
export type DecisionArbitrage = "approuvee" | "corrigee" | "ecartee";

export interface Arbitrage {
  id: string;
  tenantId: string;
  client: string | null;
  cabinetTenantId: string;
  conversationId: string | null;
  messageId: string | null;
  demandeur: string | null;
  question: string;
  reponseProposee: string;
  sources: SourceCitee[];
  certitude: number;
  doute: string | null;
  canal: string;
  theme: string | null;
  langue: string;
  statut: StatutArbitrage;
  reponseCabinet: string | null;
  articleCabinet: string | null;
  decideLe: string | null;
  createdAt: string;
}

/** Ce que Malica doit savoir d'un dossier avant de répondre à son client. */
export interface ContexteConseil {
  cabinetId: string | null;
  cabinetNom: string | null;
  /** Le seuil du cabinet mandaté (0..1), ou rien sans cabinet. */
  seuil: number | null;
  /** L'appelant est-il membre du dossier — donc le client, pas le cabinet ? */
  appelantMembre: boolean;
}

export interface StatistiquesConseil {
  totaux: {
    enAttente: number;
    repondues: number;
    approuvees: number;
    corrigees: number;
    ecartees: number;
    /** La date de la plus ancienne question encore en attente, ou rien. */
    plusAncienneEnAttente: string | null;
  };
  parClient: Array<{
    tenantId: string;
    client: string | null;
    questions: number;
    enAttente: number;
    repondues: number;
    approuvees: number;
    corrigees: number;
    ecartees: number;
    dernierSujet: string | null;
    derniereLe: string | null;
  }>;
  /** Les sujets qui reviennent, tels que le modèle les a nommés à la création. */
  sujets: Array<{ theme: string; questions: number }>;
}

/** Une édition du corpus : un ensemble d'articles entrés en vigueur le même jour. */
export interface EditionDuCorpus {
  corpus: string;
  nom: string | null;
  famille: string | null;
  validFrom: string;
  articles: number;
  modifiePar: string | null;
  jort: string | null;
  langue: string | null;
}

const PLAFOND_FILE = 200;
const PLAFOND_VEILLE = 40;

function sourcesDe(brut: unknown): SourceCitee[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      corpus: String(s["corpus"] ?? ""),
      numero: String(s["numero"] ?? ""),
      validFrom: (s["validFrom"] as string | null) ?? null,
      validTo: (s["validTo"] as string | null) ?? null,
      langue: (s["langue"] as string | null) ?? null,
    }))
    .filter((s) => s.corpus && s.numero);
}

function versArbitrage(r: Record<string, unknown>): Arbitrage {
  return {
    id: r["id"] as string,
    tenantId: r["tenant_id"] as string,
    client: (r["client"] as string | null) ?? null,
    cabinetTenantId: r["cabinet_tenant_id"] as string,
    conversationId: (r["conversation_id"] as string | null) ?? null,
    messageId: (r["message_id"] as string | null) ?? null,
    demandeur: (r["demandeur"] as string | null) ?? null,
    question: r["question"] as string,
    reponseProposee: r["reponse_proposee"] as string,
    sources: sourcesDe(r["sources"]),
    certitude: Number(r["certitude"]),
    doute: (r["doute"] as string | null) ?? null,
    canal: r["canal"] as string,
    theme: (r["theme"] as string | null) ?? null,
    langue: r["langue"] as string,
    statut: r["statut"] as StatutArbitrage,
    reponseCabinet: (r["reponse_cabinet"] as string | null) ?? null,
    articleCabinet: (r["article_cabinet"] as string | null) ?? null,
    decideLe: r["decide_le"] ? String(r["decide_le"]) : null,
    createdAt: String(r["created_at"]),
  };
}

const COLONNES = `id, tenant_id, client, cabinet_tenant_id, conversation_id, message_id, demandeur,
       question, reponse_proposee, sources, certitude, doute, canal, theme, langue, statut,
       reponse_cabinet, article_cabinet, decide_le, created_at`;

export const conseil = {
  /**
   * Avant un appel payant : la base dit si la dépense du mois le permet
   * (plafond de la tour, abaissé par celui de l'organisation — ANO-029).
   * Sinon elle refuse, et son refus sort en 400 lisible.
   */
  async exigerBudget(db: Requete, tenantId: string): Promise<{ depense: string; plafond: string }> {
    const { rows } = await db.query<{ r: { depense: string; plafond: string } }>(
      `select public.conseil_budget_exiger($1) as r`,
      [tenantId],
    );
    return rows[0]!.r;
  },

  /** La file du cabinet : ce qui attend d'abord, puis le reste, le plus récent en tête. */
  async file(db: Requete, cabinetTenantId: string, statut?: string | null): Promise<Arbitrage[]> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select ${COLONNES}
         from arbitrages_v
        where cabinet_tenant_id = $1
          and ($2::text is null or statut = $2)
        order by (statut = 'en_attente') desc, created_at desc
        limit $3`,
      [cabinetTenantId, statut ?? null, PLAFOND_FILE],
    );
    return rows.map(versArbitrage);
  },

  async lire(db: Requete, id: string): Promise<Arbitrage | null> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select ${COLONNES} from arbitrages_v where id = $1`,
      [id],
    );
    const r = rows[0];
    return r ? versArbitrage(r) : null;
  },

  /**
   * Le geste du cabinet. `message` est ce que le client lira dans son fil,
   * composé par l'appelant dans la langue du client ; absent, rien ne part.
   */
  async decider(
    db: Requete,
    id: string,
    decision: DecisionArbitrage,
    reponse?: string | null,
    article?: string | null,
    message?: string | null,
  ): Promise<Arbitrage> {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.arbitrage_decider($1, $2, $3, $4, $5) as r`,
      [id, decision, reponse ?? null, article ?? null, message ?? null],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("arbitrage.non_decide");
    return versArbitrage(r);
  },

  /** Ce que Malica doit savoir d'un dossier avant d'y répondre. */
  async contexte(db: Requete, pmeTenantId: string): Promise<ContexteConseil> {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.conseil_contexte($1) as r`,
      [pmeTenantId],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("conseil.contexte_illisible");
    return {
      cabinetId: (r["cabinetId"] as string | null) ?? null,
      cabinetNom: (r["cabinetNom"] as string | null) ?? null,
      seuil: r["seuil"] == null ? null : Number(r["seuil"]),
      appelantMembre: Boolean(r["appelantMembre"]),
    };
  },

  /**
   * Un arbitrage nouveau, posé après que le fil a rangé la question.
   *
   * `statut` dit ce que Malica a fait : `en_attente` si elle a retenu sa
   * réponse, `repondue` si elle l'a envoyée seule. Sans cabinet mandaté, la
   * base refuse — il n'y a personne à qui remettre.
   */
  async creer(
    db: Requete,
    input: {
      tenantId: string;
      conversationId: string;
      question: string;
      reponse: string;
      sources: SourceCitee[];
      certitude: number;
      doute: string | null;
      canal: string;
      theme: string | null;
      langue: string;
      statut: "en_attente" | "repondue";
    },
  ): Promise<{ id: string; cabinetId: string }> {
    const { rows } = await db.query<{ r: { id: string; cabinetId: string } }>(
      `select public.arbitrage_creer($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11) as r`,
      [
        input.tenantId,
        input.conversationId,
        input.question,
        input.reponse,
        JSON.stringify(input.sources),
        input.certitude,
        input.doute,
        input.canal,
        input.theme,
        input.langue,
        input.statut,
      ],
    );
    const r = rows[0]?.r;
    if (!r?.id) throw new Error("arbitrage.non_cree");
    return { id: r.id, cabinetId: r.cabinetId };
  },

  /** Les comptes du cabinet : par client, par sujet, et en tout. Rien n'est calculé ailleurs. */
  async statistiques(db: Requete, cabinetTenantId: string): Promise<StatistiquesConseil> {
    const { rows: totaux } = await db.query<Record<string, unknown>>(
      `select count(*) filter (where statut = 'en_attente') as en_attente,
              count(*) filter (where statut = 'repondue') as repondues,
              count(*) filter (where statut = 'approuvee') as approuvees,
              count(*) filter (where statut = 'corrigee') as corrigees,
              count(*) filter (where statut = 'ecartee') as ecartees,
              min(created_at) filter (where statut = 'en_attente') as plus_ancienne
         from arbitrages_v
        where cabinet_tenant_id = $1`,
      [cabinetTenantId],
    );
    const { rows: clients } = await db.query<Record<string, unknown>>(
      `select a.tenant_id, max(a.client) as client,
              count(*) as questions,
              count(*) filter (where a.statut = 'en_attente') as en_attente,
              count(*) filter (where a.statut = 'repondue') as repondues,
              count(*) filter (where a.statut = 'approuvee') as approuvees,
              count(*) filter (where a.statut = 'corrigee') as corrigees,
              count(*) filter (where a.statut = 'ecartee') as ecartees,
              (select d.theme from arbitrages_v d
                where d.tenant_id = a.tenant_id and d.cabinet_tenant_id = $1
                order by d.created_at desc limit 1) as dernier_sujet,
              max(a.created_at) as derniere_le
         from arbitrages_v a
        where a.cabinet_tenant_id = $1
        group by a.tenant_id
        order by questions desc, client`,
      [cabinetTenantId],
    );
    const { rows: sujets } = await db.query<Record<string, unknown>>(
      `select theme, count(*) as questions
         from arbitrages_v
        where cabinet_tenant_id = $1 and theme is not null
        group by theme
        order by questions desc, theme
        limit 8`,
      [cabinetTenantId],
    );
    const t = totaux[0] ?? {};
    return {
      totaux: {
        enAttente: Number(t["en_attente"] ?? 0),
        repondues: Number(t["repondues"] ?? 0),
        approuvees: Number(t["approuvees"] ?? 0),
        corrigees: Number(t["corrigees"] ?? 0),
        ecartees: Number(t["ecartees"] ?? 0),
        plusAncienneEnAttente: t["plus_ancienne"] ? String(t["plus_ancienne"]) : null,
      },
      parClient: clients.map((c) => ({
        tenantId: c["tenant_id"] as string,
        client: (c["client"] as string | null) ?? null,
        questions: Number(c["questions"]),
        enAttente: Number(c["en_attente"]),
        repondues: Number(c["repondues"]),
        approuvees: Number(c["approuvees"]),
        corrigees: Number(c["corrigees"]),
        ecartees: Number(c["ecartees"]),
        dernierSujet: (c["dernier_sujet"] as string | null) ?? null,
        derniereLe: c["derniere_le"] ? String(c["derniere_le"]) : null,
      })),
      sujets: sujets.map((s) => ({
        theme: s["theme"] as string,
        questions: Number(s["questions"]),
      })),
    };
  },

  /**
   * La veille du pack : les éditions du corpus, la plus récente en tête.
   *
   * Une édition est un ensemble d'articles d'un même corpus entrés en vigueur
   * le même jour — c'est ainsi qu'une loi de finances se voit : « 312 articles
   * du code de la TVA, depuis le 1er janvier ». Les éditions à venir sont
   * rendues aussi : le cabinet doit les voir arriver.
   */
  async veille(db: Requete, jurisdiction: string, limite?: number): Promise<EditionDuCorpus[]> {
    const nb = Math.min(Math.max(limite ?? 12, 1), PLAFOND_VEILLE);
    const { rows } = await db.query<Record<string, unknown>>(
      `select a.corpus, n.nom_fr as nom, n.famille, v.valid_from,
              count(*) as articles,
              (select m.modifie_par from legal.article_versions m
                 join legal.articles b on b.id = m.article_id
                where b.corpus = a.corpus and m.valid_from = v.valid_from and m.modifie_par is not null
                order by m.modifie_par limit 1) as modifie_par,
              min(v.jort_reference) as jort,
              min(v.langue_faisant_foi) as langue
         from legal.article_versions v
         join legal.articles a on a.id = v.article_id
         left join legal.corpus_noms n on n.code = a.corpus
        where a.jurisdiction = $1
        group by a.corpus, n.nom_fr, n.famille, v.valid_from
        order by v.valid_from desc, articles desc, a.corpus
        limit $2`,
      [jurisdiction, nb],
    );
    return rows.map((r) => ({
      corpus: r["corpus"] as string,
      nom: (r["nom"] as string | null) ?? null,
      famille: (r["famille"] as string | null) ?? null,
      validFrom: enDate(r["valid_from"]) ?? String(r["valid_from"]),
      articles: Number(r["articles"]),
      modifiePar: (r["modifie_par"] as string | null) ?? null,
      jort: (r["jort"] as string | null) ?? null,
      langue: (r["langue"] as string | null) ?? null,
    }));
  },

  /** Les noms des corpus, pour écrire « code de la TVA » et non « CTVA ». */
  async nomsDesCorpus(db: Requete, codes: string[]): Promise<Record<string, string>> {
    if (!Array.isArray(codes) || codes.length === 0) return {};
    const { rows } = await db.query<{ code: string; nom_fr: string | null }>(
      `select code, nom_fr from legal.corpus_noms where code = any($1::text[])`,
      [codes],
    );
    const noms: Record<string, string> = {};
    for (const r of rows) if (r.nom_fr) noms[r.code] = r.nom_fr;
    return noms;
  },
};
