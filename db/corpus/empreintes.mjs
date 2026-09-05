/**
 * L'acces au modele d'empreintes — un seul endroit, pour les deux cotes.
 *
 * ====================================================== POURQUOI CE FICHIER
 *
 * Le corpus et les questions doivent etre encodes par LE MEME modele, dans la
 * MEME dimension. Deux appels ecrits separement finissent toujours par diverger
 * — une dimension ici, un modele en dur la — et le resultat n'est pas degrade :
 * il n'a plus de sens, les vecteurs vivant dans deux espaces differents.
 *
 * ====================================================== LE TYPE DE TEXTE
 *
 * Une question et sa reponse ne se ressemblent pas. « Quel taux de TVA sur les
 * services exportes ? » et « Sont exonerees de la taxe sur la valeur ajoutee
 * les prestations de services rendues a l'etranger... » n'ont ni la meme forme
 * ni le meme vocabulaire. Le modele sait corriger cet ecart si on lui dit de
 * quel cote on est : `document` pour le corpus, `query` pour la question.
 *
 * Mesure faite sur ce couple, avec ce modele :
 *
 *   sans type      cosinus 0,5755
 *   avec les types cosinus 0,6507
 *
 * Le reglage n'existe QUE sur l'API native de DashScope. Le mode compatible
 * OpenAI — celui que ce depot utilisait — ne porte pas le champ et applique un
 * encodage symetrique. C'est la raison du changement de point d'entree.
 *
 * BUN, PAS NODE : dashscope-intl.aliyuncs.com ne se resout qu'en IPv6 depuis ce
 * poste ; le fetch de Node expire.
 */

export const DIMENSION = 1024;

/** Le modele vient de la table qui le tarife. Jamais d'une constante. R8. */
export async function modeleEnVigueur(client) {
  const { rows } = await client.query(
    `select id, provider, model, price_in_per_mtok, currency, sovereign
       from agents.model_pricing
      where role = 'embedding'
        and effective_from <= current_date
        and (effective_to is null or effective_to > current_date)
      order by effective_from desc
      limit 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      "aucun modele d'empreinte en vigueur dans agents.model_pricing (role='embedding'). " +
        "Ajoutez-en un par migration : le modele ne se choisit pas dans le code.",
    );
  }
  return rows[0];
}

/**
 * Encode un lot de textes. `type` vaut « document » ou « query », et rien
 * d'autre : une valeur inventee serait acceptee en silence par l'API et
 * produirait un espace vectoriel de plus.
 */
export async function encoder(textes, type, { base, cle, modele }) {
  if (type !== "document" && type !== "query") {
    throw new Error(`type de texte inconnu : ${type} (attendu « document » ou « query »)`);
  }
  const adresse =
    base.replace(/\/+$/, "").replace(/\/compatible-mode.*$/, "") +
    "/api/v1/services/embeddings/text-embedding/text-embedding";
  const reponse = await fetch(adresse, {
    method: "POST",
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modele,
      input: { texts: textes },
      parameters: { dimension: DIMENSION, text_type: type },
    }),
  });
  if (!reponse.ok) {
    throw new Error(`empreintes ${reponse.status} : ${(await reponse.text()).slice(0, 400)}`);
  }
  const donnees = await reponse.json();
  const vecteurs = (donnees.output?.embeddings ?? [])
    .sort((a, b) => a.text_index - b.text_index)
    .map((e) => e.embedding);
  if (vecteurs.length !== textes.length) {
    throw new Error(
      `le fournisseur a rendu ${vecteurs.length} empreintes pour ${textes.length} textes`,
    );
  }
  for (const v of vecteurs) {
    if (v.length !== DIMENSION) {
      throw new Error(`dimension ${v.length} recue, ${DIMENSION} attendue — la colonne ne peut pas l'accueillir.`);
    }
  }
  return { vecteurs, usage: donnees.usage ?? null };
}
