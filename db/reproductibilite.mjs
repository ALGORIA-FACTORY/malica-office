/**
 * R11 — une migration donne le même référentiel, quel que soit le jour où on la joue.
 *
 * Relève, dans le texte d'une migration, les instructions qui font entrer
 * dans une table du référentiel une valeur qui dépend du moment ou du hasard :
 * `current_date`, `now()`, `current_timestamp`, `clock_timestamp()`,
 * `random()`, `gen_random_uuid()`.
 *
 * Deux formes :
 *
 *   ÉCRITE   — le jeton est dans l'instruction :
 *              `update agents.model_pricing set effective_to = current_date` ;
 *   CACHÉE   — l'insertion omet une colonne dont le DÉFAUT est daté :
 *              `insert into ref.rejet_motifs (code, …)` alors que `valid_from`
 *              vaut `current_date` par défaut. Rien d'écrit, et pourtant la
 *              date du jour entre dans le référentiel.
 *
 * Ce qui reste permis, parce que ce n'est pas une donnée de référence :
 *   - un défaut de colonne en lui-même (c'est du schéma) — il ne devient une
 *     faute que lorsqu'une insertion le laisse s'appliquer ;
 *   - un identifiant ou un horodatage laissés à leur défaut (`id`,
 *     `created_at`) : ils ne portent pas le contenu du référentiel ;
 *   - le corps d'une fonction : il s'exécute plus tard, pas pendant la migration ;
 *   - une donnée métier ou du corpus datée du jour.
 *
 * Le référentiel : le schéma `ref`, `agents.model_pricing`, `storage.buckets`.
 */
import { decouperSql } from "./decouper-sql.mjs";

const JETON =
  /\b(current_date|current_timestamp|localtimestamp|now\s*\(\s*\)|clock_timestamp\s*\(\s*\)|random\s*\(\s*\)|gen_random_uuid\s*\(\s*\))/i;
const DEFAUT_DATE = new RegExp(`\\bdefault\\s+${JETON.source}`, "i");

const estReference = (table) =>
  table.startsWith("ref.") || table === "agents.model_pricing" || table === "storage.buckets";

/** Une colonne qui ne porte pas de contenu : un identifiant ou un horodatage. */
const sansContenu = (definition) =>
  /^\s*"?\w+"?\s+(uuid|timestamp|timestamptz)\b/i.test(definition);

const jetonNormalise = (brut) => brut.toLowerCase().replace(/\s+/g, "");

const sansCommentaires = (sql) =>
  sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

/** Découpe une liste au premier niveau de parenthèses : `a int, b numeric(10,2)` → 2 éléments. */
function auPremierNiveau(texte) {
  const parts = [];
  let profondeur = 0;
  let courant = "";
  for (const c of texte) {
    if (c === "(") profondeur += 1;
    if (c === ")") profondeur -= 1;
    if (c === "," && profondeur === 0) {
      parts.push(courant);
      courant = "";
    } else courant += c;
  }
  if (courant.trim()) parts.push(courant);
  return parts;
}

/** Le contenu entre la parenthèse ouvrante à `debut` et sa fermante. */
function entreParentheses(texte, debut) {
  let profondeur = 0;
  for (let i = debut; i < texte.length; i++) {
    if (texte[i] === "(") profondeur += 1;
    if (texte[i] === ")") {
      profondeur -= 1;
      if (profondeur === 0) return texte.slice(debut + 1, i);
    }
  }
  return "";
}

function retenirDefaut(defauts, table, definition) {
  if (sansContenu(definition) || !DEFAUT_DATE.test(definition)) return;
  const colonne = /^\s*"?(\w+)"?/.exec(definition)?.[1];
  if (!colonne) return;
  if (!defauts.has(table)) defauts.set(table, new Set());
  defauts.get(table).add(colonne.toLowerCase());
}

/** Toutes les insertions d'un texte, avec leur liste de colonnes si elle est donnée. */
function* insertions(texte) {
  const re = /\binsert\s+into\s+([a-z_]+\.[a-z_]+)\s*(\()?/gi;
  for (const m of texte.matchAll(re)) {
    const colonnes = m[2]
      ? auPremierNiveau(entreParentheses(texte, m.index + m[0].length - 1)).map((c) =>
          c.trim().replace(/"/g, "").toLowerCase(),
        )
      : null;
    yield { table: m[1].toLowerCase(), colonnes };
  }
}

/**
 * @param {string} source          le texte d'une migration
 * @param {Map<string, Set<string>>} defauts  les colonnes du référentiel à défaut daté, déjà
 *        connues — à partager d'une migration à la suivante, dans l'ordre d'application
 * @returns {{ instruction: string, table: string, jeton: string }[]}
 */
export function valeursNonReproductibles(source, defauts = new Map()) {
  const sql = source
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n");
  const trouvees = [];

  for (const brute of decouperSql(sql)) {
    const s = sansCommentaires(brute);
    if (!s) continue;
    const extrait = s.replace(/\s+/g, " ").slice(0, 110);
    const verbe = (/^(\w+)/.exec(s)?.[1] ?? "").toLowerCase();

    // Le schéma : on retient les colonnes du référentiel à défaut daté.
    const table =
      /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_]+)\s*\(/i.exec(s);
    if (table) {
      const nom = table[1].toLowerCase();
      if (estReference(nom))
        for (const def of auPremierNiveau(entreParentheses(s, s.indexOf("(", table.index))))
          retenirDefaut(defauts, nom, def);
      continue;
    }
    const alter =
      /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z_]+\.[a-z_]+)\s+([\s\S]*)$/i.exec(s);
    if (alter) {
      const nom = alter[1].toLowerCase();
      if (!estReference(nom)) continue;
      for (const action of auPremierNiveau(alter[2])) {
        const ajout = /^\s*add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(action);
        if (ajout) retenirDefaut(defauts, nom, ajout[1]);
        const pose = /^\s*alter\s+(?:column\s+)?"?(\w+)"?\s+set\s+(default\s+[\s\S]+)$/i.exec(
          action,
        );
        if (pose) retenirDefaut(defauts, nom, `${pose[1]} ${pose[2]}`);
        const retrait = /^\s*alter\s+(?:column\s+)?"?(\w+)"?\s+drop\s+default/i.exec(action);
        if (retrait) defauts.get(nom)?.delete(retrait[1].toLowerCase());
      }
      continue;
    }

    // Les données : seules les instructions qui s'exécutent pendant la migration.
    if (!["insert", "update", "delete", "merge", "do", "with"].includes(verbe)) continue;

    const ecrites =
      verbe === "do" || verbe === "with"
        ? [
            ...s.matchAll(
              /\b(?:insert\s+into|update|delete\s+from|merge\s+into)\s+([a-z_]+\.[a-z_]+)/gi,
            ),
          ].map((m) => m[1].toLowerCase())
        : [
            /^(?:insert\s+into|update|delete\s+from|merge\s+into)\s+(?:only\s+)?([a-z_]+\.[a-z_]+)/i
              .exec(s)?.[1]
              ?.toLowerCase(),
          ];
    const referencees = [...new Set(ecrites.filter((t) => t && estReference(t)))];
    if (referencees.length === 0) continue;

    // Forme écrite : un jeton dans l'instruction.
    const jeton = JETON.exec(s);
    if (jeton)
      trouvees.push({
        instruction: extrait,
        table: referencees[0],
        jeton: jetonNormalise(jeton[1]),
      });

    // Forme cachée : une insertion qui laisse un défaut daté s'appliquer.
    for (const ins of insertions(s)) {
      if (!estReference(ins.table) || !ins.colonnes) continue;
      for (const colonne of defauts.get(ins.table) ?? [])
        if (!ins.colonnes.includes(colonne))
          trouvees.push({ instruction: extrait, table: ins.table, jeton: `défaut de ${colonne}` });
    }
  }
  return trouvees;
}
