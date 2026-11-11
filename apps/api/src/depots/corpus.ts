/**
 * Le corpus juridique — la recherche par empreinte.
 *
 * ====================================================== CE QUE CE DÉPÔT REND
 *
 * Des fragments de texte de loi, chacun avec ce qui permet de LE PESER :
 * quel article, quelle édition, depuis quand elle vaut, où elle a été publiée,
 * quelle autorité elle a, qui elle oblige, et si elle tient encore debout.
 *
 * Citer un article sans dire s'il oblige le contribuable ou seulement
 * l'administration, c'est citer à moitié. Une note commune de la DGELF
 * n'oblige ni le contribuable ni le juge — art. 54 LFC 2012 — et une réponse
 * qui l'ignore expose celui qui la suit.
 *
 * ================================================= POURQUOI PAS DE RLS ICI
 *
 * `legal.chunks` et `legal.articles` portent une politique `using (true)` pour
 * le rôle `authenticated` : le droit tunisien n'appartient à personne. Il n'y a
 * donc rien à cloisonner, et aucun `tenant_id` ne traverse ce fichier.
 *
 * ============================================== POURQUOI L'EMPREINTE ARRIVE
 * ============================================== TOUTE FAITE
 *
 * La question est encodée côté web, là où vit la clé du fournisseur, et arrive
 * ici en vecteur. Ce dépôt ne parle à aucun service extérieur : il interroge
 * la base, et c'est tout.
 *
 * Le modèle qui encode la question DOIT être celui qui a encodé le corpus.
 * Encoder avec un autre ne donne pas un résultat dégradé : il donne un
 * résultat dans un espace vectoriel différent, donc dénué de sens. Le nom du
 * modèle en vigueur se lit dans `agents.model_pricing` — R8, jamais en dur.
 */

import type { Requete } from "../db.ts";
import { enDate } from "./dates.ts";

/** Le rôle qui désigne le modèle d'empreinte, dans la table des tarifs. */
const ROLE_EMPREINTE = "embedding";

export interface FragmentTrouve {
  corpus: string;
  numero: string;
  validFrom: string | null;
  validTo: string | null;
  ordinal: number;
  langue: string;
  extrait: string;
  statut: string;
  abrogePar: string | null;
  nature: string | null;
  autorite: string | null;
  opposableA: string | null;
  jortReference: string | null;
  provenance: string;
  distance: number;
}

/**
 * Un passage du corpus, tel que le conseil cité le remet à Claude : le texte
 * ENTIER du fragment (pas un extrait de 320 caractères), son en-tête, et de
 * quoi le peser. Une seule version par article, celle en vigueur au jour dit.
 */
export interface PassageTrouve {
  corpus: string;
  numero: string;
  validFrom: string | null;
  validTo: string | null;
  ordinal: number;
  langue: string;
  texte: string;
  entete: string | null;
  statut: string;
  abrogePar: string | null;
  nature: string | null;
  autorite: string | null;
  opposableA: string | null;
  jortReference: string | null;
  provenance: string;
  distance: number;
  /** Trouvé aussi par les mots de la question (index lexical). */
  parLesMots: boolean;
  /**
   * L'ordre de lecture de ce texte, lu en base (`legal.sources`, ou celui du
   * corpus quand c'est un code consolidé) : le plus petit se lit d'abord.
   * Absent sur une ligne d'avant la colonne : le texte se range en dernier.
   */
  ordreDeLecture?: number | null;
  /** Le score de fusion des deux classements (RRF). */
  score: number;
  /**
   * Aucune version de cet article n'est en vigueur au jour demandé : le
   * corpus en connaît une avant et une après. `validFrom`/`validTo` sont
   * alors ceux de la dernière version connue, `reprise` le début de la
   * suivante. Un tel passage ne se remet JAMAIS au modèle.
   */
  lacune: boolean;
  reprise: string | null;
}

/**
 * La constante de la fusion par rangs réciproques. 60 est la valeur de
 * l'article qui l'a introduite (Cormack et al., 2009) : elle aplatit l'écart
 * entre les premiers rangs, pour qu'aucun des deux classements n'écrase
 * l'autre. Un réglage de recherche, pas une règle fiscale : R4 ne s'y applique
 * pas.
 */
const RRF_K = 60;
/** Combien de candidats chaque classement verse à la fusion. */
const CANDIDATS_PAR_CLASSEMENT = 60;

/** pg rend une date SQL comme un Date à minuit LOCALE : `toISOString` la
 *  ramènerait en UTC et afficherait la veille. On la rend telle qu'elle est. */

export const corpus = {
  /**
   * Le modèle d'empreinte en vigueur aujourd'hui.
   *
   * Le web le demande AVANT d'encoder : c'est ce qui garantit que la question
   * et le corpus vivent dans le même espace.
   */
  async modeleEmpreinte(db: Requete): Promise<{ model: string; dimensions: number }> {
    const { rows } = await db.query<{ model: string }>(
      `select model from agents.model_pricing
        where role = $1 and effective_from <= current_date
          and (effective_to is null or effective_to > current_date)
        order by effective_from desc limit 1`,
      [ROLE_EMPREINTE],
    );
    const modele = rows[0]?.model;
    if (!modele) throw new Error("corpus.aucun_modele_empreinte_en_vigueur");

    // La dimension se lit sur la colonne, pas sur une constante : le jour où
    // le corpus est réencodé, elle suit sans qu'on y pense.
    const { rows: dims } = await db.query<{ dimensions: number }>(
      `select a.atttypmod as dimensions
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'legal' and c.relname = 'chunks' and a.attname = 'embedding'`,
    );
    const dimensions = dims[0]?.dimensions;
    if (!dimensions || dimensions < 1) throw new Error("corpus.dimension_illisible");
    return { model: modele, dimensions };
  },

  /**
   * Les paramètres fiscaux qui se rapportent à cette question.
   *
   * ================================================= POURQUOI PAS TOUS
   *
   * Il y en a 454, tous en vigueur, et cent kilo-octets de texte. Les
   * transmettre à chaque question quadruplerait le coût et noierait la
   * question sous le référentiel. Il faut choisir, et le choix doit être
   * MÉCANIQUE — un paramètre écarté par erreur, c'est un chiffre que Malica
   * n'a pas et qu'elle ira chercher dans le texte de loi, au risque de le lire
   * de travers.
   *
   * ================================================= DEUX FILETS, PAS UN
   *
   * Le premier tient à ceci : un paramètre CITE son article. La recherche
   * vectorielle vient justement de rapporter des articles. On prend donc les
   * paramètres accrochés aux textes qu'elle a sous les yeux — le chiffre et
   * l'article arrivent ensemble, et ils ne peuvent pas se contredire.
   *
   * Le second rattrape ce que le premier laisse : une question dont aucun
   * article n'est remonté peut quand même viser un paramètre par son nom.
   * « timbre », « acompte », « retenue » suffisent à le retrouver.
   *
   * =============================================================== LA DATE
   *
   * On rend le paramètre en vigueur À LA DATE DEMANDÉE, pas aujourd'hui. Un
   * taux de 2026 ne répond pas sur un exercice 2023, et la contrainte
   * d'exclusion en base garantit qu'il n'y en a jamais deux pour une période.
   */
  async parametresPour(
    db: Requete,
    input: {
      jurisdiction: string;
      /** Les articles remontés par la recherche. */
      articles?: Array<{ corpus: string; numero: string }>;
      /** Les mots de la question, déjà réduits aux plus significatifs. */
      mots?: string[];
      jour?: string | null;
      nb?: number;
    },
  ) {
    const articles = input.articles ?? [];
    const mots = (input.mots ?? []).filter((m) => m.length >= 2).slice(0, 12);
    const nb = Math.min(Math.max(input.nb ?? 25, 1), 60);

    const { rows } = await db.query<Record<string, unknown>>(
      `with vise as (
         select p.*,
                -- Un paramètre accroché à un article transmis passe devant :
                -- c'est le lien le plus sûr entre un chiffre et son fondement.
                -- Sa place est celle de son article dans la liste remise : le
                -- chiffre du texte qui répond le mieux vient d'abord.
                (select min(a.place)
                   from unnest($2::text[], $3::text[]) with ordinality as a(corpus, numero, place)
                  where a.corpus = any(string_to_array(p.corpus, '/'))
                    and p.article ~* ('(^|[^0-9])' || regexp_replace(a.numero, '\\s+', '\\\\s+', 'g') || '($|[^0-9])')
                ) as place
           from ref.fiscal_parameters p
          where p.jurisdiction = $1
            and p.valid_from <= coalesce($4::date, current_date)
            and (p.valid_to is null or p.valid_to > coalesce($4::date, current_date))
       ),
       /*
        * LE POIDS D'UN MOT : l'inverse du nombre de paramètres qu'il touche.
        * « taux » en touche des dizaines et ne désigne rien ; « honoraires » ou
        * « timbre » en touchent une poignée et désignent le sujet. Sans ce
        * poids, la coupe tombait dans l'ordre alphabétique des codes : le
        * 11 novembre 2026, « retenue sur les honoraires d'un avocat » rendait
        * vingt-cinq taux sans rapport et laissait dehors celui de l'article 52.
        */
       touche as (
         select v.code, m.mot
           from vise v
           join unnest($5::text[]) as m(mot)
             -- Un sigle (« tva », « is ») ne vaut que comme segment entier du
             -- code : « is » se trouve au milieu de la moitié des libellés.
             on case when length(m.mot) < 4
                     then lower(m.mot) = any(string_to_array(lower(v.code), '_'))
                     else v.code ilike '%' || m.mot || '%' or v.libelle ilike '%' || m.mot || '%'
                end
       ),
       poids as (
         select t.code, sum(1.0 / f.n) as poids
           from touche t
           join (select mot, count(*) as n from touche group by mot) f on f.mot = t.mot
          group by t.code
       )
       select vise.code, libelle, forme, echelle, valeur_brute, corpus, article, citation,
              autorite, confiance, valid_from, valid_to, note
         from vise
         left join poids on poids.code = vise.code
        where place is not null or poids.poids is not null
        order by place nulls last, poids.poids desc nulls last, vise.code
        limit $6`,
      [
        input.jurisdiction,
        articles.map((a) => a.corpus),
        articles.map((a) => a.numero),
        input.jour ?? null,
        mots,
        nb,
      ],
    );

    return rows.map((r) => ({
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      forme: r["forme"] as string,
      echelle: r["echelle"] as string,
      valeur: r["valeur_brute"] as string,
      corpus: r["corpus"] as string,
      article: (r["article"] as string | null) ?? null,
      citation: (r["citation"] as string | null) ?? null,
      autorite: r["autorite"] as string,
      confiance: r["confiance"] as string,
      validFrom: enDate(r["valid_from"]),
      validTo: enDate(r["valid_to"]),
      note: (r["note"] as string | null) ?? null,
    }));
  },

  /**
   * Existe-t-il, pour ces articles, une édition plus récente que celle qu'on
   * a transmise — dans une AUTRE LANGUE ?
   *
   * ============================================================== LE DÉFAUT
   *
   * La recherche rend un fragment par article, le plus proche de la question.
   * Une question posée en français ramène donc le texte français. Or les
   * éditions alternent : le code de la TVA a ses trois dernières éditions
   * françaises jusqu'en 2023, puis deux arabes, 2025 et 2026.
   *
   * Malica reçoit alors le français de 2023, constate qu'il a expiré, et
   * conclut qu'elle ne connaît pas le droit en vigueur — alors que l'arabe de
   * 2026 dit la même chose et fait foi. Mesuré : 304 articles, sur trois
   * codes, n'ont AUCUNE édition française en cours.
   *
   * Ce contrôle ne corrige pas la recherche : il dit ce qu'elle a laissé de
   * côté, pour que la réponse le mentionne au lieu de renvoyer le client
   * chercher le texte lui-même.
   */
  async editionsPlusRecentes(
    db: Requete,
    articles: Array<{ corpus: string; numero: string; validFrom: string | null }>,
  ): Promise<Array<{ corpus: string; numero: string; validFrom: string; langue: string }>> {
    if (!Array.isArray(articles) || articles.length === 0) return [];

    const { rows } = await db.query<Record<string, unknown>>(
      `select distinct on (a.corpus, a.numero)
              a.corpus, a.numero, v.valid_from, v.langue_faisant_foi as langue
         from unnest($1::text[], $2::text[], $3::date[]) as d(corpus, numero, depuis)
         join legal.articles a on a.corpus = d.corpus and a.numero = d.numero
         join legal.article_versions v on v.article_id = a.id
        where d.depuis is not null and v.valid_from > d.depuis
        order by a.corpus, a.numero, v.valid_from desc`,
      [
        articles.map((a) => a.corpus),
        articles.map((a) => a.numero),
        articles.map((a) => a.validFrom),
      ],
    );

    return rows.map((r) => ({
      corpus: r["corpus"] as string,
      numero: r["numero"] as string,
      validFrom: enDate(r["valid_from"]) ?? "",
      langue: r["langue"] as string,
    }));
  },

  /**
   * Les fragments les plus proches de la question.
   *
   * La requête est celle de `db/corpus/rechercher.mjs`, à l'identique : une
   * seule formulation de « ce que dit le droit », partagée par l'outil en
   * ligne de commande et par Malica. Deux formulations divergeraient.
   *
   *   `jour`        — l'état du droit à cette date. Une facture de mars 2025
   *                   se juge sur l'article en vigueur en mars 2025, pas sur
   *                   celui d'aujourd'hui.
   *   `historique`  — ajoute les lois de finances aux codes consolidés.
   *   `doctrine`    — ajoute les notes communes. Elles ne sont PAS de
   *                   l'histoire : c'est ce que le fisc dit aujourd'hui du
   *                   texte en vigueur. D'où leur propre commutateur.
   */
  async rechercher(
    db: Requete,
    input: {
      vecteur: number[];
      nb?: number;
      jour?: string | null;
      historique?: boolean;
      doctrine?: boolean;
    },
  ): Promise<FragmentTrouve[]> {
    const vecteur = input.vecteur;
    if (!Array.isArray(vecteur) || vecteur.length === 0) {
      throw new Error("corpus.empreinte_absente");
    }
    if (vecteur.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error("corpus.empreinte_invalide");
    }
    const nb = Math.min(Math.max(input.nb ?? 6, 1), 20);

    const { rows } = await db.query<Record<string, unknown>>(
      /*
       * UNE SEULE VERSION PAR ARTICLE, ET ELLE EST EN VIGUEUR.
       *
       * Ce bloc rendait auparavant une version PAR LANGUE, et ne filtrait pas
       * du tout quand aucune date n'était demandée. Le 4 octobre 2026, la
       * première question réelle — « le taux de TVA en 2026 » — a reçu
       * l'article 7 du Code de la TVA dans sa version close le 1er janvier
       * 2025 : les éditions 2025 et 2026 n'ayant été ingérées qu'en arabe, la
       * dernière version FRANÇAISE s'arrêtait en 2024, et une question posée
       * en français la faisait gagner.
       *
       * L'arabe fait foi. On ne choisit donc plus par langue : on choisit la
       * version en vigueur à la date demandée — aujourd'hui par défaut — et
       * l'on rend le texte tel qu'il existe, fût-il arabe. Malica répond dans
       * la langue de la personne et dit que sa traduction n'est pas officielle.
       *
       * Un conseil fondé sur un article abrogé est pire qu'un silence.
       */
      `with derniere as (
         select distinct on (v.article_id)
                v.id, v.article_id, v.valid_from, v.valid_to,
                v.jort_reference, v.extraction_confiance
           from legal.article_versions v
          where v.valid_from <= coalesce($4::date, current_date)
            and (v.valid_to is null or v.valid_to > coalesce($4::date, current_date))
          order by v.article_id, v.valid_from desc nulls last,
                   v.version_num desc
       ),
       proches as (
         select distinct on (d.article_id)
                d.article_id, a.corpus, a.numero, d.valid_from, d.valid_to,
                a.statut, a.abroge_par, s.libelle as nature, s.autorite,
                array_to_string(s.opposable_a, ', ') as opposable_a,
                d.jort_reference, d.extraction_confiance,
                c.ordinal, c.langue, left(c.texte, 320) as extrait,
                /*
                 * Ce corpus DIT-IL le droit en vigueur ?
                 *
                 * La marque vit en base, sur le corpus. Avant, on demandait
                 * « est-ce un code consolidé ? » — ce qui excluait les 43
                 * conventions fiscales, pourtant en vigueur et supérieures à
                 * la loi. Un paiement transfrontalier recevait alors une
                 * réponse de droit interne seul : exacte au regard du code,
                 * et fausse pour le client.
                 *
                 * Un corpus pas encore nommé retombe sur l'ancien test :
                 * l'ingestion en ajoute, et aucun ne doit disparaître entre
                 * son arrivée et son nommage.
                 */
                coalesce(
                  n.porte_le_droit,
                  exists (select 1 from legal.ingestion_queue q
                           where q.corpus = a.corpus
                             and q.type_document = 'CODE_CONSOLIDE')
                ) as consolide,
                coalesce(s.autorite, 'normative') = 'interpretative' as est_doctrine,
                c.embedding operator(extensions.<=>) $1::extensions.vector as distance
           from legal.chunks c
           join derniere d on d.id = c.article_version_id
           join legal.articles a on a.id = d.article_id
           left join legal.sources s on s.code = a.source_code
           left join legal.corpus_noms n on n.code = a.corpus
          where c.embedding is not null
          order by d.article_id, distance
       )
       select corpus, numero, valid_from, valid_to, ordinal, langue, extrait,
              statut, abroge_par, nature, autorite, opposable_a, jort_reference,
              extraction_confiance, round(distance::numeric, 4) as distance
         from proches
        where (consolide and not est_doctrine)
           or ($5 and est_doctrine)
           or ($3 and not consolide and not est_doctrine)
        /*
         * LE CODE AVANT LA DOCTRINE, TOUJOURS.
         *
         * Ce classement ne préférait le texte consolidé que lorsqu'une date
         * était demandée ; sans date, seule la distance décidait. Le
         * 4 octobre 2026, « le taux de TVA en 2026 » a donc rendu ONZE notes
         * communes avant l'article 7 du Code de la TVA — qui arrivait
         * douzième et tombait hors du filet de six.
         *
         * Une note commune dit ce que l'administration pense du texte ; le
         * code dit le texte. Quand les deux répondent, c'est le texte qui
         * passe devant — et la note le suit, à sa place.
         */
        order by (not consolide)::int, distance limit $2`,
      [
        `[${vecteur.join(",")}]`,
        nb,
        input.historique ?? false,
        input.jour ?? null,
        input.doctrine ?? false,
      ],
    );

    return rows.map((r) => ({
      corpus: r["corpus"] as string,
      numero: r["numero"] as string,
      validFrom: enDate(r["valid_from"]),
      validTo: enDate(r["valid_to"]),
      ordinal: Number(r["ordinal"]),
      langue: r["langue"] as string,
      extrait: r["extrait"] as string,
      statut: r["statut"] as string,
      abrogePar: (r["abroge_par"] as string | null) ?? null,
      nature: (r["nature"] as string | null) ?? null,
      autorite: (r["autorite"] as string | null) ?? null,
      opposableA: (r["opposable_a"] as string | null) || null,
      jortReference: (r["jort_reference"] as string | null) ?? null,
      provenance: r["extraction_confiance"] as string,
      distance: Number(r["distance"]),
    }));
  },

  /**
   * La recherche HYBRIDE du conseil cité : les vecteurs ET les mots.
   *
   * ====================================================== POURQUOI LES DEUX
   *
   * Le vecteur saisit le sens (« ce que je retiens sur un loyer » trouve la
   * retenue à la source sur les loyers) ; il dilue les signaux exacts — un
   * numéro d'article, « acompte provisionnel », « 51 ter ». L'index lexical
   * (`legal.chunks.recherche`, en-tête en poids A) fait l'inverse. On fusionne
   * les deux classements par rangs réciproques (RRF) : aucun score à
   * calibrer, seuls les rangs comptent.
   *
   * ====================================================== CE QUI NE CHANGE PAS
   *
   * La règle du temps : UNE version par article, celle en vigueur au jour
   * demandé. Deux versions d'un même article ne peuvent jamais arriver
   * ensemble — c'est la base qui le garantit, pas la consigne.
   *
   * Le seuil : un passage trouvé par le seul vecteur doit être à moins de
   * `distanceMax` ; un passage trouvé AUSSI par les mots garde sa place
   * jusqu'à `distanceMaxMots`. Au-delà, il parle d'autre chose, et il n'entre
   * pas — un article réel cité à l'appui d'une réponse fausse la rendrait
   * crédible.
   *
   * Les lois de finances et la doctrine entrent : la date fait le tri. Le
   * texte consolidé passe devant à score voisin, par un léger avantage.
   */
  async rechercherHybride(
    db: Requete,
    input: {
      vecteur: number[];
      /** Les mots de la question, déjà réduits (voir `motsDeRecherche`). */
      mots: string[];
      jour: string;
      nb: number;
      distanceMax: number;
      distanceMaxMots: number;
      /** Les numéros d'article que la personne a écrits (« article 52 »). */
      numeros?: string[];
    },
  ): Promise<PassageTrouve[]> {
    const vecteur = input.vecteur;
    if (!Array.isArray(vecteur) || vecteur.length === 0) {
      throw new Error("corpus.empreinte_absente");
    }
    if (vecteur.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error("corpus.empreinte_invalide");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.jour ?? "")) throw new Error("corpus.jour_invalide");
    const nb = Math.min(Math.max(Math.trunc(input.nb ?? 8), 1), 20);
    const mots = (Array.isArray(input.mots) ? input.mots : [])
      .filter((m) => typeof m === "string" && m.trim().length > 0)
      .map((m) => m.replace(/["'():&|!<>*]/g, " ").trim())
      .filter((m) => m.length > 0)
      .slice(0, 16);
    // « a or b or c » : websearch_to_tsquery sait l'union, et une question
    // entière ne contient jamais TOUS ses mots dans un même fragment.
    const requeteMots = mots.join(" or ");
    const numeros = (Array.isArray(input.numeros) ? input.numeros : [])
      .filter((n) => typeof n === "string" && n.trim().length > 0)
      .slice(0, 8);

    const { rows } = await db.query<Record<string, unknown>>(
      `with derniere as (
         select distinct on (v.article_id)
                v.id, v.article_id, v.valid_from, v.valid_to,
                v.jort_reference, v.extraction_confiance, false as lacune,
                null::date as reprise
           from legal.article_versions v
          where v.valid_from <= $3::date
            and (v.valid_to is null or v.valid_to > $3::date)
          order by v.article_id, v.valid_from desc nulls last, v.version_num desc
       ),
       /*
        * LES LACUNES : un article qui a une version AVANT le jour et une
        * APRÈS, mais aucune qui le couvre. Le corpus ne sait pas ce qu'il
        * disait ce jour-là. On garde sa dernière version connue — pour la
        * classer, jamais pour la remettre au modèle : si elle est ce qui
        * répond le mieux, la réponse est « pas de version en vigueur », et
        * c'est le code qui le dit (règle du temps).
        */
       lacunes as (
         select distinct on (v.article_id)
                v.id, v.article_id, v.valid_from, v.valid_to,
                v.jort_reference, v.extraction_confiance, true as lacune,
                (select min(s.valid_from) from legal.article_versions s
                  where s.article_id = v.article_id and s.valid_from > $3::date) as reprise
           from legal.article_versions v
          where v.valid_to is not null and v.valid_to <= $3::date
            and not exists (select 1 from derniere d where d.article_id = v.article_id)
            and exists (select 1 from legal.article_versions s
                         where s.article_id = v.article_id and s.valid_from > $3::date)
          order by v.article_id, v.valid_from desc, v.version_num desc
       ),
       versions as (select * from derniere union all select * from lacunes),
       candidats as (
         select c.id, c.article_version_id, d.article_id, a.corpus, a.numero, d.valid_from,
                d.valid_to, d.lacune, d.reprise,
                a.statut, a.abroge_par, s.libelle as nature, s.autorite,
                array_to_string(s.opposable_a, ', ') as opposable_a,
                d.jort_reference, d.extraction_confiance,
                c.ordinal, c.langue,
                coalesce(
                  n.porte_le_droit,
                  exists (select 1 from legal.ingestion_queue q
                           where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
                ) as consolide,
                -- L'ordre de lecture, en base : celui du corpus s'il en a un
                -- (un code consolidé), sinon celui de la nature du texte.
                coalesce(n.ordre_de_lecture, s.ordre_de_lecture) as ordre_de_lecture,
                -- Le numéro que la personne a écrit elle-même.
                a.numero = any($7::text[]) as ecrit,
                c.embedding operator(extensions.<=>) $1::extensions.vector as distance,
                case when $2 = '' then 0
                     else ts_rank_cd('{0.1, 0.2, 0.4, 1.0}', c.recherche,
                            websearch_to_tsquery(
                              case when c.langue = 'ar' then 'simple'::regconfig
                                   else 'french'::regconfig end, $2))
                end as rang_mots
           from legal.chunks c
           join versions d on d.id = c.article_version_id
           join legal.articles a on a.id = d.article_id
           left join legal.sources s on s.code = a.source_code
           left join legal.corpus_noms n on n.code = a.corpus
          where c.embedding is not null
       ),
       par_vecteur as (
         select id, row_number() over (order by distance) as rang
           from candidats order by distance limit ${CANDIDATS_PAR_CLASSEMENT}
       ),
       par_mots as (
         select id, row_number() over (order by rang_mots desc) as rang
           from candidats where rang_mots > 0
          order by rang_mots desc limit ${CANDIDATS_PAR_CLASSEMENT}
       ),
       /*
        * LE TROISIÈME CLASSEMENT : les textes qui se lisent d'abord. La
        * doctrine commente un sujet à la fois, la loi en règle vingt dans un
        * article : au vecteur comme aux mots, une note commune passe devant
        * l'article qu'elle commente. Le 11 novembre 2026, « la retenue sur
        * les honoraires » et « le timbre d'une facture » ne remontaient que
        * des notes communes, et le modèle répondait sans l'article du code.
        * On classe donc à part les passages du premier ordre de lecture
        * arrêté en base (le code consolidé), par distance, et ce classement
        * vote comme les deux autres. Aucun seuil n'est levé pour autant.
        */
       par_ordre as (
         select id, row_number() over (order by distance) as rang
           from candidats
          where ordre_de_lecture = (select min(ordre_de_lecture) from candidats)
          order by distance limit ${CANDIDATS_PAR_CLASSEMENT}
       ),
       fusion as (
         select k.*, pm.rang is not null as par_les_mots,
                coalesce(1.0 / (${RRF_K} + pv.rang), 0)
                  + coalesce(1.0 / (${RRF_K} + pm.rang), 0)
                  + coalesce(1.0 / (${RRF_K} + po.rang), 0)
                  + case when k.consolide then 0.002 else 0 end
                  -- Un numéro écrit par la personne départage à score voisin.
                  + case when k.ecrit then 0.01 else 0 end as score
           from candidats k
           left join par_vecteur pv on pv.id = k.id
           left join par_mots pm on pm.id = k.id
           left join par_ordre po on po.id = k.id
          where (pv.rang is not null or pm.rang is not null or po.rang is not null)
            and (k.distance <= $5
                 or ((pm.rang is not null or po.rang is not null or k.ecrit)
                     and k.distance <= $6))
       ),
       un_par_article as (
         select distinct on (article_id) *
           from fusion order by article_id, score desc, distance
       ),
       retenus as (
         select * from un_par_article order by score desc, distance limit $4
       )
       /*
        * LE TEXTE REMIS : le début de l'article (son fragment 1, qui porte
        * d'ordinaire la règle et sa date) et le voisinage du fragment trouvé.
        * Un seul fragment de 1 800 caractères coupait l'article : le
        * 8 novembre 2026, « l'article 110 de la loi de finances 2026 »
        * arrivait par un fragment de fin, sans la phrase « s'appliquent à
        * compter du 1er janvier 2026 ».
        */
       select r.corpus, r.numero, r.valid_from, r.valid_to, r.ordinal, r.langue,
              (select string_agg(x.texte, E'\n' order by x.ordinal)
                 from legal.chunks x
                where x.article_version_id = r.article_version_id
                  and (x.ordinal = 1 or x.ordinal between r.ordinal - 1 and r.ordinal + 1)
              ) as texte,
              (select x.entete from legal.chunks x where x.id = r.id) as entete,
              r.statut, r.abroge_par, r.nature, r.autorite, r.opposable_a, r.jort_reference,
              r.extraction_confiance, round(r.distance::numeric, 4) as distance,
              r.par_les_mots, round(r.score::numeric, 6) as score, r.lacune, r.reprise,
              r.ordre_de_lecture
         from retenus r
        order by r.score desc, r.distance`,
      [
        `[${vecteur.join(",")}]`,
        requeteMots,
        input.jour,
        nb,
        input.distanceMax,
        input.distanceMaxMots,
        numeros,
      ],
    );

    return rows.map((r) => ({
      corpus: r["corpus"] as string,
      numero: r["numero"] as string,
      validFrom: enDate(r["valid_from"]),
      validTo: enDate(r["valid_to"]),
      ordreDeLecture: r["ordre_de_lecture"] === null ? null : Number(r["ordre_de_lecture"]),
      ordinal: Number(r["ordinal"]),
      langue: r["langue"] as string,
      texte: r["texte"] as string,
      entete: (r["entete"] as string | null) ?? null,
      statut: r["statut"] as string,
      abrogePar: (r["abroge_par"] as string | null) ?? null,
      nature: (r["nature"] as string | null) ?? null,
      autorite: (r["autorite"] as string | null) ?? null,
      opposableA: (r["opposable_a"] as string | null) || null,
      jortReference: (r["jort_reference"] as string | null) ?? null,
      provenance: r["extraction_confiance"] as string,
      distance: Number(r["distance"]),
      parLesMots: Boolean(r["par_les_mots"]),
      score: Number(r["score"]),
      lacune: Boolean(r["lacune"]),
      reprise: enDate(r["reprise"]),
    }));
  },
};
