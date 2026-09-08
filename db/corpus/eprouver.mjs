/**
 * La jauge du decoupage : des verites qu'un fiscaliste tunisien connait de tete.
 * Un code n'est repris que quand toutes ses lignes disent OUI.
 *
 *   bun eprouver.mjs <fichier.txt> <CORPUS>
 */
import { readFileSync } from "node:fs";
import { decouper } from "./segmenter.mjs";

const VERITES = {
  CTVA: [
    ["7", /taux de 19\s*%|19\s*%/i, "l'article 7 fixe le taux normal"],
    ["9", /d[ée]duct/i, "l'article 9 traite du droit a deduction"],
    [
      "1",
      /champ d'application|soumises? [àa] la taxe/i,
      "l'article 1 ouvre le champ d'application",
    ],
    ["18", /obligation|facture|registre/i, "l'article 18 porte les obligations"],
  ],
  CIRPPIS: [
    ["52", /retenue [àa] la source/i, "l'article 52 fixe les retenues a la source"],
    ["1", /imp[ôo]t sur le revenu/i, "l'article 1 institue l'impot sur le revenu"],
  ],
  CDET: [
    ["127", /droit de timbre/i, "l'article 127 traite du timbre"],
    ["1", /enregistr/i, "l'article 1 ouvre la formalite de l'enregistrement"],
    ["20", /tarif|droit/i, "l'article 20 porte le tarif des droits"],
  ],
  CDPF: [
    [
      "1",
      /pr[ée]sent code fixe|droits et obligations du contribuable/i,
      "l'article 1 ouvre le code",
    ],
    [
      "10",
      /administration fiscale/i,
      "l'article 10 porte sur les significations de l'administration",
    ],
  ],
  CFL: [
    ["1", /taxe|collectivit[ée]s? locales?|immeuble/i, "l'article 1 ouvre le code"],
    ["35", /taxe|redevance|imp[ôo]t/i, "l'article 35 porte une taxe locale"],
  ],
  RECUEIL: [["1", /droit|taxe|redevance/i, "l'article 1 ouvre le recueil"]],
};

const fichier = process.argv[2];
const corpus = process.argv[3];
const langue = fichier.includes("-ar") ? "ar" : "fr";
const texte = readFileSync(fichier, "utf8");
const articles = decouper(texte, langue);

console.log(`${corpus} — ${articles.length} articles decoupes`);
if (articles.length) {
  console.log(
    `  du n° ${articles[0].numero} au n° ${articles[articles.length - 1].numero}, ` +
      `positions ${articles[0].debut} a ${articles[articles.length - 1].fin}`,
  );
  const long = articles.reduce((a, b) => (b.texte.length > a.texte.length ? b : a));
  const moy = Math.round(articles.reduce((s, a) => s + a.texte.length, 0) / articles.length);
  console.log(
    `  longueur moyenne ${moy}, plus long : art ${long.numero} (${long.texte.length} car.)`,
  );
}

const attendus = VERITES[corpus] ?? [];
let ok = 0;
console.log("");
for (const [num, motif, libelle] of attendus) {
  const a = articles.find((x) => x.numero === num);
  const passe = a ? motif.test(a.texte) : false;
  if (passe) ok += 1;
  console.log(`  ${passe ? "OUI" : "NON"}  ${libelle}`);
  if (a && !passe) console.log(`       trouve : ${a.texte.slice(0, 140).replace(/\s+/g, " ")}`);
  if (!a) console.log(`       article ${num} absent du corps`);
}
console.log(`\n${ok}/${attendus.length} verites`);
process.exitCode = ok === attendus.length ? 0 : 1;
