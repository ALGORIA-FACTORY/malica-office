/**
 * Le droit que Regalica a sous les yeux quand elle répond.
 *
 * ================================================================ LE PRINCIPE
 *
 * Regalica ne connaît pas le droit tunisien : elle le LIT. La question est
 * encodée, les fragments les plus proches sont rapportés du corpus, et c'est
 * sur eux — et rien d'autre — qu'elle s'appuie. Un modèle qui répond de
 * mémoire produit une réponse fluide, plausible, sans date, invérifiable, et
 * n'a aucun moyen de dire si elle est juste.
 *
 * ============================================== LE MÊME MODÈLE, OU RIEN
 *
 * La question DOIT être encodée par le modèle qui a encodé le corpus. Encoder
 * avec un autre ne donne pas un résultat dégradé : il donne un résultat dans
 * un espace vectoriel différent, donc dénué de sens — des voisins tirés au
 * hasard, présentés comme du droit. Le nom du modèle vient de la base (R8),
 * jamais d'ici, et la dimension de la colonne elle-même.
 *
 * ============================================================== L'ÉCHEC PARLE
 *
 * Si l'encodeur est injoignable, cette fonction ÉCHOUE. Elle ne rend pas un
 * tableau vide : un tableau vide se confondrait avec « le corpus ne dit rien
 * là-dessus », et Regalica répondrait « je ne trouve pas » alors que la vérité
 * est « je n'ai pas pu chercher ». Ces deux phrases n'engagent pas la même
 * chose, et la seconde n'est pas la faute du corpus.
 */

import type { AppelApi } from "@/lib/api.server";

/** Un fragment de texte de loi, avec ce qui permet de le peser. */
export interface FragmentDeDroit {
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
 * Le seuil au-delà duquel un fragment ne répond plus à la question.
 *
 * La distance cosinus va de 0 (identique) à 2 (opposé). Au-delà, les fragments
 * rapportés parlent d'autre chose : les garder donnerait à Regalica de quoi
 * bâtir une réponse sur du texte hors sujet, ce qui est pire que de n'avoir
 * rien — elle citerait un article RÉEL à l'appui d'une réponse fausse, et la
 * citation rendrait l'erreur crédible.
 *
 * ===================================================== MESURÉ, PAS DEVINÉ
 *
 * `db/corpus/etalonner.mjs`, sur 9 014 articles et 22 762 fragments :
 *
 *   questions qui doivent trouver   0,1246 → 0,3575
 *   questions hors sujet            0,3804 → 0,6841
 *
 * Les deux nuages se séparent, et 0,37 tombe entre les deux. La marge est
 * mince — 0,023 — et l'échantillon petit : rejouer l'étalonnage quand le
 * corpus grossit, et déplacer ce nombre si la frontière bouge.
 *
 * Le seuil précédent, 0,62, était une estimation. Elle laissait entrer « la
 * recette du couscous » (0,4871), « la météo à Sfax » (0,5321) et « la
 * Sécurité sociale belge » (0,4070). Voilà ce que coûte un nombre non mesuré.
 *
 * ============================================ CE QUE LE SEUIL NE PEUT PAS
 *
 * Une question sur le droit fiscal d'un AUTRE pays remonte des articles
 * tunisiens à courte distance — « TVA en France » et « TVA en Tunisie »
 * parlent de la même chose (mesuré : 0,3042). Aucun seuil ne l'écarte sans
 * faire taire les questions légitimes. Ce refus-là appartient à la consigne,
 * pas à ce nombre.
 *
 * Le seuil est ici, pas en base : ce n'est pas une règle fiscale mais un
 * réglage de recherche. R4 ne s'y applique pas.
 */
const DISTANCE_MAX = 0.37;

interface ModeleEmpreinte {
  model: string;
  dimensions: number;
}

/**
 * L'empreinte de la question, par le modèle que la base désigne.
 *
 * On passe par le mode compatible du fournisseur — le même point d'entrée que
 * `db/corpus/vectoriser.mjs` a employé pour encoder les 22 762 fragments.
 */
async function encoder(question: string, modele: ModeleEmpreinte): Promise<number[]> {
  const base = process.env["QWEN_BASE_URL"];
  const cle = process.env["QWEN_API_KEY"];
  if (!base || !cle) {
    throw new Error(
      "corpus : l'encodeur n'est pas configuré (QWEN_BASE_URL, QWEN_API_KEY) — " +
        "je ne peux pas chercher dans le droit",
    );
  }

  const reponse = await fetch(`${base.replace(/\/+$/, "")}/compatible-mode/v1/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modele.model,
      input: [question],
      dimensions: modele.dimensions,
    }),
    // Une question de conversation ne peut pas attendre trente secondes. Passé
    // ce délai, mieux vaut le dire que faire patienter.
    signal: AbortSignal.timeout(12_000),
  });

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => "");
    throw new Error(`corpus : encodage refusé (${reponse.status}) ${detail.slice(0, 200)}`);
  }

  const rendu = (await reponse.json()) as { data?: Array<{ embedding?: unknown }> };
  const vecteur = rendu.data?.[0]?.embedding;
  if (!Array.isArray(vecteur) || vecteur.length !== modele.dimensions) {
    throw new Error(
      `corpus : empreinte de dimension ${Array.isArray(vecteur) ? vecteur.length : "?"} — ` +
        `le corpus en attend ${modele.dimensions}`,
    );
  }
  return vecteur as number[];
}

/**
 * Ce que le droit dit, sur cette question, à cette date.
 *
 * @param jour  L'état du droit à cette date. Une facture de mars 2025 se juge
 *              sur l'article en vigueur en mars 2025, pas sur celui
 *              d'aujourd'hui. `null` demande le plus récent.
 */
export async function chercherDansLeDroit(
  api: AppelApi,
  question: string,
  options: { nb?: number; jour?: string | null; doctrine?: boolean; historique?: boolean } = {},
): Promise<FragmentDeDroit[]> {
  const propre = question.trim();
  if (propre.length < 3) return [];

  const modele = await api.rpc<ModeleEmpreinte>("corpus", "modeleEmpreinte", []);
  const vecteur = await encoder(propre, modele);

  const fragments = await api.rpc<FragmentDeDroit[]>("corpus", "rechercher", [
    {
      vecteur,
      nb: options.nb ?? 6,
      jour: options.jour ?? null,
      // La doctrine administrative répond toujours : c'est ce que le fisc dit
      // AUJOURD'HUI du texte en vigueur, et une PME a le droit de le savoir.
      // Sa portée réduite est dite dans la réponse, pas cachée en l'écartant.
      doctrine: options.doctrine ?? true,
      // Les lois de finances anciennes n'entrent que si l'on interroge une
      // date passée : sinon elles noieraient le code consolidé, qui DIT l'état
      // du droit, sous les textes qui l'ont modifié un à un.
      historique: options.historique ?? options.jour != null,
    },
  ]);

  return fragments.filter((f) => f.distance <= DISTANCE_MAX);
}

/** Un paramètre fiscal, tel que le référentiel le porte. */
export interface ParametreFiscal {
  code: string;
  libelle: string;
  forme: string;
  echelle: string;
  valeur: string;
  corpus: string;
  article: string | null;
  citation: string | null;
  autorite: string;
  confiance: string;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
}

/**
 * Les mots d'une question qui peuvent désigner un paramètre.
 *
 * On écarte les mots courts et les mots-outils : « quel », « pour », « dans »
 * ramèneraient la moitié du référentiel. Ce qui reste — « timbre »,
 * « acompte », « retenue » — porte le sujet.
 */
function motsSignificatifs(question: string): string[] {
  const OUTILS = new Set([
    "quel",
    "quelle",
    "quels",
    "quelles",
    "pour",
    "dans",
    "avec",
    "sans",
    "mon",
    "mes",
    "votre",
    "vos",
    "cette",
    "cet",
    "ces",
    "est",
    "sont",
    "être",
    "avoir",
    "combien",
    "comment",
    "pourquoi",
    "quand",
    "aujourd",
    "hui",
    "entreprise",
    "société",
    "societe",
    "faut",
    "dois",
    "peut",
    "puis",
    "plus",
    "moins",
  ]);
  return [
    ...new Set(
      question
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((m) => m.length >= 4 && !OUTILS.has(m)),
    ),
  ];
}

/**
 * Le chiffre, avec son fondement — jamais l'un sans l'autre.
 *
 * Regalica ne va PAS chercher un taux dans le texte de loi : elle le lit ici,
 * où il est daté, cité et confirmé. Lire « 19% » dans un article et le
 * recopier serait une lecture, donc une interprétation ; lire le paramètre
 * `tva_taux_normal` est une consultation.
 */
export async function parametresPour(
  api: AppelApi,
  input: {
    jurisdiction: string;
    question: string;
    fragments: readonly FragmentDeDroit[];
    jour?: string | null;
  },
): Promise<ParametreFiscal[]> {
  return api.rpc<ParametreFiscal[]>("corpus", "parametresPour", [
    {
      jurisdiction: input.jurisdiction,
      articles: input.fragments.map((f) => ({ corpus: f.corpus, numero: f.numero })),
      mots: motsSignificatifs(input.question),
      jour: input.jour ?? null,
    },
  ]);
}

export function parametresEnTexte(parametres: readonly ParametreFiscal[]): string {
  if (parametres.length === 0) return "";
  return parametres
    .map((p) => {
      const validite = p.validTo ? `du ${p.validFrom} au ${p.validTo}` : `depuis le ${p.validFrom}`;
      const fondement = p.article ? `${p.corpus} ${p.article}` : p.corpus;
      // Une valeur non confirmée se dit comme telle : « NON TROUVÉ » est une
      // information, et la donner pour un chiffre serait une faute.
      const reserve = p.confiance === "confirme" ? "" : ` — VALEUR ${p.confiance.toUpperCase()}`;
      return (
        `${p.code} = ${p.valeur} (${p.forme}, ${p.echelle}) — ${p.libelle}\n` +
        `  fondement : ${fondement} · ${p.autorite} · en vigueur ${validite}${reserve}` +
        (p.note ? `\n  note : ${p.note}` : "")
      );
    })
    .join("\n\n");
}

/**
 * Les fragments, tels que Regalica les reçoit.
 *
 * Ce n'est pas de la mise en forme d'écran : c'est ce que le modèle lit. Chaque
 * ligne porte de quoi peser le texte — sinon elle citerait une note commune
 * comme elle citerait la loi.
 */
export function enTexte(fragments: readonly FragmentDeDroit[]): string {
  if (fragments.length === 0) return "";
  return fragments
    .map((f) => {
      const validite = f.validTo
        ? `en vigueur du ${f.validFrom} au ${f.validTo}`
        : `en vigueur depuis ${f.validFrom}`;
      const portee = f.opposableA ? `opposable à : ${f.opposableA}` : "opposable à personne";
      const etat = f.statut === "en_vigueur" ? "" : ` — STATUT : ${f.statut}`;
      const abroge = f.abrogePar ? ` (abrogé par ${f.abrogePar})` : "";
      const jort = f.jortReference ? ` — publié : ${f.jortReference}` : "";
      const nature = f.nature ?? "nature non déterminée";
      return [
        `${f.corpus} art. ${f.numero} (${f.langue}, ${validite})${etat}${abroge}`,
        `  ${nature}${f.autorite ? ` — ${f.autorite}` : ""} — ${portee}${jort}`,
        `  provenance de la lecture : ${f.provenance}`,
        `  « ${f.extrait.replace(/\s+/g, " ").trim()} »`,
      ].join("\n");
    })
    .join("\n\n");
}
