/**
 * Retrait des entetes et pieds de page du Journal Officiel.
 *
 * Chaque page du JORT porte, en tete ou en pied, « N° 15 Journal Officiel de la
 * Republique Tunisienne — 21 fevrier 2017 Page 771 ». Repetee trois cents fois
 * dans une loi de finances, cette ligne se retrouve au milieu des articles, part
 * dans les fragments, et se fait encoder comme si c'etait du droit. Une question
 * sur un taux remontait ainsi un fragment dont l'essentiel etait un numero de
 * page.
 *
 * On ne retire QUE la ligne complete d'entete : elle commence par le numero du
 * journal ou par la pagination, et rien d'autre. « ... sera publie au Journal
 * Officiel de la Republique Tunisienne », qui est du texte d'article, ne
 * commence pas ainsi et reste intact.
 *
 * La ligne est videe, pas supprimee : le decoupage travaille sur des positions.
 */
const ENTETES = [
  /^[ \t]*(?:N[°ºo][ \t]*\d{1,4}[ \t]*)?(?:Page[ \t]*\d{1,5}[ \t]*)?Journal[ \t]+Officiel[ \t]+de[ \t]+la[ \t]+R[ée]publique[ \t]+Tunisienne\b.*$/gim,
  /^[ \t]*Page[ \t]*\d{1,5}[ \t]*$/gim,
  /^[ \t]*(?:عدد[ \t]*\d{1,4}[ \t]*)?(?:صفحة[ \t]*\d{1,5}[ \t]*)?الرائد[ \t]*الرسمي[ \t]*للجمهورية[ \t]*التونسية\b.*$/gm,
];

export function retirerEntetesDePage(texte) {
  let t = texte;
  for (const rx of ENTETES) t = t.replace(rx, (m) => " ".repeat(m.length));
  return t;
}
