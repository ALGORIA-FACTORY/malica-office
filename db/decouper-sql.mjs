/**
 * Découper un fichier SQL en instructions — pour ce qui refuse une transaction.
 *
 * `create index concurrently` ne s'exécute pas dans un bloc de transaction, et
 * un lot d'instructions envoyé d'un coup en est un. Pour ces fichiers-là, on
 * envoie chaque instruction seule. Le découpage respecte ce qui contient des
 * points-virgules sans en être la fin : chaînes, commentaires, corps de
 * fonctions entre `$$` ou `$tag$`.
 */
export function decouperSql(source) {
  const instructions = [];
  let courante = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const deux = source.slice(i, i + 2);
    // Commentaire de ligne.
    if (deux === "--") {
      const fin = source.indexOf("\n", i);
      const jusque = fin < 0 ? n : fin;
      courante += source.slice(i, jusque);
      i = jusque;
      continue;
    }
    // Commentaire de bloc.
    if (deux === "/*") {
      const fin = source.indexOf("*/", i + 2);
      const jusque = fin < 0 ? n : fin + 2;
      courante += source.slice(i, jusque);
      i = jusque;
      continue;
    }
    // Chaîne simple : '…', avec '' comme échappement.
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "'" && source[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (source[j] === "'") break;
        j += 1;
      }
      courante += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Citation en dollars : $$ ou $tag$, jusqu'au même marqueur.
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (m) {
        const marqueur = m[0];
        const fin = source.indexOf(marqueur, i + marqueur.length);
        const jusque = fin < 0 ? n : fin + marqueur.length;
        courante += source.slice(i, jusque);
        i = jusque;
        continue;
      }
    }
    if (c === ";") {
      if (courante.trim()) instructions.push(courante.trim());
      courante = "";
      i += 1;
      continue;
    }
    courante += c;
    i += 1;
  }
  if (courante.trim()) instructions.push(courante.trim());
  // Une instruction faite seulement de commentaires n'en est pas une.
  return instructions.filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim() !== "");
}
