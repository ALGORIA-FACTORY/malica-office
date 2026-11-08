/**
 * Composer les pièces du jeu d'ALGORIA qui ne sont pas des factures (cas 121 à
 * 161), et leur vérité.
 *
 * ================================================================= LES PIÈCES
 *
 * Quarante et une pièces FICTIVES : cinq de gouvernance (procès-verbaux d'AGO
 * et d'AGE, statuts, extrait du RNE, décision du gérant) et deux de chacun des
 * dix-huit autres types de `ref.document_types` (avoir, bon de livraison,
 * justificatif de paiement, reçu, note de frais, relevé bancaire, ticket de
 * caisse, bulletin de paie, déclarations de TVA, de la CNSS et d'impôt,
 * acompte provisionnel, carte d'identification fiscale, document fiscal ou
 * social, contrat, bail, autre document, document non comptable).
 *
 * Chaque cas porte `type` (le code du type de document) et `grille` (le code
 * de la grille qui le lit : `ref.grilles.document_type` quand la base les
 * relie, sinon le choix dit dans `PIECES`). Sa page est décrite par ses blocs
 * (`piece.blocs`, dessinés par `mises-en-page.mjs`), et sa vérité
 * (`attendu.concepts`) se clé par les codes des champs de SA grille
 * (`grilles/<code>.json`) — montants en décimal, dates ISO, matricules à la
 * forme normalisée. Une occurrence répétée (article, mouvement, résolution,
 * salarié, associé, partie) est une ligne de `lignes`, clé par les codes de
 * la grille, comme les articles d'une facture.
 *
 * ================================================================= LES PARTIES
 *
 * La seule partie réelle reste ALGORIA FACTORY SARL et son matricule ; elle
 * tient le rôle que la pièce lui donne (client d'un avoir reçu, payeur d'un
 * reçu, employeur d'un bulletin, titulaire d'un compte, contribuable d'une
 * déclaration, preneur d'un bail…). Chaque cas le dit (`piece.parties`, avec
 * le rôle de la grille et `est` : « dossier » pour ALGORIA). Le matricule
 * d'ALGORIA ne s'imprime que de son côté (`piece.cheminsDuDossier`), et aucun
 * matricule n'est imprimé deux fois sur une page : le compositeur le contrôle.
 *
 * Les taux (IS, acomptes, CNSS, TFP, FOPROLOS, retenues à la source, barème de
 * l'IRPP) se lisent dans `parametres.json`, relevé en base ; la TVA et le
 * timbre au référentiel du jeu synthétique. Aucun taux n'est écrit ici.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { matriculeDEssai } from "../../apps/api/src/matricule-d-essai.ts";
import { mulberry32, tirages } from "../jeu-synthetique/hasard.mjs";
import {
  enChiffresOrientaux,
  enLettres,
  horsTaxe,
  imprimer,
  multiplier,
  versDecimal,
  versMineur,
} from "../jeu-synthetique/montants.mjs";
import { DEVISE_DU_DOSSIER, droit, exposantDe, tauxDe } from "../jeu-synthetique/referentiel.mjs";

import { ACHATS, ALGORIA, ASSOCIES, AUTRES, RAYON, SALARIES } from "./catalogue.mjs";
import {
  deux,
  effetsDeLaPriseDeVue,
  formeDuMatricule,
  iso,
  lesPoses,
  MOIS_FR,
} from "./factures.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const PARAMETRES = JSON.parse(readFileSync(join(ICI, "parametres.json"), "utf8")).parametres;

/** Un paramètre relevé, en pourcentage décimal : « 9,18 » → "9.18". */
const pourcentDe = (code) => PARAMETRES[code].valeur.replace(",", ".");
/** Un pourcentage (« 9.18 ») en ratio (« 0.09180000 »), pour `multiplier`. */
const ratio = (pct) => versDecimal(versMineur(pct, 6), 8);
const EXPOSANT = exposantDe(DEVISE_DU_DOSSIER);
const UNITE = 10n ** BigInt(EXPOSANT);
/** Des dinars entiers (ou « 12.5 ») en millimes. */
const dinars = (n) => versMineur(String(n), EXPOSANT);
const tva19 = tauxDe("TVA19");
const tva7 = tauxDe("TVA07");
const pct = (taux) => String(versMineur(taux, 2));

const MOIS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const ORDINAUX = ["PREMIÈRE", "DEUXIÈME", "TROISIÈME", "QUATRIÈME", "CINQUIÈME"];
const jour = (mois, j) => new Date(Date.UTC(2026, mois - 1, j));
const plus = (d, jours) => new Date(d.getTime() + jours * 86_400_000);
const dernierJour = (mois) => new Date(Date.UTC(2026, mois, 0));
/** Une période ISO, « début/fin ». */
const periode = (a, b) => `${iso(a)}/${iso(b)}`;

/** Le montant en toutes lettres, en dinars et millimes. */
function enToutesLettres(m) {
  const d = Number(m / UNITE);
  const r = Number(m % UNITE);
  return `${enLettres(d)} dinar${d > 1 ? "s" : ""}${r ? ` et ${enLettres(r)} millimes` : ""}`;
}

/* ------------------------------------------------------------ la feuille */

/**
 * La feuille d'une pièce : ses blocs, ce qu'elle imprime et sa vérité. Les
 * aides posent un champ de la grille et rendent le morceau qui l'imprime.
 */
function feuille(spec) {
  const { imprime, versConcept, concepts, pose, poseConcept } = lesPoses();
  const langue = spec.langue;
  const format = {
    milliers: spec.milliers ?? " ",
    decimal: ",",
    chiffres: spec.orientaux ? "orientaux" : "latins",
  };
  const chiffres = (s) => (spec.orientaux ? enChiffresOrientaux(s) : s);
  const f = {
    blocs: [],
    imprime,
    versConcept,
    concepts,
    poseConcept,
    format,
    dossier: [],
    notes: [],
    confondus: {},
    /** Un libellé dans la langue de la page ; le bilingue porte les deux. */
    L: (fr, ar) => (langue === "fr" ? fr : langue === "ar" ? ar : `${fr} / ${ar}`),
    /** Un texte imprimé au chemin, et la valeur attendue de son champ (ou aucun). */
    v(chemin, texte, code, valeur = texte) {
      pose(chemin, texte, code ?? null, valeur);
      return { c: chemin };
    },
    /** Un champ de la grille, imprimé à un chemin de son nom. */
    c: (code, texte, valeur = texte) => f.v(code, texte, code, valeur),
    /** Le champ `code` de la i-ième occurrence (`lignes[i]`). */
    l: (i, code, texte, valeur = texte) =>
      f.v(`lignes[${i}].${code}`, texte, `lignes[${i}].${code}`, valeur),
    /** Une liste imprimée en morceaux : chacun mesuré, la valeur est la liste. */
    liste(code, textes, valeurs = textes) {
      const morceaux = textes.map((x, k) => {
        pose(`${code}.${k}`, x, code, null);
        return { c: `${code}.${k}` };
      });
      poseConcept(code, valeurs);
      return morceaux;
    },
    mt: (m) => imprimer(m, EXPOSANT, format),
    dec: (m) => versDecimal(m, EXPOSANT),
    /** Un montant : imprimé au format de la page, attendu en décimal. */
    m: (code, m) => f.c(code, f.mt(m), f.dec(m)),
    lm: (i, code, m) => f.l(i, code, f.mt(m), f.dec(m)),
    nombre: (n) => chiffres(String(n)),
    n: (code, n) => f.c(code, chiffres(String(n)), String(n)),
    ln: (i, code, n) => f.l(i, code, chiffres(String(n)), String(n)),
    /** Une date imprimée dans un style ; la valeur attendue est ISO. */
    dateTexte(d, style = "slash") {
      const jj = deux(d.getUTCDate());
      const mm = deux(d.getUTCMonth() + 1);
      const a = d.getUTCFullYear();
      const t = {
        slash: `${jj}/${mm}/${a}`,
        tiret: `${jj}-${mm}-${a}`,
        point: `${jj}.${mm}.${a}`,
        court: `${jj}/${mm}/${String(a).slice(2)}`,
        long: `${d.getUTCDate()} ${MOIS_FR[d.getUTCMonth()]} ${a}`,
        arabe: `${d.getUTCDate()} ${MOIS_AR[d.getUTCMonth()]} ${a}`,
        inverse: `${a}/${mm}/${jj}`,
      }[style];
      return chiffres(t);
    },
    d: (code, d, style) => f.c(code, f.dateTexte(d, style), iso(d)),
    ld: (i, code, d, style) => f.l(i, code, f.dateTexte(d, style), iso(d)),
    /** Un matricule, sous sa forme imprimée ; celui d'ALGORIA est noté de son côté. */
    mf(code, matricule, forme = "slash", chemin = code) {
      if (matricule === ALGORIA.matricule) f.dossier.push(chemin);
      return f.v(chemin, formeDuMatricule(matricule, forme), code, matricule);
    },
    vrai: (code) => poseConcept(code, true),
  };
  return f;
}

/** Le matricule d'ALGORIA, imprimé sans champ de la grille (une partie de l'acte). */
function matriculeHorsGrille(f, chemin, forme) {
  f.dossier.push(chemin);
  return f.v(chemin, formeDuMatricule(ALGORIA.matricule, forme), null);
}

/* ---------------------------------------------------------------- les parties */

/** ALGORIA telle que la pièce la nomme, dans la langue de la page. */
const algoria = (langue) => ({
  nom: langue === "ar" ? ALGORIA.nomAr : ALGORIA.nom,
  matricule: ALGORIA.matricule,
  adresse:
    langue === "ar"
      ? `${ALGORIA.rue[1]}، ${ALGORIA.ville[1]}`
      : `${ALGORIA.rue[0]}, ${ALGORIA.ville[0]}`,
  telephone: ALGORIA.telephone,
  est: "dossier",
});
/** Une partie de la pièce, avec le rôle que lui donne la grille. */
const partie = (role, p) => ({
  role,
  nom: p.nom,
  matricule: p.matricule ?? null,
  est: p.est ?? "tiers",
});
/** Le numéro employeur CNSS d'ALGORIA sur ces pages : inventé, préfixe 99. */
const CNSS_ALGORIA = "99418273-06";
/** Le capital et les parts : 5 000 parts de 10 DT, comme la forme du catalogue. */
const PARTS = ASSOCIES.reduce((s, a) => s + a.parts, 0);
const NOMINAL = 10;
const GERANT = ASSOCIES.find((a) => a.gerant);
const IDENTIFIANT_UNIQUE = ALGORIA.matricule.slice(0, 8);

/* ================================================================ gouvernance */

/** 121 — procès-verbal de l'AGO annuelle : approbation, quitus, affectation, mandat. */
function pvAgo(f, { t }) {
  const date = jour(6, t.tirer(18, 27));
  const convocation = plus(date, -t.tirer(16, 21));
  const benefice = dinars(t.tirer(62000, 98000)) + BigInt(t.tirer(0, 1000));
  const reportAnterieur = dinars(t.tirer(4000, 15000)) + BigInt(t.tirer(0, 1000));
  const capitauxPropres = dinars(50000) + benefice + reportAnterieur + dinars(t.tirer(2000, 4000));
  const totalBilan = capitauxPropres + dinars(t.tirer(90000, 180000));
  const aAffecter = benefice + reportAnterieur;
  // INCERTAIN — la réserve légale (5 % du bénéfice, art. 287 CSC) n'est pas relevée en base.
  const reserve = multiplier(benefice, "0.05");
  const parPart = dinars(t.choisir([6, 7, 8, 9]));
  const dividendes = parPart * BigInt(PARTS);
  const reportNouveau = aAffecter - reserve - dividendes;
  const [p1, p2] = ASSOCIES;
  const secretaire = p2;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("denomination", ALGORIA.nom), cls: "gros" }],
        ["Société à responsabilité limitée au capital de 50 000 dinars"],
        ["Siège social : ", algoria("fr").adresse],
        ["Identifiant unique : ", f.c("identifiant_unique", IDENTIFIANT_UNIQUE)],
      ],
      droite: [],
    },
    {
      k: "titre",
      texte: [
        "PROCÈS-VERBAL DE L'",
        f.c("type_assemblee", "ASSEMBLÉE GÉNÉRALE ORDINAIRE", "Assemblée générale ordinaire"),
      ],
      sous: ["du ", f.dateTexte(date, "long")],
    },
    {
      k: "texte",
      morceaux: [
        "L'an deux mille vingt-six, le ",
        f.d("date_assemblee", date, "long"),
        ", à ",
        f.c("heure_assemblee", "10 h 00", "10:00"),
        ", les associés de la société se sont réunis en assemblée générale ordinaire annuelle, ",
        f.c("lieu_assemblee", `au siège social, ${algoria("fr").adresse}`, algoria("fr").adresse),
        ", ",
        f.c("auteur_convocation", "sur convocation du gérant", "gérant"),
        " adressée à chaque associé ",
        f.c(
          "mode_convocation",
          "par lettre recommandée avec accusé de réception",
          "lettre recommandée",
        ),
        " le ",
        f.d("date_convocation", convocation, "slash"),
        ", ",
        f.c("numero_convocation", "sur première convocation", "première convocation"),
        ".",
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Sont présents ",
        f.n("nb_associes_presents", 2),
        " associés ; est représenté ",
        f.n("nb_associes_representes", 1),
        " associé, par pouvoir déposé sur le bureau. Les associés présents ou représentés détiennent ensemble ",
        f.n("titres_presents_representes", PARTS),
        " parts sociales sur les ",
        f.n("total_titres_droit_vote", PARTS),
        " parts composant le capital, soit ",
        f.c("quorum_taux", "100 %", "100"),
        " du capital : le quorum étant atteint, ",
        f.c("constat_validite", "l'assemblée peut valablement délibérer", true),
        ".",
      ],
    },
    {
      k: "texte",
      morceaux: [
        "L'assemblée est présidée par M. ",
        f.c("president_seance", p1.nom),
        ", gérant. Mme ",
        f.c("secretaire", secretaire.nom),
        " est désignée secrétaire de séance. Le président rappelle que le rapport de gestion et les états financiers de l'exercice ",
        f.c(
          "exercice_concerne",
          "clos le 31 décembre 2025",
          periode(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31))),
        ),
        " ont été tenus à la disposition des associés dans les délais légaux.",
      ],
    },
    { k: "section", texte: "ORDRE DU JOUR" },
  );
  const ordre = [
    "Approbation des états financiers de l'exercice 2025",
    "Quitus au gérant",
    "Affectation du résultat",
    "Renouvellement du mandat du gérant",
  ];
  const points = f.liste(
    "ordre_du_jour",
    ordre.map((o, i) => `${i + 1}. ${o}`),
    ordre,
  );
  f.blocs.push({ k: "texte", morceaux: points.flatMap((p, i) => (i ? [{ br: true }, p] : [p])) });
  const resolutions = [
    {
      objet: "Approbation des états financiers",
      texte:
        "L'assemblée générale, après avoir entendu la lecture du rapport de gestion du gérant, approuve les états financiers de l'exercice 2025 tels qu'ils lui ont été présentés.",
      suite: [
        "Ils font apparaître un total du bilan de ",
        f.m("total_bilan", totalBilan),
        " DT, des capitaux propres de ",
        f.m("capitaux_propres", capitauxPropres),
        " DT et un bénéfice net de ",
        f.m("resultat_exercice", benefice),
        " DT.",
      ],
    },
    {
      objet: "Quitus au gérant",
      texte: "",
      suite: [
        f.c(
          "quitus",
          "L'assemblée générale donne au gérant quitus entier et sans réserve de l'exécution de son mandat pour l'exercice 2025.",
        ),
      ],
    },
    {
      objet: "Affectation du résultat",
      texte: "L'assemblée générale décide d'affecter le résultat comme suit :",
      suite: null,
    },
    {
      objet: "Renouvellement du mandat du gérant",
      texte: "L'assemblée générale renouvelle le mandat du gérant :",
      suite: [
        "M. ",
        f.c("nomination_personne", p1.nom),
        ", ",
        f.c("nomination_fonction", "gérant"),
        ", ",
        f.c("nomination_type", "renouvellement de mandat", "renouvellement"),
        ", ",
        f.c("nomination_duree", "pour une durée de trois ans", "P3Y"),
        ". M. ",
        p1.nom,
        " déclare ",
        f.c("acceptation_fonction", "accepter ces fonctions", true),
        ".",
      ],
    },
  ];
  f.vrai("comptes_approuves");
  resolutions.forEach((r, i) => {
    f.blocs.push({
      k: "texte",
      classe: "gras",
      morceaux: [
        f.l(i, "resolution_numero", ORDINAUX[i], String(i + 1)),
        " RÉSOLUTION — ",
        f.l(i, "resolution_objet", r.objet),
      ],
    });
    if (r.texte) f.blocs.push({ k: "texte", morceaux: [f.l(i, "resolution_texte", r.texte)] });
    if (r.suite) f.blocs.push({ k: "texte", morceaux: r.suite });
    if (i === 2)
      f.blocs.push({
        k: "tableau",
        classe: "affectation",
        entetes: ["", "Montant (DT)"],
        nombres: [1],
        lignes: [
          ["Bénéfice de l'exercice 2025", { t: f.mt(benefice) }],
          ["Report à nouveau antérieur", f.m("report_a_nouveau_anterieur", reportAnterieur)],
          ["Résultat à affecter", f.m("resultat_a_affecter", aAffecter)],
          ["Réserve légale (5 %)", f.m("dotation_reserve_legale", reserve)],
          [
            ["Dividendes, soit ", f.m("dividende_par_titre", parPart), " DT par part"],
            f.m("dividendes_total", dividendes),
          ],
          ["Report à nouveau", f.m("report_a_nouveau_nouveau", reportNouveau)],
        ],
      });
    f.blocs.push({
      k: "texte",
      morceaux: [
        "Mise aux voix, cette résolution est ",
        f.l(i, "resultat", "adoptée à l'unanimité", "adoptée"),
        " : pour ",
        f.ln(i, "votes_pour", PARTS),
        " parts, contre ",
        f.ln(i, "votes_contre", 0),
        ", abstention ",
        f.ln(i, "abstentions", 0),
        ".",
      ],
    });
  });
  f.blocs.push({
    k: "texte",
    morceaux: [
      f.c(
        "pouvoirs_formalites",
        "Tous pouvoirs sont donnés au porteur d'une copie ou d'un extrait du présent procès-verbal pour accomplir les formalités légales de dépôt et de publicité.",
      ),
      " Plus rien n'étant à l'ordre du jour, la séance est levée à ",
      f.c("heure_cloture", "11 h 40", "11:40"),
      ".",
    ],
  });
  const sig = f.liste(
    "signataires",
    [`Le Président — ${p1.nom}`, `La Secrétaire — ${secretaire.nom}`],
    [p1.nom, secretaire.nom],
  );
  f.blocs.push({ k: "signatures", gauche: sig[0], droite: sig[1] });
  f.notes.push(
    "INCERTAIN — la réserve légale à 5 % du bénéfice (art. 287 du CSC) est un choix du banc : le taux n'est pas relevé en base. Affectation : résultat à affecter = bénéfice + report antérieur ; report à nouveau = à affecter − réserve − dividendes.",
    `Associés inventés : ${ASSOCIES.map((a) => `${a.nom} (${a.parts} parts)`).join(", ")} — ce ne sont pas les associés réels d'ALGORIA.`,
  );
  return {
    titre: "Procès-verbal de l'assemblée générale ordinaire",
    parties: [partie("entreprise", algoria("fr"))],
    signature: { code: null },
  };
}

/** L'objet social, avant et après l'AGE du cas 122 (inventés). */
const OBJET_SOCIAL =
  "la conception, l'édition, l'hébergement et la commercialisation de logiciels de gestion, de conformité et d'intelligence artificielle pour la finance";
const OBJET_ETENDU = `${OBJET_SOCIAL}, ainsi que la formation professionnelle, le conseil et l'assistance à la mise en conformité réglementaire`;

/** 122 — procès-verbal d'AGE : extension de l'objet social, statuts mis à jour. */
function pvAge(f, { t }) {
  const date = jour(9, t.tirer(8, 18));
  const convocation = plus(date, -t.tirer(15, 20));
  const [p1, p2] = ASSOCIES;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [f.c("denomination", ALGORIA.nom)],
        ["S.A.R.L. au capital de 50 000 DT"],
        [algoria("fr").adresse],
      ],
      droite: [],
    },
    {
      k: "titre",
      texte: [
        "PROCÈS-VERBAL DE L'",
        f.c(
          "type_assemblee",
          "ASSEMBLÉE GÉNÉRALE EXTRAORDINAIRE",
          "Assemblée générale extraordinaire",
        ),
      ],
      sous: ["DU ", f.dateTexte(date, "slash")],
    },
    {
      k: "texte",
      morceaux: [
        "Le ",
        f.d("date_assemblee", date, "slash"),
        ", les associés de la société se sont réunis en assemblée générale extraordinaire ",
        f.c("lieu_assemblee", "au siège social", algoria("fr").adresse),
        ", ",
        f.c("numero_convocation", "sur première convocation", "première convocation"),
        " du gérant en date du ",
        f.d("date_convocation", convocation, "slash"),
        ".",
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Les associés présents ou représentés détiennent ",
        f.n("titres_presents_representes", PARTS),
        " parts sur ",
        f.n("total_titres_droit_vote", PARTS),
        ", soit ",
        f.c("quorum_taux", "la totalité du capital", "100"),
        ". La séance est présidée par M. ",
        f.c("president_seance", p1.nom),
        ", gérant ; ",
        ...f.liste("scrutateurs_secretaire", [`Mme ${p2.nom}`], [p2.nom]),
        " est désignée secrétaire.",
      ],
    },
    { k: "section", texte: "ORDRE DU JOUR" },
  );
  const ordre = [
    "Extension de l'objet social",
    "Adoption des statuts mis à jour",
    "Pouvoirs pour les formalités",
  ];
  f.blocs.push({
    k: "texte",
    morceaux: f
      .liste(
        "ordre_du_jour",
        ordre.map((o) => `— ${o}`),
        ordre,
      )
      .flatMap((p, i) => (i ? [{ br: true }, p] : [p])),
  });
  f.blocs.push({
    k: "texte",
    morceaux: [
      f.c(
        "rapport_gerant_conseil",
        "Le président donne lecture du rapport du gérant exposant les motifs de l'extension de l'objet social.",
      ),
    ],
  });
  const res = [
    {
      objet: "Modification de l'objet social",
      texte: "L'assemblée générale décide d'étendre l'objet social, qui sera désormais :",
      suite: [f.c("objet_modifie", `« La société a pour objet ${OBJET_ETENDU}. »`, OBJET_ETENDU)],
      articles: ["2"],
    },
    {
      objet: "Adoption des statuts mis à jour",
      texte:
        "En conséquence, l'assemblée générale modifie l'article 2 des statuts et adopte article par article le texte des statuts mis à jour.",
      suite: [
        f.c(
          "statuts_refondus_adoptes",
          "Les statuts mis à jour sont annexés au présent procès-verbal.",
          true,
        ),
      ],
      articles: ["2"],
    },
    {
      objet: "Pouvoirs",
      texte: "",
      suite: [
        f.c(
          "pouvoirs_formalites",
          "Tous pouvoirs sont conférés au gérant pour accomplir les formalités de dépôt et de publicité au Registre national des entreprises.",
        ),
      ],
      articles: null,
    },
  ];
  res.forEach((r, i) => {
    f.blocs.push({
      k: "texte",
      morceaux: [
        f.l(i, "resolution_numero", `${ORDINAUX[i]} RÉSOLUTION`, String(i + 1)),
        " — ",
        f.l(i, "resolution_objet", r.objet),
        ...(r.articles
          ? [" (article ", f.l(i, "articles_statuts_modifies", r.articles[0], r.articles), ")"]
          : []),
      ],
      classe: "gras",
    });
    if (r.texte) f.blocs.push({ k: "texte", morceaux: [f.l(i, "resolution_texte", r.texte)] });
    f.blocs.push({ k: "texte", morceaux: r.suite });
    f.blocs.push({
      k: "texte",
      morceaux: [
        "Cette résolution, soumise à la ",
        f.l(
          i,
          "majorite_requise",
          "majorité des trois quarts du capital",
          "trois quarts du capital",
        ),
        ", est ",
        f.l(i, "resultat", "adoptée à l'unanimité", "adoptée"),
        " (pour : ",
        f.ln(i, "votes_pour", PARTS),
        " ; contre : ",
        f.ln(i, "votes_contre", 0),
        " ; abstention : ",
        f.ln(i, "abstentions", 0),
        ").",
      ],
    });
  });
  const sig = f.liste(
    "signataires",
    [`Le Président : ${p1.nom}`, `La Secrétaire : ${p2.nom}`],
    [p1.nom, p2.nom],
  );
  f.blocs.push({ k: "signatures", gauche: sig[0], droite: sig[1] });
  f.notes.push(
    "INCERTAIN — la majorité des trois quarts du capital pour modifier les statuts d'une SARL (art. 131 CSC) n'a pas été relue ; c'est la mention de la page, et la valeur attendue est celle imprimée.",
  );
  return {
    titre: "Procès-verbal de l'assemblée générale extraordinaire",
    parties: [partie("entreprise", algoria("fr"))],
    signature: { code: null },
  };
}

/** 123 — statuts mis à jour (après l'AGE du cas 122), dactylographiés. */
function statuts(f, { t }) {
  const date = jour(9, t.tirer(19, 29));
  f.blocs.push(
    {
      k: "titre",
      texte: [f.c("denomination", ALGORIA.nom)],
      sous: [
        f.c("forme_juridique", "Société à responsabilité limitée", "SARL"),
        " au capital de ",
        f.m("capital_montant", dinars(50000)),
        " ",
        f.c("capital_devise", "dinars", "TND"),
      ],
    },
    {
      k: "titre",
      texte: [f.c("type_acte", "STATUTS MIS À JOUR", "statuts mis à jour")],
      sous: [
        "suite à l'assemblée générale extraordinaire — mise à jour du ",
        f.d("date_mise_a_jour", date, "long"),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Entre les soussignés, associés de la société, ",
        f.c("forme_acte", "par acte sous seing privé", "sous seing privé"),
        " :",
      ],
    },
  );
  ASSOCIES.forEach((a, i) => {
    f.blocs.push({
      k: "texte",
      morceaux: [
        `${i + 1}) `,
        f.l(i, "associe_pp_nom_prenom", a.nom),
        ", de nationalité ",
        f.l(i, "associe_pp_nationalite", "tunisienne"),
        ", demeurant ",
        f.l(i, "associe_pp_domicile", a.domicile),
        " ;",
      ],
    });
    f.poseConcept(`lignes[${i}].associe_type`, "personne physique");
  });
  f.blocs.push(
    {
      k: "texte",
      morceaux: [
        "soit ",
        f.n("nombre_associes", ASSOCIES.length),
        " associés, il a été établi ainsi qu'il suit les statuts de la société.",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 1 — Forme et dénomination"] },
    {
      k: "texte",
      morceaux: [
        "Il est formé une société à responsabilité limitée régie par le Code des sociétés commerciales et par les présents statuts, dénommée « ALGORIA FACTORY SARL ».",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 2 — Objet"] },
    { k: "texte", morceaux: ["La société a pour objet ", f.c("objet_social", OBJET_ETENDU), "."] },
    { k: "texte", classe: "gras", morceaux: ["Article 3 — Siège social"] },
    {
      k: "texte",
      morceaux: [
        "Le siège social est fixé au ",
        f.c("siege_social", algoria("fr").adresse),
        ". ",
        f.c(
          "clause_transfert_siege",
          "Il peut être transféré en tout autre lieu par décision collective extraordinaire des associés.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 4 — Durée"] },
    {
      k: "texte",
      morceaux: [
        "La durée de la société est fixée à ",
        f.n("duree_annees", 99),
        " années à compter ",
        f.c("point_depart_duree", "de son immatriculation au Registre national des entreprises"),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 6 — Capital social"] },
    {
      k: "texte",
      morceaux: [
        "Le capital social est fixé à cinquante mille dinars. Il est divisé en ",
        f.n("nombre_titres", PARTS),
        " parts sociales de ",
        f.m("valeur_nominale", dinars(NOMINAL)),
        " dinars chacune, ",
        f.c("declaration_liberation_integrale", "entièrement libérées", true),
        " et réparties comme suit :",
      ],
    },
  );
  f.blocs.push({
    k: "tableau",
    entetes: ["Associé", "Parts", "Apport en numéraire (DT)"],
    nombres: [1, 2],
    lignes: ASSOCIES.map((a, i) => [
      a.nom,
      { t: f.nombre(a.parts) },
      f.lm(i, "apport_numeraire_par_associe", dinars(a.parts * NOMINAL)),
    ]),
  });
  f.poseConcept(
    "repartition_titres",
    ASSOCIES.map((a) => `${a.nom} : ${a.parts}`),
  );
  f.blocs.push(
    {
      k: "texte",
      morceaux: [
        "Les fonds ont été déposés auprès de la ",
        f.c(
          "depositaire_fonds",
          "Banque Ouzrane de Développement, agence Lac Morvane",
          "Banque Ouzrane de Développement",
        ),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 9 — Cession des parts"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "clause_agrement",
          "Les parts ne peuvent être cédées à des tiers étrangers à la société qu'avec le consentement de la majorité des associés représentant au moins les trois quarts du capital.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 14 — Gérance"] },
    {
      k: "texte",
      morceaux: [
        "La société est gérée par un gérant, associé ou non. Est nommé gérant : M. ",
        ...f.liste("gerants_designes", [GERANT.nom]),
        ", ",
        f.c("gerant_duree_mandat", "pour une durée de trois ans", "P3Y"),
        ". ",
        f.c(
          "gerant_pouvoirs_limitations",
          "Le gérant a les pouvoirs les plus étendus pour agir au nom de la société ; toute acquisition ou cession d'immeuble requiert l'accord préalable des associés.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 17 — Exercice social"] },
    {
      k: "texte",
      morceaux: [
        "L'exercice social commence le 1er janvier et se termine ",
        f.c("exercice_cloture", "le 31 décembre de chaque année", "--12-31"),
        ". ",
        f.c(
          "reserve_legale_clause",
          "Il est prélevé cinq pour cent du bénéfice pour constituer la réserve légale, jusqu'à ce qu'elle atteigne le dixième du capital.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 22 — Contestations"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "clause_litiges",
          "Toute contestation relative aux affaires sociales est soumise aux tribunaux compétents du siège social.",
        ),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Fait à ",
        f.c("lieu_acte", "Tunis"),
        ", le ",
        f.d("date_acte", date, "slash"),
        ", en quatre originaux.",
      ],
    },
    { k: "signatures", gauche: "Les associés", droite: ASSOCIES.map((a) => a.nom).join(" — ") },
  );
  return {
    titre: "Statuts mis à jour",
    parties: [
      partie("entreprise", algoria("fr")),
      ...ASSOCIES.map((a) => partie("associe", { nom: a.nom })),
    ],
    signature: { code: "signatures" },
  };
}

/** 124 — extrait du Registre national des entreprises, bilingue. */
function extraitRne(f, { t, forme }) {
  const delivrance = jour(10, t.tirer(5, 28));
  const immatriculation = new Date(Date.UTC(2024, 2, 11));
  const numero = `RNE-${2026}-${String(t.tirer(100000, 999999))}`;
  const qr = `RNE${t.tirer(10000000, 99999999)}${t.tirer(1000, 9999)}`;
  const L = f.L;
  f.blocs.push(
    {
      k: "entete",
      gauche: [["République Tunisienne"], ["Registre National des Entreprises"]],
      droite: [["الجمهورية التونسية"], ["السجل الوطني للمؤسسات"]],
    },
    {
      k: "titre",
      texte: [
        f.c(
          "type_extrait",
          L("Extrait du registre — personne morale", "مضمون من السجل — شخص معنوي"),
          "extrait personne morale",
        ),
      ],
      sous: [
        L("N° d'extrait", "عدد المضمون"),
        " : ",
        f.c("numero_extrait", numero),
        " — ",
        L("Délivré le", "سلّم في"),
        " ",
        f.d("date_delivrance", delivrance, "slash"),
      ],
    },
    { k: "section", texte: L("Identification de l'entreprise", "تعريف المؤسسة") },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        [L("Identifiant unique", "المعرف الوحيد"), f.c("identifiant_unique", IDENTIFIANT_UNIQUE)],
        [L("Dénomination", "التسمية"), f.c("denomination", ALGORIA.nom)],
        [
          L("Forme juridique", "الشكل القانوني"),
          f.c("forme_juridique", L("SARL", "ش.ذ.م.م"), "SARL"),
        ],
        [L("Capital", "رأس المال"), [f.m("capital", dinars(50000)), " DT"]],
        [L("Siège social", "المقر الاجتماعي"), f.c("siege", algoria("fr").adresse)],
        [
          L("Matricule fiscal", "المعرف الجبائي"),
          f.mf("matricule_fiscal", ALGORIA.matricule, forme),
        ],
        [
          L("Date d'immatriculation", "تاريخ الترسيم"),
          f.d("date_immatriculation", immatriculation, "slash"),
        ],
        [L("Ancien n° RC", "عدد السجل التجاري القديم"), f.c("ancien_numero_rc", ALGORIA.rc)],
        [L("Statut", "الوضعية"), f.c("statut_entreprise", L("Active", "نشطة"), "active")],
        [
          L("Clôture de l'exercice", "ختم السنة المحاسبية"),
          f.c("exercice_cloture", "31/12", "--12-31"),
        ],
      ],
    },
    {
      k: "champs",
      lignes: [
        [
          L("Activité principale", "النشاط الرئيسي"),
          f.c("activite_principale", "Édition de logiciels applicatifs"),
        ],
      ],
    },
    { k: "section", texte: L("Dirigeants", "المسيرون") },
    {
      k: "tableau",
      entetes: [
        L("Nom et prénom", "الاسم واللقب"),
        L("Qualité", "الصفة"),
        L("Nationalité", "الجنسية"),
        L("Nommé le", "تاريخ التعيين"),
      ],
      lignes: [
        [
          f.c("dirigeant_nom", GERANT.nom),
          f.c("dirigeant_qualite", L("Gérant", "مسير"), "gérant"),
          f.c("dirigeant_nationalite", L("Tunisienne", "تونسية"), "tunisienne"),
          f.d("dirigeant_date_nomination", jour(6, 22), "slash"),
        ],
      ],
    },
    { k: "section", texte: L("Associés", "الشركاء") },
    {
      k: "texte",
      morceaux: f
        .liste(
          "associes_liste",
          ASSOCIES.map((a) => `${a.nom} — ${a.parts} ${L("parts", "حصة")}`),
          ASSOCIES.map((a) => a.nom),
        )
        .flatMap((p, i) => (i ? [{ br: true }, p] : [p])),
    },
    { k: "section", texte: L("Inscriptions modificatives", "الترسيمات التعديلية") },
    {
      k: "texte",
      morceaux: [
        ...f.liste("inscriptions_modificatives", [
          L(
            "Extension de l'objet social — AGE de septembre 2026",
            "توسيع الغرض الاجتماعي — جلسة عامة خارقة للعادة، سبتمبر 2026",
          ),
        ]),
      ],
    },
    {
      k: "duo",
      gauche: [
        {
          k: "texte",
          classe: "petit",
          morceaux: [
            L("Code de vérification", "رمز التثبت"),
            " : ",
            f.c("qr_code_verification", qr),
            { br: true },
            L(
              "Spécimen fictif — jeu d'essai du banc de lecture, sans valeur.",
              "نموذج وهمي — مجموعة اختبار، لا قيمة له.",
            ),
          ],
        },
      ],
      droite: [{ k: "signatures", gauche: { qr }, droite: L("Le Registre", "السجل") }],
    },
  );
  f.poseConcept("langue_extrait", "bilingue");
  f.notes.push(
    "Pièce d'une administration (RNE) : nom plain, aucun logo, mention « Spécimen fictif » imprimée — elle ne doit servir à rien d'autre qu'au banc.",
    "INCERTAIN — l'identifiant unique du RNE tenu pour les huit premiers caractères du matricule (1958330V), la date d'immatriculation et l'ancien RC sont inventés.",
  );
  return {
    titre: "Extrait du Registre national des entreprises",
    parties: [
      partie("administration", { nom: "Registre National des Entreprises", est: "administration" }),
      partie("entreprise", algoria("fr")),
      partie("dirigeant", { nom: GERANT.nom }),
    ],
    tampon: {
      partie: { nom: "REGISTRE NATIONAL DES ENTREPRISES", adresse: "Tunis", telephone: null },
      centre: "SPÉCIMEN",
      code: null,
    },
  };
}

/** 125 — décision du gérant (ouverture d'un établissement secondaire à Sfax). */
function decisionGerant(f, { t }) {
  const date = jour(10, t.tirer(2, 20));
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("denomination", ALGORIA.nom), cls: "gros" }],
        ["SARL au capital de 50 000 DT"],
        [algoria("fr").adresse],
      ],
      droite: [["Tunis, le ", f.d("date_decision", date, "long")]],
    },
    { k: "titre", texte: ["DÉCISION DU GÉRANT N° 2026-07"] },
    {
      k: "texte",
      morceaux: [
        "Le soussigné, M. ",
        f.c("gerant", GERANT.nom),
        ", agissant en qualité de gérant de la société, ",
        f.c(
          "fondement_pouvoir",
          "en vertu des pouvoirs qu'il tient de l'article 14 des statuts",
          "article 14 des statuts",
        ),
        ",",
      ],
    },
    { k: "texte", classe: "centre gras", morceaux: ["DÉCIDE"] },
    {
      k: "texte",
      morceaux: [
        "Objet : ",
        f.c(
          "objet",
          "Ouverture d'un établissement secondaire",
          "ouverture d'un établissement secondaire",
        ),
        { br: true },
        f.c(
          "texte",
          "L'ouverture d'un dépôt de matériel informatique, établissement secondaire de la société, à la zone industrielle de Boudiane, lot 31, 3064 Sfax, à compter du 1er novembre 2026. Le gérant est chargé des formalités d'inscription au Registre national des entreprises et auprès de l'administration fiscale.",
        ),
      ],
    },
    {
      k: "texte",
      morceaux: [
        f.c(
          "ratification_requise",
          "La présente décision sera soumise à la ratification de la prochaine assemblée générale ordinaire.",
          true,
        ),
      ],
    },
    { k: "signatures", gauche: "", droite: ["Le Gérant", { br: true }, GERANT.nom] },
  );
  return {
    titre: "Décision du gérant",
    parties: [partie("entreprise", algoria("fr")), partie("dirigeant", { nom: GERANT.nom })],
    tampon: { partie: algoria("fr"), code: null },
    signature: { code: "signature_gerant" },
  };
}

/* ===================================================== achats, ventes, paiements */

/** Les lignes d'une facture du jeu, en millimes, pour qu'une pièce s'y rapporte. */
function lignesDe(facture) {
  return facture.attendu.concepts.lignes.map((l) => ({
    designation: l.designation,
    quantite: Number(l.quantite),
    pu: versMineur(l.prix_unitaire_ht, EXPOSANT),
    taux: l.taux_tva_ligne,
  }));
}
/** Base, TVA (par taux, arrondie à chaque taux) et TTC de lignes HT. */
function totaux(lignes) {
  const ht = lignes.reduce((s, l) => s + l.montant, 0n);
  const taux = [...new Set(lignes.map((l) => l.taux))];
  const tva = taux.reduce(
    (s, tx) =>
      s +
      multiplier(
        lignes.filter((l) => l.taux === tx).reduce((a, l) => a + l.montant, 0n),
        ratio(tx),
      ),
    0n,
  );
  return { ht, tva, ttc: ht + tva };
}

/** 126 — avoir REÇU d'un fournisseur (ALGORIA cliente) : retour sur la facture 050. */
function avoirRecu(f, { t, factures, forme }) {
  const facture = factures["050"];
  const e = facture.piece.emetteur;
  const date = plus(
    new Date(`${facture.attendu.concepts.date_operation}T00:00:00Z`),
    t.tirer(9, 20),
  );
  const pris = lignesDe(facture).slice(0, 2);
  const lignes = pris.map((l, i) => {
    const q = Math.max(1, Math.floor(l.quantite / (i + 2)));
    return { ...l, quantite: q, montant: l.pu * BigInt(q) };
  });
  const { ht, tva, ttc } = totaux(lignes);
  const numero = `AV-2026-${String(t.tirer(10, 99)).padStart(4, "0")}`;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("raison_sociale_emetteur", e.nom), cls: "gros" }],
        [e.adresse],
        ["Tél. : ", e.telephone],
        ["MF : ", f.mf("matricule_fiscal_emetteur", e.matricule)],
      ],
      droite: [
        [{ t: "Client", cls: "petit" }],
        [f.c("nom_client", ALGORIA.nom)],
        [f.c("adresse_client", algoria("fr").adresse)],
        ["MF : ", f.mf("matricule_fiscal_client", ALGORIA.matricule, forme)],
      ],
    },
    { k: "titre", texte: [f.c("intitule", "AVOIR", "avoir"), " N° ", f.c("numero_avoir", numero)] },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Date :", f.d("date_avoir", date, "slash")],
        [
          "Facture d'origine :",
          f.c("ref_facture_origine", facture.attendu.concepts.numero_facture),
        ],
        ["Motif :", f.c("motif", "Retour de marchandise non conforme", "retour de marchandise")],
        ["Bon de retour :", f.c("ref_bon_retour", `BR-${t.tirer(1000, 9999)}`)],
      ],
    },
    {
      k: "tableau",
      entetes: ["Désignation", "Qté", "P.U. HT", "TVA", "Montant HT"],
      nombres: [1, 2, 3, 4],
      lignes: lignes.map((l, i) => [
        f.l(i, "designation", l.designation),
        f.ln(i, "quantite", l.quantite),
        { t: f.mt(l.pu) },
        f.l(i, "taux_tva_ligne", `${l.taux} %`, l.taux),
        f.lm(i, "montant_ligne_ht", l.montant),
      ]),
      pied: [
        ["Total HT", f.m("total_ht", ht)],
        ["TVA", f.m("montant_tva", tva)],
        ["Total TTC à déduire", f.m("total_ttc", ttc)],
      ],
    },
    {
      k: "texte",
      morceaux: [`Arrêté le présent avoir à la somme de ${enToutesLettres(ttc)}.`],
    },
    { k: "signatures", gauche: "", droite: "Cachet et signature" },
  );
  f.notes.push(
    "Titre « AVOIR » : ref.titres_de_piece le range en anomalie (« Avoir : à saisir par le cabinet ») — c'est l'issue attendue, pas un refus.",
    `Se rapporte à la facture du cas 050 (${facture.attendu.concepts.numero_facture}) : mêmes désignations et mêmes prix unitaires.`,
  );
  return {
    titre: "Avoir",
    scenario: "avoir_recu",
    parties: [partie("fournisseur", e), partie("client", algoria("fr"))],
    tampon: { partie: e, code: "cachet_signature" },
    signature: { code: "cachet_signature" },
  };
}

/** 127 — avoir ÉMIS par ALGORIA (arabe) sur sa vente du cas 107 : deux clés retournées. */
function avoirEmis(f, { t, factures }) {
  const facture = factures["107"];
  const c = facture.piece.client;
  const date = plus(
    new Date(`${facture.attendu.concepts.date_operation}T00:00:00Z`),
    t.tirer(12, 30),
  );
  const l0 = lignesDe(facture)[1];
  const lignes = [{ ...l0, quantite: 2, montant: l0.pu * 2n }];
  const { ht, tva, ttc } = totaux(lignes);
  const a = algoria("ar");
  const numero = `2026/AV/${String(t.tirer(10, 99)).padStart(3, "0")}`;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("raison_sociale_emetteur", a.nom), cls: "gros" }],
        [a.adresse],
        ["المعرف الجبائي : ", f.mf("matricule_fiscal_emetteur", ALGORIA.matricule, "oriental")],
      ],
      droite: [
        ["الحريف : ", f.c("nom_client", c.nom)],
        [f.c("adresse_client", c.adresse)],
        ["المعرف الجبائي للحريف : ", f.mf("matricule_fiscal_client", c.matricule)],
      ],
    },
    {
      k: "titre",
      texte: [f.c("intitule", "إشعار دائن", "avoir"), " عدد ", f.c("numero_avoir", numero)],
    },
    {
      k: "champs",
      lignes: [
        ["التاريخ :", f.d("date_avoir", date, "inverse")],
        [
          "مرجع الفاتورة الأصلية :",
          f.c("ref_facture_origine", facture.attendu.concepts.numero_facture),
        ],
        ["السبب :", f.c("motif", "إرجاع بضاعة", "retour de marchandise")],
      ],
    },
    {
      k: "tableau",
      entetes: ["البيان", "الكمية", "سعر الوحدة", "النسبة", "المبلغ"],
      nombres: [1, 2, 3, 4],
      lignes: lignes.map((l, i) => [
        f.l(i, "designation", l.designation),
        f.ln(i, "quantite", l.quantite),
        { t: f.mt(l.pu) },
        f.l(i, "taux_tva_ligne", `${l.taux} %`, l.taux),
        f.lm(i, "montant_ligne_ht", l.montant),
      ]),
      pied: [
        ["المبلغ دون اعتبار الأداءات", f.m("total_ht", ht)],
        ["الأداء على القيمة المضافة", f.m("montant_tva", tva)],
        ["المجموع", f.m("total_ttc", ttc)],
      ],
    },
    { k: "signatures", gauche: "", droite: "الختم والإمضاء" },
  );
  f.notes.push(
    "Avoir ÉMIS par ALGORIA (le dossier est l'émetteur) : son matricule en chiffres orientaux du côté de l'émetteur ; le client est celui de la vente du cas 107.",
    "Titre « إشعار دائن » : ref.titres_de_piece le range en anomalie (avoir) — l'issue attendue.",
  );
  return {
    titre: "إشعار دائن",
    scenario: "avoir_emis",
    parties: [partie("fournisseur", { ...a, est: "dossier" }), partie("client", c)],
    tampon: { partie: { ...a, nomAr: ALGORIA.nomAr }, code: "cachet_signature" },
    signature: { code: "cachet_signature" },
  };
}

/** 128 — bon de livraison d'une enseigne de détail, valorisé (ALGORIA destinataire). */
function blImprime(f, { t, parties, forme }) {
  const e = parties.enseignes[2];
  const date = jour(10, t.tirer(6, 24));
  const pris = [];
  while (pris.length < 5) {
    const a = t.choisir(RAYON.filter((r) => r.code === "TVA19"));
    if (!pris.includes(a)) pris.push(a);
  }
  const lignes = pris.map((a) => ({
    a,
    quantite: a.serie ? t.tirer(1, 3) : t.tirer(2, 12),
    pu: horsTaxe(dinars(t.tirer(a.ttc[0], a.ttc[1])), tva19),
  }));
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ t: e.nom, cls: "gros" }],
        [f.c("nom_expediteur", e.raison)],
        [f.c("adresse_expediteur", `${e.rue}, ${e.ville}`)],
        ["MF : ", f.mf("matricule_fiscal_expediteur", e.matricule)],
      ],
      droite: [
        ["Destinataire :"],
        [f.c("nom_destinataire", ALGORIA.nom)],
        [f.c("adresse_destinataire", algoria("fr").adresse)],
        ["MF : ", f.mf("matricule_fiscal_destinataire", ALGORIA.matricule, forme)],
      ],
    },
    {
      k: "titre",
      texte: [
        "BON DE LIVRAISON N° ",
        f.c("numero_bl", `BL${e.magasin}-26-${t.tirer(10000, 99999)}`),
      ],
    },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Date de livraison :", f.d("date_bl", date, "tiret")],
        ["Votre commande :", f.c("ref_commande", `BC-ALG-2026-${t.tirer(100, 999)}`)],
        ["Transporteur :", f.c("transporteur_chauffeur", "Kessarine Transports — Walid Fenzari")],
        [
          "Véhicule :",
          f.c("immatriculation_vehicule", `${t.tirer(150, 240)} TU ${t.tirer(1000, 9999)}`),
        ],
      ],
    },
    {
      k: "tableau",
      entetes: ["Référence", "Désignation", "N° de série", "Unité", "Qté livrée", "P.U. HT"],
      nombres: [4, 5],
      lignes: lignes.map((l, i) => [
        l.a.ref,
        f.l(i, "designation", l.a.fr),
        l.a.serie ? f.l(i, "numero_lot_serie", `SN${t.tirer(10000000, 99999999)}`) : "",
        f.l(i, "unite", "pièce"),
        f.ln(i, "quantite_livree", l.quantite),
        f.lm(i, "prix_ht", l.pu),
      ]),
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        "Marchandise voyageant aux risques du destinataire. Toute réserve doit être portée sur le présent bon à la réception. La facture suit.",
      ],
    },
    {
      k: "signatures",
      gauche: "Le livreur",
      droite: "Reçu le — cachet et signature du destinataire",
    },
  );
  f.notes.push(
    "Piège : le titre « BON DE LIVRAISON » est rangé en rejet par ref.titres_de_piece (« ce n'est pas une pièce comptable ») — et c'est juste : la pièce EST un bon de livraison, sans TVA ni total. Le refus est l'issue attendue ; les champs de la grille bon_livraison restent à lire.",
  );
  return {
    titre: "Bon de livraison",
    scenario: "bl_valorise",
    parties: [
      partie("emetteur", { nom: e.raison, matricule: e.matricule }),
      partie("destinataire", algoria("fr")),
    ],
    tampon: { partie: algoria("fr"), centre: "REÇU", code: "signature_cachet_receptionnaire" },
    signature: { code: "signature_livreur" },
  };
}

/** 129 — bon de livraison d'un carnet arabe, rempli à la main (matricule dans le tampon). */
function blManuscrit(f, { t, parties }) {
  const e = parties.fournisseurs.find((x) => x.fr.startsWith("Sidmara"));
  const date = jour(10, t.tirer(3, 27));
  const articles = ACHATS.filter((a) => a.fodec && a.code === "TVA19").slice(0, 3);
  const numero = String(t.tirer(200, 999)).padStart(4, "0");
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("nom_expediteur", e.ar), cls: "gros", imp: true }],
        [
          {
            ...f.c("adresse_expediteur", `${e.numeroDeRue}، ${e.rue[1]}، ${e.villeAr}`),
            imp: true,
          },
        ],
        ["الهاتف : ", e.telephone],
      ],
      droite: [],
    },
    {
      k: "titre",
      texte: ["وصل تسليم عدد ", { ...f.c("numero_bl", numero), cls: "rouge", imp: true }],
    },
    {
      k: "champs",
      lignes: [
        ["التاريخ :", f.d("date_bl", date, "slash")],
        ["المرسل إليه :", f.c("nom_destinataire", ALGORIA.nomAr)],
        ["العنوان :", f.c("adresse_destinataire", algoria("ar").adresse)],
        ["المعرف الجبائي :", f.mf("matricule_fiscal_destinataire", ALGORIA.matricule, "oriental")],
      ],
    },
    {
      k: "tableau",
      entetes: ["البيان", "الوحدة", "الكمية"],
      nombres: [2],
      minimum: 7,
      lignes: articles.map((a, i) => [
        f.l(i, "designation", a.ar),
        f.l(i, "unite", i === 2 ? "قطعة" : "لفة", i === 2 ? "pièce" : "rouleau"),
        f.ln(i, "quantite_livree", t.tirer(2, 15)),
      ]),
    },
    { k: "signatures", gauche: "إمضاء المستلم", droite: "الختم والإمضاء" },
  );
  // Le matricule de l'expéditeur : dans son tampon seulement (sa seule occurrence).
  f.v("matricule_fiscal_expediteur", e.matricule, "matricule_fiscal_expediteur", e.matricule);
  f.notes.push(
    "Carnet arabe rempli à la main : le matricule de l'expéditeur n'est que dans son tampon ; celui d'ALGORIA (destinataire), écrit en chiffres orientaux. Titre « وصل تسليم » : non couvert par ref.titres_de_piece (motif français seulement) — INCERTAIN sur l'issue que le banc en tirera.",
  );
  return {
    titre: "وصل تسليم",
    scenario: "bl_manuscrit",
    parties: [
      partie("emetteur", { nom: e.ar, matricule: e.matricule }),
      partie("destinataire", algoria("ar")),
    ],
    tampon: {
      partie: {
        nom: e.fr,
        nomAr: e.ar,
        adresse: `${e.rue[1]}، ${e.villeAr}`,
        telephone: e.telephone,
        role: "fournisseur",
      },
      porteLeMatricule: true,
      chemin: "matricule_fiscal_expediteur",
      code: "signature_livreur",
    },
    signature: { code: "signature_livreur" },
    souche: { texte: "الأرومة", numero },
    ratures: [{ chemin: "lignes[0].quantite_livree", barre: f.nombre(t.tirer(16, 30)) }],
  };
}

/** 130 — ordre de virement d'ALGORIA (donneur d'ordre) : règlement de la facture 041. */
function ordreDeVirement(f, { t, factures }) {
  const facture = factures["041"];
  const e = facture.piece.emetteur;
  const montant = versMineur(facture.attendu.concepts.total_ttc, EXPOSANT);
  const date = jour(10, t.tirer(5, 9));
  const ag = AUTRES.agence;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ t: ALGORIA.nom, cls: "gros" }],
        [algoria("fr").adresse],
        ["Tél. : ", ALGORIA.telephone],
      ],
      droite: [
        ["À l'attention de"],
        [f.c("donneur_banque", ALGORIA.banque)],
        [ag.nom],
        [ag.adresse],
      ],
    },
    {
      k: "titre",
      texte: ["ORDRE DE VIREMENT"],
      sous: ["Réf. ", f.c("reference_virement", `OV-2026-${t.tirer(100, 999)}`)],
    },
    { k: "section", texte: "Donneur d'ordre" },
    {
      k: "champs",
      lignes: [
        ["Raison sociale :", f.c("donneur_nom", ALGORIA.nom)],
        ["RIB à débiter :", f.c("donneur_rib", ALGORIA.rib)],
      ],
    },
    { k: "section", texte: "Bénéficiaire" },
    {
      k: "champs",
      lignes: [
        ["Nom :", f.c("beneficiaire_nom", e.nom)],
        ["Adresse :", f.c("beneficiaire_adresse", e.adresse)],
        ["Banque :", f.c("beneficiaire_banque", e.banque)],
        ["RIB :", f.c("beneficiaire_rib", e.rib)],
      ],
    },
    { k: "section", texte: "Opération" },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Montant :", [f.m("montant", montant), " ", f.c("devise", "TND")]],
        ["Type :", f.c("type_virement", "Virement ordinaire", "ordinaire")],
        ["Date de l'ordre :", f.d("date_ordre", date, "slash")],
        ["Date d'exécution souhaitée :", f.d("date_execution", plus(date, 1), "slash")],
      ],
    },
    {
      k: "champs",
      lignes: [
        ["En lettres :", f.c("montant_lettres", enToutesLettres(montant))],
        ["Motif :", f.c("motif", `Règlement facture ${facture.attendu.concepts.numero_facture}`)],
      ],
    },
    {
      k: "signatures",
      gauche: "Cachet de la banque — reçu le",
      droite: "Signature autorisée du donneur d'ordre",
    },
  );
  f.notes.push(
    `Règle la facture du cas 041 (${facture.attendu.concepts.numero_facture}, TTC ${facture.attendu.concepts.total_ttc}) ; le débit se retrouve au relevé du cas 136. Aucun matricule sur la page.`,
  );
  return {
    titre: "Ordre de virement",
    scenario: "virement_emis",
    parties: [
      partie("donneur_ordre", algoria("fr")),
      partie("beneficiaire", e),
      partie("banque", { nom: ALGORIA.banque }),
    ],
    tampon: {
      partie: { nom: ALGORIA.banque, adresse: `${ag.nom}, Tunis`, telephone: ag.telephone },
      centre: "REÇU",
      code: "cachet_banque",
    },
    signature: { code: "signature_donneur" },
    lie: {
      montant,
      date: plus(date, 1),
      beneficiaire: e.nom,
      reference: f.imprime.reference_virement,
    },
  };
}

/** 131 — chèque d'ALGORIA (tireur), rempli à la main : règlement de la facture 047. */
function cheque(f, { t, factures }) {
  const facture = factures["047"];
  const e = facture.piece.emetteur;
  const montant = versMineur(facture.attendu.concepts.total_ttc, EXPOSANT);
  const date = jour(10, t.tirer(12, 16));
  const numero = String(t.tirer(1000000, 9999999));
  const ag = AUTRES.agence;
  const qr = `CHQ99017${numero}${t.tirer(100000, 999999)}`;
  f.blocs.push({
    k: "cadre",
    style: "cheque",
    blocs: [
      {
        k: "entete",
        gauche: [
          [
            {
              ...f.c("tire_banque", ALGORIA.banque.toUpperCase(), ALGORIA.banque),
              cls: "gros",
              imp: true,
            },
          ],
          [{ ...f.c("lieu_paiement", `${ag.nom} — ${ag.adresse}`, ag.adresse), imp: true }],
        ],
        droite: [
          [
            { ...f.c("denomination_cheque", "CHÈQUE", true), cls: "gros", imp: true },
            " N° ",
            { ...f.c("numero_cheque", numero), imp: true },
          ],
          ["B.P.D. ", f.m("montant_chiffres", montant), " DT"],
        ],
      },
      {
        k: "texte",
        morceaux: [
          { ...f.c("mandat_payer", "Payez contre ce chèque", true), imp: true },
          " ",
          f.c("montant_lettres", enToutesLettres(montant)),
        ],
      },
      { k: "texte", morceaux: ["à l'ordre de ", f.c("beneficiaire", e.nom)] },
      {
        k: "duo",
        gauche: [
          {
            k: "texte",
            classe: "petit",
            morceaux: [
              { barres: "barrement" },
              " ",
              {
                ...f.c("non_endossable", "Non endossable sauf au profit d'une banque", true),
                imp: true,
              },
              { br: true },
              { ...f.c("tireur_nom", ALGORIA.nom), imp: true },
              { br: true },
              "RIB ",
              { ...f.c("rib_tireur", ALGORIA.rib), imp: true },
              { br: true },
              "Valable jusqu'au ",
              { ...f.d("date_validite", jour(12, 31), "slash"), imp: true },
              " — montant maximal de la formule : ",
              { ...f.m("plafond_formule", dinars(5000)), imp: true },
              " DT",
            ],
          },
        ],
        droite: [
          {
            k: "texte",
            morceaux: [
              "À ",
              f.c("lieu_emission", "Tunis"),
              ", le ",
              f.d("date_emission", date, "court"),
            ],
          },
          { k: "signatures", gauche: { qr }, droite: "" },
        ],
      },
      {
        k: "texte",
        classe: "petit",
        morceaux: [
          { ...f.c("qr_code", qr), imp: true },
          "   ",
          { ...f.c("ligne_codage", `${numero} 99017 0001834526710 54`), imp: true, cls: "codage" },
        ],
      },
    ],
  });
  // Le barrement : deux traits, sans texte ; sa boîte est mesurée comme un champ.
  f.v("barrement", "", "barrement", true);
  f.notes.push(
    `Règle la facture du cas 047 (${facture.attendu.concepts.numero_facture}). Montant, lettres, bénéficiaire, lieu et date écrits à la main ; le reste pré-imprimé.`,
    "INCERTAIN — la formule du chèque (date de validité, plafond de la formule, code QR) suit la grille ref.grilles « cheque » ; sa conformité au modèle de la BCT n'a pas été relue. Le plafond de 5 000 DT et le code QR sont inventés.",
  );
  return {
    titre: "Chèque",
    scenario: "cheque_emis",
    parties: [partie("tireur", algoria("fr")), partie("beneficiaire", e)],
    signature: { code: "signature_tireur" },
    lie: { numero, montant, presente: plus(date, 3) },
  };
}

/** 132 — reçu d'un carnet arabe, rempli à la main : ALGORIA a payé un artisan. */
function recuManuscrit(f, { t, autres }) {
  const a = autres.artisan;
  const date = jour(10, t.tirer(5, 25));
  const montant = dinars(t.tirer(180, 640));
  const numero = String(t.tirer(100, 999)).padStart(4, "0");
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("nom_creancier", a.ar), cls: "gros", imp: true }],
        [a.adresse],
        ["الهاتف : ", a.telephone],
      ],
      droite: [],
    },
    {
      k: "titre",
      texte: [
        { ...f.c("intitule", "وصل خلاص", "reçu"), imp: true },
        " عدد ",
        { ...f.c("numero_recu", numero), cls: "rouge", imp: true },
      ],
    },
    {
      k: "champs",
      lignes: [
        ["التاريخ :", f.d("date_paiement", date, "slash")],
        ["وصلني من :", f.c("nom_debiteur", ALGORIA.nomAr)],
        ["مبلغا قدره :", [f.m("montant_recu", montant), " د"]],
        ["وذلك بعنوان :", f.c("objet_paiement", "إصلاح قنوات المياه بالمكتب")],
        ["طريقة الدفع :", f.c("mode_reglement", "نقدا", "especes")],
      ],
    },
    { k: "signatures", gauche: "", droite: "الإمضاء" },
  );
  f.v("matricule_fiscal_creancier", a.matricule, "matricule_fiscal_creancier", a.matricule);
  f.notes.push(
    "Reçu arabe manuscrit, chiffres orientaux : la valeur barrée du montant n'est jamais la valeur attendue. Le matricule du créancier n'est que dans son tampon.",
  );
  return {
    titre: "وصل خلاص",
    scenario: "recu_manuscrit",
    parties: [
      partie("creancier", { nom: a.ar, matricule: a.matricule }),
      partie("debiteur", algoria("ar")),
    ],
    tampon: {
      partie: {
        nom: a.fr,
        nomAr: a.ar,
        adresse: a.adresse,
        telephone: a.telephone,
        role: "fournisseur",
      },
      porteLeMatricule: true,
      chemin: "matricule_fiscal_creancier",
      code: "signature_creancier",
    },
    signature: { code: "signature_creancier" },
    souche: { texte: "الأرومة", numero },
    ratures: [{ chemin: "montant_recu", barre: f.mt(montant + dinars(t.tirer(20, 90))) }],
  };
}

/** 133 — quittance de loyer d'octobre (bail du cas 156) : ALGORIA preneur, payeur. */
function quittanceLoyer(f, { t, autres, commun, forme }) {
  const b = autres.bailleur;
  const date = jour(10, t.tirer(2, 8));
  const { loyer, charges, refBail } = commun.bail;
  const tvaLoyer = multiplier(loyer, tva19);
  const retenue = multiplier(
    loyer,
    ratio(pourcentDe("RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS")),
  );
  const recu = loyer + tvaLoyer + charges - retenue;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("nom_creancier", b.fr), cls: "gros" }],
        [b.adresse],
        ["MF : ", f.mf("matricule_fiscal_creancier", b.matricule)],
      ],
      droite: [
        ["Locataire :"],
        [f.c("nom_debiteur", ALGORIA.nom)],
        ["MF : ", f.mf("matricule_fiscal_debiteur", ALGORIA.matricule, forme)],
      ],
    },
    {
      k: "titre",
      texte: [
        f.c("intitule", "QUITTANCE DE LOYER", "quittance de loyer"),
        " N° ",
        f.c("numero_recu", `Q-2026-10-${t.tirer(10, 99)}`),
      ],
    },
    {
      k: "champs",
      lignes: [
        ["Local loué :", f.c("adresse_bien_loue", AUTRES.local)],
        ["Contrat de bail :", f.c("ref_contrat_bail", refBail)],
        ["Période :", f.c("periode_loyer", "octobre 2026", periode(jour(10, 1), dernierJour(10)))],
      ],
    },
    {
      k: "tableau",
      entetes: ["Libellé", "Montant (DT)"],
      nombres: [1],
      lignes: [
        ["Loyer principal HT", f.m("montant_loyer_principal", loyer)],
        ["TVA 19 %", f.m("tva_loyer", tvaLoyer)],
        ["Charges communes", f.m("charges", charges)],
        [
          "Retenue à la source 10 % (sur le loyer HT)",
          ["− ", f.m("retenue_source_loyer", retenue)],
        ],
      ],
      pied: [["Net reçu", f.m("montant_recu", recu)]],
    },
    {
      k: "texte",
      morceaux: [
        "Reçu le ",
        f.d("date_paiement", date, "long"),
        " par ",
        f.c("mode_reglement", "virement bancaire", "virement"),
        ", pour solde du loyer et des charges de la période ci-dessus, sous réserve de tous droits.",
      ],
    },
    { k: "signatures", gauche: "", droite: "Le bailleur" },
  );
  f.notes.push(
    "Net reçu = loyer HT + TVA + charges − retenue à la source.",
    "INCERTAIN — retenue à la source sur loyers au taux relevé (RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS, 10 %), assise ici sur le loyer HT : l'assiette (HT ou TTC) n'a pas été relue.",
  );
  return {
    titre: "Quittance de loyer",
    scenario: "quittance_loyer",
    parties: [
      partie("creancier", { nom: b.fr, matricule: b.matricule }),
      partie("debiteur", algoria("fr")),
    ],
    tampon: {
      partie: { nom: b.fr, adresse: b.adresse, telephone: b.telephone },
      code: "signature_creancier",
    },
    signature: { code: "signature_creancier" },
    lie: { date, montant: recu },
  };
}

/* ================================================ frais, banque, caisse, paie */

/** 134 — note de frais imprimée : mission à Sfax d'un consultant. */
function noteDeFraisImprimee(f, { t }) {
  const s = SALARIES[2];
  const debut = jour(10, t.tirer(6, 12));
  const depenses = [
    ["Transport", "Louage Tunis — Sfax, aller-retour", null, dinars(t.tirer(38, 52))],
    ["Hébergement", "Hôtel, 2 nuitées", "TVA13", dinars(t.tirer(260, 420))],
    [
      "Restauration",
      "Repas d'affaires avec le client",
      "TVA07",
      dinars(t.tirer(70, 160)) + BigInt(t.tirer(0, 10)) * 100n,
    ],
    ["Stationnement", "Parking aéroport", "TVA19", dinars(t.tirer(12, 30))],
  ];
  const lignes = depenses.map(([categorie, objet, code, ttc], k) => ({
    categorie,
    objet,
    ttc,
    tva: code ? ttc - horsTaxe(ttc, tauxDe(code)) : null,
    date: plus(debut, Math.min(k, 2)),
  }));
  const total = lignes.reduce((a, l) => a + l.ttc, 0n);
  const avance = dinars(200);
  f.blocs.push(
    {
      k: "entete",
      gauche: [[{ t: ALGORIA.nom, cls: "gros" }], [algoria("fr").adresse]],
      droite: [["Date : ", f.d("date_note", plus(debut, 4), "slash")]],
    },
    { k: "titre", texte: ["NOTE DE FRAIS"] },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Salarié :", f.c("nom_salarie", s.nom)],
        ["Matricule :", f.c("matricule_salarie", s.interne)],
        [
          "Mission :",
          f.c(
            "periode_ou_mission",
            `Sfax, du ${f.dateTexte(debut, "slash")} au ${f.dateTexte(plus(debut, 2), "slash")}`,
            periode(debut, plus(debut, 2)),
          ),
        ],
        ["Objet :", f.c("objet_professionnel", "Déploiement de RegFlow chez un client")],
      ],
    },
    {
      k: "tableau",
      entetes: ["Date", "Catégorie", "Détail", "Montant TTC", "dont TVA"],
      nombres: [3, 4],
      lignes: lignes.map((l, i) => [
        f.ld(i, "date_depense", l.date, "slash"),
        f.l(i, "categorie_depense", l.categorie, l.categorie.toLowerCase()),
        l.objet,
        f.lm(i, "montant_ttc_ligne", l.ttc),
        l.tva === null ? "—" : f.lm(i, "tva_recuperable_ligne", l.tva),
      ]),
      pied: [
        ["Total des frais", f.m("total_frais", total)],
        ["Avance reçue", f.m("avance_recue", avance)],
        ["Net à rembourser", f.m("net_a_rembourser", total - avance)],
      ],
    },
    { k: "texte", morceaux: [f.c("justificatif_joint", "Justificatifs joints : 4 pièces", true)] },
    { k: "signatures", gauche: "Signature du salarié", droite: "Visa du responsable" },
  );
  f.notes.push(
    "Net à rembourser = total des frais − avance. La TVA de chaque ligne est le TTC moins son HT au taux du référentiel (hébergement 13 %, repas 7 %, parking 19 % : choix du banc, comme pour les factures).",
  );
  return {
    titre: "Note de frais",
    scenario: "note_frais",
    parties: [partie("employeur", algoria("fr")), partie("salarie", { nom: s.nom })],
    tampon: { partie: algoria("fr"), code: "visa_responsable" },
    signature: { code: "signature_salarie" },
  };
}

/** 135 — note de frais sur le formulaire d'ALGORIA, remplie à la main. */
function noteDeFraisManuscrite(f, { t }) {
  const s = SALARIES[0];
  const date = jour(10, t.tirer(20, 28));
  const km = t.tirer(120, 190);
  const lignes = [
    [plus(date, -6), "Déplacement — véhicule personnel", dinars(t.tirer(60, 95)), true],
    [plus(date, -5), "Inscription au salon", dinars(t.tirer(120, 180)), false],
    [plus(date, -5), "Déjeuner", dinars(t.tirer(25, 48)), false],
  ];
  const total = lignes.reduce((a, l) => a + l[2], 0n);
  f.blocs.push(
    {
      k: "entete",
      gauche: [[{ t: ALGORIA.nom, cls: "gros" }], ["Formulaire RH-07 — note de frais"]],
      droite: [["Date : ", f.d("date_note", date, "court")]],
    },
    { k: "titre", texte: ["NOTE DE FRAIS"] },
    {
      k: "champs",
      lignes: [
        ["Nom et prénom :", f.c("nom_salarie", s.nom)],
        ["Mission :", f.c("objet_professionnel", "Salon Selvarine des données, Hammamet")],
      ],
    },
    {
      k: "tableau",
      entetes: ["Date", "Nature", "Km", "Montant"],
      nombres: [2, 3],
      minimum: 6,
      lignes: lignes.map(([d, nature, montant, voiture], i) => [
        f.ld(i, "date_depense", d, "court"),
        nature,
        voiture ? f.ln(i, "kilometrage", km) : "",
        f.lm(i, "montant_ttc_ligne", montant),
      ]),
      pied: [["Total", f.m("total_frais", total)]],
    },
    { k: "signatures", gauche: "Visa du responsable", droite: "Signature du salarié" },
  );
  f.notes.push(
    "Formulaire pré-imprimé : en-tête et libellés imprimés, valeurs écrites à la main ; pas d'avance, le total vaut le net (non imprimé).",
  );
  return {
    titre: "Note de frais",
    scenario: "note_frais_manuscrite",
    parties: [partie("employeur", algoria("fr")), partie("salarie", { nom: s.nom })],
    signature: { code: "signature_salarie" },
  };
}

/**
 * Un relevé de compte : ses mouvements triés par date, le solde après chacun,
 * et l'identité solde initial + crédits − débits = solde final.
 */
function mouvements(initial, operations) {
  const tries = [...operations].sort((a, b) => a.date - b.date || a.rang - b.rang);
  let solde = initial;
  for (const o of tries) {
    solde += o.credit ? o.montant : -o.montant;
    o.solde = solde;
  }
  const debits = tries.filter((o) => !o.credit).reduce((s, o) => s + o.montant, 0n);
  const credits = tries.filter((o) => o.credit).reduce((s, o) => s + o.montant, 0n);
  if (initial + credits - debits !== solde)
    throw new Error("relevé : le solde final ne se retrouve pas");
  return { tries, debits, credits, final: solde };
}

/** 136 — relevé d'octobre 2026 d'ALGORIA (titulaire), où se retrouvent ses paiements. */
function releveOctobre(f, { t, lies, autres, forme }) {
  const ag = AUTRES.agence;
  const banque = autres.banqueOuzrane;
  const initial = dinars(t.tirer(118000, 165000)) + BigInt(t.tirer(0, 1000));
  const frais = dinars(t.tirer(18, 35));
  const tvaFrais = multiplier(frais, tva19);
  let rang = 0;
  const op = (date, libelle, montant, credit, extra = {}) => ({
    date,
    libelle,
    montant,
    credit,
    rang: rang++,
    ...extra,
  });
  const ops = [
    op(
      lies.certificat.datePaiement,
      `VIR RECU ${lies.certificat.payeur.toUpperCase()}`,
      lies.certificat.net,
      true,
      { complement: lies.certificat.factures },
    ),
    op(lies.quittance.date, "VIR EMIS LOYER OCT 2026 VARZANE", lies.quittance.montant, false),
    op(
      lies.virement.date,
      `VIR EMIS ${lies.virement.beneficiaire.toUpperCase()}`,
      lies.virement.montant,
      false,
      { reference: lies.virement.reference },
    ),
    op(
      jour(10, 9),
      "VIR RECU CLINIQUE TARVILA SARL",
      dinars(t.tirer(6000, 14000)) + BigInt(t.tirer(0, 1000)),
      true,
    ),
    op(lies.cnss.date, "PRLV CNSS COTISATIONS T3 2026", lies.cnss.montant, false),
    op(lies.cheque.presente, `CHEQUE N° ${lies.cheque.numero}`, lies.cheque.montant, false, {
      cheque: lies.cheque.numero,
    }),
    op(lies.dgi.date, "PAIEMENT TELEDECLARATION DGI 09/2026", lies.dgi.montant, false),
    op(
      jour(10, 22),
      "VIR RECU BANQUE REZVANE D'ESSAI",
      dinars(t.tirer(9000, 30000)) + BigInt(t.tirer(0, 1000)),
      true,
    ),
    op(
      jour(10, 27),
      "VIR EMIS SALAIRES OCTOBRE 2026",
      dinars(t.tirer(14000, 17000)) + BigInt(t.tirer(0, 1000)),
      false,
    ),
    op(jour(10, 31), "FRAIS TENUE DE COMPTE T4", frais, false),
    op(jour(10, 31), "TVA SUR COMMISSIONS", tvaFrais, false),
  ];
  const { tries, debits, credits, final } = mouvements(initial, ops);
  const sens = (m) => (m >= 0n ? "C" : "D");
  const abs = (m) => (m < 0n ? -m : m);
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("banque_nom", ALGORIA.banque.toUpperCase(), ALGORIA.banque), cls: "gros" }],
        [f.c("banque_agence_nom", ag.nom), " — code agence ", f.c("banque_agence_code", ag.code)],
        [f.c("banque_agence_adresse", ag.adresse)],
        [
          "Tél. ",
          f.c("banque_agence_telephone", ag.telephone),
          " — BIC ",
          f.c("banque_bic", ag.bic),
        ],
        ["MF : ", f.mf("banque_matricule_fiscal", banque.matricule)],
      ],
      droite: [
        [f.c("compte_titulaire_nom", ALGORIA.nom)],
        [f.c("compte_titulaire_adresse", algoria("fr").adresse)],
        ["MF : ", f.mf("compte_titulaire_matricule_fiscal", ALGORIA.matricule, forme)],
        ["Client n° ", f.c("compte_titulaire_id_client", `C${t.tirer(100000, 999999)}`)],
      ],
    },
    {
      k: "titre",
      texte: ["RELEVÉ DE COMPTE N° ", f.c("releve_numero", "10/2026")],
      sous: [
        "Période du ",
        f.d("periode_debut", jour(10, 1), "slash"),
        " au ",
        f.d("periode_fin", jour(10, 31), "slash"),
      ],
    },
    {
      k: "champs",
      colonnes: 3,
      lignes: [
        ["Compte :", f.c("compte_numero", "0001834526710")],
        ["RIB :", f.c("compte_rib", ALGORIA.rib)],
        ["Clé :", f.c("compte_cle_rib", ALGORIA.rib.slice(-2))],
        ["Type :", f.c("compte_type", "Compte courant", "courant")],
        ["Devise :", f.c("compte_devise", "TND")],
        ["Édité le :", f.d("date_edition", jour(11, 2), "slash")],
      ],
    },
    {
      k: "tableau",
      entetes: ["Date", "Valeur", "Libellé", "Débit", "Crédit", "Solde"],
      nombres: [3, 4, 5],
      lignes: [
        [
          { t: f.dateTexte(jour(10, 1)) },
          "",
          [
            "SOLDE AU ",
            f.d("solde_initial_date", jour(9, 30), "slash"),
            " (",
            f.c("solde_initial_sens", sens(initial)),
            ")",
          ],
          "",
          "",
          f.m("solde_initial", abs(initial)),
        ],
        ...tries.map((o, i) => {
          f.poseConcept(`lignes[${i}].ligne_sens`, o.credit ? "credit" : "debit");
          return [
            f.ld(i, "ligne_date_operation", o.date, "point"),
            f.ld(i, "ligne_date_valeur", plus(o.date, o.credit ? 1 : 0), "point"),
            [
              f.l(i, "ligne_libelle", o.libelle),
              ...(o.complement
                ? [{ br: true }, f.l(i, "ligne_libelle_complementaire", o.complement)]
                : []),
              ...(o.reference ? [" ", f.l(i, "ligne_reference", o.reference)] : []),
            ],
            o.credit ? "" : f.lm(i, "ligne_debit", o.montant),
            o.credit ? f.lm(i, "ligne_credit", o.montant) : "",
            f.lm(i, "ligne_solde_apres", o.solde),
          ];
        }),
      ],
      pied: [
        ["Total des débits", f.m("total_debits", debits)],
        ["Total des crédits", f.m("total_credits", credits)],
        [
          [
            "Solde au ",
            f.d("solde_final_date", jour(10, 31), "slash"),
            " (",
            f.c("solde_final_sens", sens(final)),
            ")",
          ],
          f.m("solde_final", abs(final)),
        ],
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        "Nombre d'opérations : ",
        f.n("nombre_operations", tries.length),
        ". Dont TVA sur commissions : ",
        f.m("tva_sur_commissions", tvaFrais),
        " DT. ",
        f.c(
          "mention_reclamation",
          "Toute réclamation doit nous parvenir dans un délai de 30 jours à compter de la date d'édition du présent relevé.",
        ),
      ],
    },
  );
  tries.forEach((o, i) => {
    if (o.cheque) f.poseConcept(`lignes[${i}].ligne_numero_cheque`, o.cheque);
  });
  f.notes.push(
    "Solde initial + total des crédits − total des débits = solde final ; le solde après chaque ligne se recalcule.",
    "Lignes liées : virement reçu du cas 152 (net servi après retenue), loyer du cas 133, virement du cas 130, cotisations CNSS du cas 144, chèque du cas 131, paiement de la déclaration du cas 142.",
    "Le numéro du chèque est imprimé dans le libellé « CHEQUE N° … » : ligne_numero_cheque se lit dans ligne_libelle.",
  );
  return {
    titre: "Relevé de compte",
    scenario: "releve_mensuel",
    parties: [
      partie("banque", { nom: ALGORIA.banque, matricule: banque.matricule }),
      partie("titulaire_compte", algoria("fr")),
    ],
  };
}

/** 137 — relevé de septembre, bilingue, d'un second compte (Crédit Selvane). */
function releveSeptembre(f, { t, autres }) {
  const ag = AUTRES.agenceSelvane;
  const banque = autres.banqueSelvane;
  const rib = autres.ribSelvane;
  const initial = dinars(t.tirer(8000, 22000)) + BigInt(t.tirer(0, 1000));
  let rang = 0;
  const op = (j, libelle, credit, a, b) => ({
    date: jour(9, j),
    libelle,
    credit,
    montant: dinars(t.tirer(a, b)) + BigInt(t.tirer(0, 1000)),
    rang: rang++,
  });
  const ops = [
    op(2, "VIR RECU ASSURANCES KELMOUN SA", true, 9000, 20000),
    op(4, "CARTE 0417 MARVELLE PAPETERIE", false, 40, 160),
    op(9, "PRLV TELECOM ABONNEMENT FIBRE", false, 120, 260),
    op(12, "VIR RECU CABINET GHORVANE AUDIT", true, 3000, 9000),
    op(16, "RETRAIT DAB AGENCE ENNASR", false, 200, 600),
    op(23, "VIR EMIS QALMIRA FOURNITURES", false, 900, 3000),
    op(29, "COMMISSION VIREMENTS", false, 4, 12),
  ];
  const { tries, debits, credits, final } = mouvements(initial, ops);
  const L = f.L;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("banque_nom", "CRÉDIT SELVANE", "Crédit Selvane"), cls: "gros" }],
        [f.c("banque_agence_nom", ag.nom)],
        [ag.adresse],
        ["MF : ", f.mf("banque_matricule_fiscal", banque.matricule, "compact")],
      ],
      droite: [[f.c("compte_titulaire_nom", ALGORIA.nom)], [algoria("fr").adresse]],
    },
    {
      k: "titre",
      texte: [L("Extrait de compte", "كشف حساب")],
      sous: [
        f.d("periode_debut", jour(9, 1), "slash"),
        " — ",
        f.d("periode_fin", jour(9, 30), "slash"),
      ],
    },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        [L("RIB", "المعرف البنكي"), f.c("compte_rib", rib)],
        [L("Devise", "العملة"), f.c("compte_devise", "TND")],
      ],
    },
    {
      k: "tableau",
      entetes: [
        L("Date", "التاريخ"),
        L("Opération", "العملية"),
        L("Débit", "مدين"),
        L("Crédit", "دائن"),
      ],
      nombres: [2, 3],
      lignes: [
        [
          "",
          [
            L("Ancien solde", "الرصيد السابق"),
            " ",
            f.c("solde_initial_sens", L("créditeur", "دائن"), "C"),
          ],
          "",
          f.m("solde_initial", initial),
        ],
        ...tries.map((o, i) => {
          f.poseConcept(`lignes[${i}].ligne_sens`, o.credit ? "credit" : "debit");
          return [
            f.ld(i, "ligne_date_operation", o.date, "court"),
            f.l(i, "ligne_libelle", o.libelle),
            o.credit ? "" : f.lm(i, "ligne_debit", o.montant),
            o.credit ? f.lm(i, "ligne_credit", o.montant) : "",
          ];
        }),
        ["", L("Totaux", "المجاميع"), f.m("total_debits", debits), f.m("total_credits", credits)],
        [
          "",
          [
            L("Nouveau solde", "الرصيد الجديد"),
            " ",
            f.c("solde_final_sens", L("créditeur", "دائن"), "C"),
          ],
          "",
          f.m("solde_final", final),
        ],
      ],
    },
  );
  f.notes.push(
    "Ancien solde + crédits − débits = nouveau solde. Les dates des soldes ne sont pas imprimées : elles restent « non imprimées », et la période n'en tient pas lieu.",
  );
  return {
    titre: "Extrait de compte",
    scenario: "releve_bilingue",
    parties: [
      partie("banque", { nom: "Crédit Selvane", matricule: banque.matricule }),
      partie("titulaire_compte", algoria("fr")),
    ],
  };
}

/** Les lignes d'un ticket (prix TTC), et la TVA de chaque taux : TTC − HT. */
function ventilation(lignes) {
  const taux = [...new Set(lignes.map((l) => l.code))].sort();
  return taux.map((code) => {
    const ttc = lignes.filter((l) => l.code === code).reduce((s, l) => s + l.total, 0n);
    const ht = horsTaxe(ttc, tauxDe(code));
    return { code, taux: pct(tauxDe(code)), ttc, ht, tva: ttc - ht };
  });
}

/** 138 — ticket de caisse d'une papeterie, payé en espèces (photo). */
function ticketPapeterie(f, { t, autres }) {
  const m = autres.papeterie;
  const quand = jour(10, t.tirer(5, 28));
  const heure = `${deux(t.tirer(9, 19))}:${deux(t.tirer(0, 60))}`;
  const pris = ["PAP-A4-80", "PIL-AA4", "USB64-K32", "CBL-C6-3M"].map((r) =>
    RAYON.find((a) => a.ref === r),
  );
  const lignes = pris.map((a) => {
    const q = a.ref === "PAP-A4-80" ? t.tirer(2, 6) : 1;
    const pu = dinars(t.tirer(a.ttc[0], a.ttc[1])) + BigInt(t.choisir([0, 500, 900]));
    return { a, q, pu, total: pu * BigInt(q), code: a.code };
  });
  const total = lignes.reduce((s, l) => s + l.total, 0n);
  const recu = (total / UNITE / 10n + 1n) * 10n * UNITE;
  const tva = ventilation(lignes);
  f.blocs.push({
    k: "rouleau",
    blocs: [
      { k: "titre", texte: [f.c("enseigne", m.enseigne)] },
      {
        k: "texte",
        classe: "centre",
        morceaux: [
          f.c("adresse_magasin", m.adresse),
          { br: true },
          "MF ",
          f.mf("matricule_fiscal_emetteur", m.matricule, "compact"),
        ],
      },
      {
        k: "texte",
        classe: "centre",
        morceaux: [
          "Ticket ",
          f.c("numero_ticket", `T${t.tirer(100000, 999999)}`),
          { br: true },
          f.c("date_heure", `${f.dateTexte(quand, "slash")} ${heure}`, `${iso(quand)}T${heure}`),
          "  ",
          f.c("caisse_caissier", "Caisse 02 / Rania"),
        ],
      },
      {
        k: "tableau",
        entetes: ["Article", "Qté", "Montant"],
        nombres: [1, 2],
        lignes: lignes.map((l, i) => [
          f.l(i, "designation", l.a.fr),
          f.ln(i, "quantite", l.q),
          f.lm(i, "prix_ttc_ligne", l.total),
        ]),
      },
      { k: "section", texte: ["TOTAL TTC   ", f.m("total_ttc", total)] },
      {
        k: "champs",
        lignes: [
          [
            f.c("mode_reglement", "ESPECES", "especes"),
            f.v("montant_recu_rendu.recu", f.mt(recu), "montant_recu_rendu[recu]", f.dec(recu)),
          ],
          [
            "RENDU",
            f.v(
              "montant_recu_rendu.rendu",
              f.mt(recu - total),
              "montant_recu_rendu[rendu]",
              f.dec(recu - total),
            ),
          ],
          ...tva.map((v) => [
            `TVA ${v.taux} % sur ${f.mt(v.ht)}`,
            f.v(
              `ventilation_tva.${v.taux}`,
              f.mt(v.tva),
              `ventilation_tva[${v.taux}]`,
              f.dec(v.tva),
            ),
          ]),
        ],
      },
      {
        k: "texte",
        classe: "centre",
        morceaux: ["Merci de votre visite — ni repris ni échangé sans ce ticket"],
      },
    ],
  });
  f.notes.push(
    "Ticket anonyme : ALGORIA (l'acheteur) n'y figure pas. Reçu − total = rendu ; TVA par taux = TTC − HT (`ventilation_tva` par taux, comme `montant_tva_par_taux` d'une facture ; `montant_recu_rendu` en { recu, rendu }).",
  );
  return {
    titre: "Ticket de caisse",
    scenario: "ticket_especes",
    parties: [partie("fournisseur", { nom: m.enseigne, matricule: m.matricule })],
  };
}

/** 139 — ticket de caisse arabe d'une supérette, payé par carte, deux taux (PDF-image). */
function ticketSuperette(f, { t, autres }) {
  const m = autres.superette;
  const quand = jour(10, t.tirer(5, 28));
  const heure = `${deux(t.tirer(8, 21))}:${deux(t.tirer(0, 60))}`;
  const articles = [
    ["قهوة حبوب، كيس 1 كغ", "TVA07", [32, 58]],
    ["مياه معدنية، حزمة 6 × 1,5 لتر", "TVA07", [4, 7]],
    ["أكواب ورقية، 50 قطعة", "TVA19", [3, 6]],
    ["مناديل ورقية، علبة", "TVA19", [2, 5]],
    ["سكر، كيس 1 كغ", "TVA07", [1, 3]],
  ];
  const lignes = articles.map(([nom, code, [a, b]]) => {
    const q = t.tirer(1, 4);
    const pu = dinars(t.tirer(a, b)) + BigInt(t.choisir([0, 250, 450, 800]));
    return { nom, q, total: pu * BigInt(q), code };
  });
  const total = lignes.reduce((s, l) => s + l.total, 0n);
  const tva = ventilation(lignes);
  f.blocs.push({
    k: "rouleau",
    blocs: [
      { k: "titre", texte: [f.c("enseigne", m.enseigne)] },
      {
        k: "texte",
        classe: "centre",
        morceaux: [
          f.c("adresse_magasin", m.adresse),
          { br: true },
          "م.ج ",
          f.mf("matricule_fiscal_emetteur", m.matricule),
        ],
      },
      {
        k: "texte",
        classe: "centre",
        morceaux: [
          "تذكرة عدد ",
          f.c("numero_ticket", String(t.tirer(10000, 99999))),
          { br: true },
          f.c("date_heure", `${f.dateTexte(quand, "slash")} ${heure}`, `${iso(quand)}T${heure}`),
        ],
      },
      {
        k: "tableau",
        entetes: ["البيان", "الكمية", "المبلغ"],
        nombres: [1, 2],
        lignes: lignes.map((l, i) => [
          f.l(i, "designation", l.nom),
          f.ln(i, "quantite", l.q),
          f.lm(i, "prix_ttc_ligne", l.total),
        ]),
      },
      { k: "section", texte: ["المجموع   ", f.m("total_ttc", total)] },
      {
        k: "champs",
        lignes: [
          ...tva.map((v) => [
            `أ.ق.م ${v.taux} %`,
            f.v(
              `ventilation_tva.${v.taux}`,
              f.mt(v.tva),
              `ventilation_tva[${v.taux}]`,
              f.dec(v.tva),
            ),
          ]),
          ["طريقة الدفع", f.c("mode_reglement", "بطاقة بنكية", "carte")],
          ["مرجع العملية", f.c("ref_transaction_carte", `${t.tirer(100000, 999999)}`)],
        ],
      },
      { k: "texte", classe: "centre", morceaux: ["شكرا على زيارتكم"] },
    ],
  });
  f.notes.push(
    "Ticket anonyme, deux taux (7 % et 19 %, choix du banc comme pour les factures) : TVA de chaque taux = TTC − HT.",
  );
  return {
    titre: "تذكرة صندوق",
    scenario: "ticket_carte",
    parties: [partie("fournisseur", { nom: m.enseigne, matricule: m.matricule })],
  };
}

/* ------------------------------------------------------------------ la paie */

/** L'IRPP annuel d'un revenu net imposable, au barème relevé (tranches en dinars, taux en %). */
function irppAnnuel(revenu) {
  let impot = 0n;
  let bas = 0n;
  for (const tranche of PARAMETRES.IRPP_BAREME.valeur.split(";")) {
    const [, haut, taux] = tranche.split(":");
    const plafond = haut === "null" ? null : dinars(haut);
    const dedans = (plafond === null || revenu < plafond ? revenu : plafond) - bas;
    if (dedans > 0n) impot += multiplier(dedans, ratio(taux));
    if (plafond === null || revenu <= plafond) break;
    bas = plafond;
  }
  return impot;
}

/**
 * La paie d'un mois : brut, CNSS salariale au taux relevé, imposable, IRPP
 * mensuel (annualisé, frais professionnels déduits, barème, divisé par douze),
 * net = brut − CNSS − IRPP. Les charges patronales aux taux relevés.
 */
function paie(elements) {
  const brut = elements.reduce((s, e) => s + e.montant, 0n);
  const cnss = multiplier(brut, ratio(pourcentDe("CNSS_RSNA_TAUX_SALARIAL")));
  const imposable = brut - cnss;
  const annuel = imposable * 12n;
  const frais = multiplier(annuel, ratio(pourcentDe("SALAIRES_FRAIS_PROFESSIONNELS_TAUX")));
  const plafond = dinars(pourcentDe("SALAIRES_FRAIS_PROFESSIONNELS_PLAFOND"));
  const base = annuel - (frais < plafond ? frais : plafond);
  const irpp = (irppAnnuel(base) + 6n) / 12n;
  const patronale = multiplier(brut, ratio(pourcentDe("CNSS_RSNA_TAUX_PATRONAL")));
  const tfp = multiplier(brut, ratio(pourcentDe("TFP_TAUX_GENERAL")));
  const foprolos = multiplier(brut, ratio(pourcentDe("FOPROLOS_TAUX")));
  return {
    brut,
    cnss,
    imposable,
    base,
    irpp,
    net: brut - cnss - irpp,
    patronale,
    tfp,
    foprolos,
    cout: brut + patronale + tfp + foprolos,
  };
}

/** Les éléments du brut d'un salarié : base, transport, présence (et heures supplémentaires). */
function elementsDuBrut(s, t, { heuresSup = false } = {}) {
  const transport = dinars(t.tirer(60, 90));
  const presence = dinars(t.tirer(40, 80));
  const sup = heuresSup ? dinars(t.tirer(90, 240)) : 0n;
  const base = dinars(s.brut) - transport - presence;
  return [
    { code: "salaire_base", fr: "Salaire de base", ar: "الأجر الأساسي", montant: base },
    {
      code: "indemnite_transport",
      fr: "Indemnité de transport",
      ar: "منحة النقل",
      montant: transport,
    },
    {
      code: "indemnite_presence",
      fr: "Indemnité de présence",
      ar: "منحة الحضور",
      montant: presence,
    },
    ...(heuresSup
      ? [
          {
            code: "heures_supplementaires",
            fr: "Heures supplémentaires",
            ar: "ساعات إضافية",
            montant: sup,
          },
        ]
      : []),
  ];
}

/** 140 — bulletin de paie d'octobre 2026, avec les charges patronales. */
function bulletinOctobre(f, { t, forme }) {
  const s = SALARIES[0];
  const elements = elementsDuBrut(s, t);
  const p = paie(elements);
  const tauxCnss = pourcentDe("CNSS_RSNA_TAUX_SALARIAL");
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("employeur_raison_sociale", ALGORIA.nom), cls: "gros" }],
        [f.c("employeur_adresse", algoria("fr").adresse)],
        ["MF : ", f.mf("employeur_matricule_fiscal", ALGORIA.matricule, forme)],
        ["N° employeur CNSS : ", f.c("employeur_numero_cnss", CNSS_ALGORIA)],
      ],
      droite: [
        [{ t: "BULLETIN DE PAIE", cls: "gros" }],
        ["Période : ", f.c("periode_paie", "Octobre 2026", periode(jour(10, 1), dernierJour(10)))],
        [
          "Payé le ",
          f.d("date_paiement", jour(10, 31), "slash"),
          " par ",
          f.c("mode_paiement", "virement", "virement"),
        ],
      ],
    },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Nom et prénom :", f.c("salarie_nom_prenom", s.nom)],
        ["Matricule :", f.c("salarie_matricule_interne", s.interne)],
        [
          "N° CNSS :",
          f.c("salarie_matricule_cnss", `99${t.tirer(100000, 999999)}-${deux(t.tirer(0, 100))}`),
        ],
        ["Emploi :", f.c("emploi_poste", s.poste)],
        ["Catégorie :", f.c("categorie_echelon", s.categorie)],
        ["Entrée le :", f.d("date_entree", new Date(`${s.entree}T00:00:00Z`), "slash")],
        ["Situation :", f.c("salarie_situation_familiale", "Célibataire", "célibataire")],
        ["Contrat :", f.c("type_contrat", "CDI")],
      ],
    },
    {
      k: "tableau",
      entetes: ["Rubrique", "Base", "Taux", "À payer", "À retenir"],
      nombres: [1, 2, 3, 4],
      lignes: [
        ...elements.map((e) => [e.fr, "", "", f.m(e.code, e.montant), ""]),
        [{ t: "SALAIRE BRUT", cls: "" }, "", "", f.m("salaire_brut", p.brut), ""],
        [
          "Cotisation CNSS",
          f.m("assiette_cnss", p.brut),
          f.c("taux_cnss_salarie", `${tauxCnss.replace(".", ",")} %`, tauxCnss),
          "",
          f.m("retenue_cnss_salarie", p.cnss),
        ],
        ["Salaire imposable", "", "", f.m("salaire_imposable", p.imposable), ""],
        ["Retenue IRPP", f.m("base_annualisee", p.base), "barème", "", f.m("retenue_irpp", p.irpp)],
      ],
      pied: [["NET À PAYER", f.m("net_a_payer", p.net)]],
    },
    {
      k: "texte",
      morceaux: [
        "Arrêté le présent bulletin à la somme nette de ",
        f.c("net_en_lettres", enToutesLettres(p.net)),
        ".",
      ],
    },
    { k: "section", texte: "Charges patronales" },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["CNSS patronale :", f.m("cnss_patronale", p.patronale)],
        ["TFP :", f.m("tfp", p.tfp)],
        ["FOPROLOS :", f.m("foprolos", p.foprolos)],
        ["Coût total employeur :", f.m("cout_total_employeur", p.cout)],
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        f.c(
          "mention_conservation",
          "Dans votre intérêt, conservez ce bulletin sans limitation de durée.",
        ),
      ],
    },
  );
  f.notes.push(
    "Net = brut − CNSS salariale − IRPP. IRPP : (imposable × 12 − frais professionnels plafonnés) au barème relevé, divisé par 12 et arrondi au millime. Coût employeur = brut + CNSS patronale + TFP + FOPROLOS.",
    "INCERTAIN — les taux CNSS (9,18 % salarial, 16,57 % patronal) sont relevés en base avec la confiance « a_confirmer » ; la contribution sociale de solidarité sur salaires n'est pas appliquée (CSS_PERSONNES « non trouvé » en base). Aucune déduction pour charge de famille (salarié célibataire).",
  );
  return {
    titre: "Bulletin de paie",
    scenario: "paie_avec_charges",
    parties: [partie("employeur", algoria("fr")), partie("salarie", { nom: s.nom })],
    lie: { salarie: s.nom },
  };
}

/** 141 — bulletin de septembre, bilingue, deux colonnes, heures supplémentaires. */
function bulletinSeptembre(f, { t }) {
  const s = SALARIES[1];
  const elements = elementsDuBrut(s, t, { heuresSup: true });
  const p = paie(elements);
  const L = f.L;
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [f.c("employeur_raison_sociale", ALGORIA.nom)],
        [algoria("fr").adresse],
        ["CNSS : ", f.c("employeur_numero_cnss", CNSS_ALGORIA)],
      ],
      droite: [
        [{ t: L("Fiche de paie", "بطاقة خلاص"), cls: "gros" }],
        [
          f.c(
            "periode_paie",
            L("Septembre 2026", "سبتمبر 2026"),
            periode(jour(9, 1), dernierJour(9)),
          ),
        ],
      ],
    },
    {
      k: "champs",
      colonnes: 3,
      lignes: [
        [L("Salarié", "الأجير"), f.c("salarie_nom_prenom", s.nom)],
        [L("Matricule", "المعرف"), f.c("salarie_matricule_interne", s.interne)],
        [L("Poste", "الخطة"), f.c("emploi_poste", s.poste)],
      ],
    },
    {
      k: "duo",
      gauche: [
        { k: "section", texte: L("Gains", "المستحقات") },
        {
          k: "tableau",
          entetes: [L("Rubrique", "البيان"), L("Montant", "المبلغ")],
          nombres: [1],
          lignes: elements.map((e) => [L(e.fr, e.ar), f.m(e.code, e.montant)]),
          pied: [[L("Brut", "الخام"), f.m("salaire_brut", p.brut)]],
        },
      ],
      droite: [
        { k: "section", texte: L("Retenues", "الاقتطاعات") },
        {
          k: "tableau",
          entetes: [L("Rubrique", "البيان"), L("Montant", "المبلغ")],
          nombres: [1],
          lignes: [
            ["CNSS", f.m("retenue_cnss_salarie", p.cnss)],
            [L("IRPP", "الضريبة على الدخل"), f.m("retenue_irpp", p.irpp)],
          ],
          pied: [[L("Total", "المجموع"), f.m("total_retenues", p.cnss + p.irpp)]],
        },
      ],
    },
    {
      k: "titre",
      texte: [L("Net à payer", "الصافي للدفع"), " : ", f.m("net_a_payer", p.net), " DT"],
    },
    {
      k: "texte",
      morceaux: [
        L("Virement le", "تحويل في"),
        " ",
        f.d("date_paiement", jour(9, 30), "slash"),
        " — ",
        f.c("banque_salarie", "Crédit Selvane"),
      ],
    },
  );
  f.poseConcept("mode_paiement", "virement");
  f.notes.push(
    "Net = brut − (CNSS + IRPP), le total des retenues imprimé. Mêmes calculs et mêmes INCERTAIN que le cas 140.",
    "« Virement le … » : le mode de paiement se lit dans ce libellé (valeur attendue « virement »).",
  );
  return {
    titre: "Fiche de paie",
    scenario: "paie_deux_colonnes",
    parties: [partie("employeur", algoria("fr")), partie("salarie", { nom: s.nom })],
    lie: { nom: s.nom, brut: p.brut },
  };
}

/* ===================================================== fiscal et social */

/** L'identité d'ALGORIA en tête d'un formulaire de l'administration. */
function identification(f, forme, { activite = true, langue = "fr" } = {}) {
  const L = f.L;
  const a = algoria(langue);
  return {
    k: "champs",
    colonnes: 2,
    lignes: [
      [L("Raison sociale", "الاسم الاجتماعي"), f.c("raison_sociale", a.nom)],
      [L("Matricule fiscal", "المعرف الجبائي"), f.mf("matricule_fiscal", ALGORIA.matricule, forme)],
      [L("Adresse", "العنوان"), f.c("adresse", a.adresse)],
      ...(activite
        ? [[L("Activité", "النشاط"), f.c("activite", L("Édition de logiciels", "نشر البرمجيات"))]]
        : []),
    ],
  };
}

/** L'en-tête d'un formulaire de la DGI : noms plains, aucun logo. */
const enteteDgi = (f) => ({
  k: "entete",
  gauche: [
    ["République Tunisienne"],
    ["Ministère des Finances"],
    ["Direction Générale des Impôts"],
  ],
  droite: [["الجمهورية التونسية"], ["وزارة المالية"], ["الإدارة العامة للأداءات"]],
});

/** 142 — déclaration mensuelle de septembre : TVA à payer et droit de timbre. */
function declarationTva(f, { t, forme }) {
  const caTaxable = dinars(t.tirer(42000, 68000)) + BigInt(t.tirer(0, 1000));
  const caExonere = dinars(t.tirer(2000, 6000));
  const tvaCollectee = multiplier(caTaxable, tva19);
  const deductible = multiplier(dinars(t.tirer(9000, 21000)) + BigInt(t.tirer(0, 1000)), tva19);
  const aPayer = tvaCollectee - deductible;
  const factures = t.tirer(14, 31);
  const tarif = versMineur(droit("DROIT_TIMBRE", "facture_vente").fixedAmount, EXPOSANT);
  const timbre = tarif * BigInt(factures);
  const total = aPayer + timbre;
  const depot = jour(10, t.tirer(15, 21));
  f.blocs.push(
    enteteDgi(f),
    {
      k: "titre",
      texte: ["DÉCLARATION MENSUELLE DES IMPÔTS"],
      sous: ["Mois de ", f.c("periode", "septembre 2026", periode(jour(9, 1), dernierJour(9)))],
    },
    identification(f, forme),
    {
      k: "champs",
      colonnes: 3,
      lignes: [
        ["Nature :", f.c("nature_depot", "Initiale", "initiale")],
        ["Dépôt :", f.c("mode_depot", "Télédéclaration", "teledeclaration")],
        ["Déposée le :", f.d("date_depot", depot, "slash")],
      ],
    },
    { k: "section", texte: "I — TVA collectée" },
    {
      k: "cases",
      lignes: [
        ["01", "Chiffre d'affaires taxable à 19 %", f.m("ca_taxable_19", caTaxable)],
        ["02", "TVA au taux de 19 %", f.m("tva_19", tvaCollectee)],
        ["05", "Chiffre d'affaires exonéré", f.m("ca_exonere", caExonere)],
        ["08", "Total TVA collectée", f.m("total_tva_collectee", tvaCollectee)],
      ],
    },
    { k: "section", texte: "II — TVA déductible" },
    {
      k: "cases",
      lignes: [
        ["10", "TVA sur achats de biens et services", f.m("tva_ded_biens_services", deductible)],
        ["14", "Total TVA déductible", f.m("total_tva_deductible", deductible)],
        ["15", "TVA à payer (08 − 14)", f.m("tva_a_payer", aPayer)],
      ],
    },
    { k: "section", texte: "III — Droit de timbre sur les factures" },
    {
      k: "cases",
      lignes: [
        ["30", "Nombre de factures émises", f.n("timbre_nombre_factures", factures)],
        ["31", "Tarif unitaire", f.m("timbre_tarif", tarif)],
        ["32", "Droit de timbre dû", f.m("timbre_montant", timbre)],
      ],
    },
    { k: "section", texte: "IV — Total" },
    {
      k: "cases",
      lignes: [
        ["40", "Total des impôts dus", f.m("total_principal", total)],
        ["42", "Total à payer", f.m("total_a_payer", total)],
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        "Accusé de dépôt n° ",
        f.c("reference_accuse", `TD-2026-09-${t.tirer(1000000, 9999999)}`),
        " — paiement : ",
        f.c("mode_paiement", "prélèvement bancaire", "prelevement"),
      ],
    },
    { k: "signatures", gauche: "", droite: "Cachet et signature du contribuable" },
  );
  f.notes.push(
    "TVA à payer = TVA collectée − TVA déductible ; timbre = nombre de factures × tarif du référentiel ; total = TVA à payer + timbre. Le paiement se retrouve au relevé du cas 136.",
    "Type « declaration_tva » lu par la grille « declaration_mensuelle » : la base ne relie aucune grille au type declaration_tva (ref.grilles.document_type), et la déclaration mensuelle tunisienne porte la TVA.",
  );
  return {
    titre: "Déclaration mensuelle des impôts",
    scenario: "tva_a_payer",
    parties: [
      partie("contribuable", algoria("fr")),
      partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
    ],
    tampon: { partie: algoria("fr"), code: "signature_cachet" },
    lie: { date: depot, montant: total },
  };
}

/** 143 — déclaration mensuelle de juillet, en arabe : crédit de TVA reporté. */
function declarationTvaCredit(f, { t }) {
  const ca19 = dinars(t.tirer(14000, 24000)) + BigInt(t.tirer(0, 1000));
  const ca7 = dinars(t.tirer(1000, 3000));
  const tva19c = multiplier(ca19, tva19);
  const tva7c = multiplier(ca7, tva7);
  const collectee = tva19c + tva7c;
  const deductible = multiplier(dinars(t.tirer(16000, 26000)), tva19);
  const reporte = dinars(t.tirer(300, 1200)) + BigInt(t.tirer(0, 1000));
  const credit = deductible + reporte - collectee;
  if (credit <= 0n) throw new Error("143 : le crédit attendu n'apparaît pas");
  const factures = t.tirer(6, 14);
  const tarif = versMineur(droit("DROIT_TIMBRE", "facture_vente").fixedAmount, EXPOSANT);
  const timbre = tarif * BigInt(factures);
  const depot = jour(8, t.tirer(14, 21));
  f.blocs.push(
    enteteDgi(f),
    {
      k: "titre",
      texte: ["التصريح الشهري بالأداءات"],
      sous: ["شهر ", f.c("periode", "جويلية 2026", periode(jour(7, 1), dernierJour(7)))],
    },
    identification(f, "oriental", { activite: false, langue: "ar" }),
    { k: "section", texte: "الأداء على القيمة المضافة المستوجب" },
    {
      k: "cases",
      lignes: [
        ["01", "رقم المعاملات الخاضع بنسبة 19 %", f.m("ca_taxable_19", ca19)],
        ["02", "الأداء بنسبة 19 %", f.m("tva_19", tva19c)],
        ["03", "رقم المعاملات الخاضع بنسبة 7 %", f.m("ca_taxable_7", ca7)],
        ["04", "الأداء بنسبة 7 %", f.m("tva_7", tva7c)],
        ["08", "مجموع الأداء المستوجب", f.m("total_tva_collectee", collectee)],
      ],
    },
    { k: "section", texte: "الأداء القابل للطرح" },
    {
      k: "cases",
      lignes: [
        ["10", "الأداء على الشراءات", f.m("tva_ded_biens_services", deductible)],
        ["13", "فائض الأداء المؤجل من الشهر السابق", f.m("credit_reporte_mois_precedent", reporte)],
        ["14", "مجموع الأداء القابل للطرح", f.m("total_tva_deductible", deductible + reporte)],
        ["15", "الأداء الواجب دفعه", f.m("tva_a_payer", 0n)],
        ["16", "فائض الأداء المؤجل", f.m("credit_a_reporter", credit)],
      ],
    },
    { k: "section", texte: "معلوم الطابع الجبائي" },
    {
      k: "cases",
      lignes: [
        ["30", "عدد الفواتير", f.n("timbre_nombre_factures", factures)],
        ["32", "المبلغ", f.m("timbre_montant", timbre)],
        ["42", "المجموع الواجب دفعه", f.m("total_a_payer", timbre)],
      ],
    },
    { k: "texte", morceaux: ["تاريخ الإيداع : ", f.d("date_depot", depot, "inverse")] },
    { k: "signatures", gauche: "", droite: "ختم وإمضاء المطالب بالأداء" },
  );
  f.notes.push(
    "Crédit : TVA collectée − (TVA déductible + crédit reporté) = − crédit à reporter ; la TVA à payer est nulle et le total à payer est le seul timbre.",
  );
  return {
    titre: "التصريح الشهري بالأداءات",
    scenario: "tva_credit",
    parties: [
      partie("contribuable", algoria("ar")),
      partie("administration", { nom: "الإدارة العامة للأداءات", est: "administration" }),
    ],
    tampon: { partie: { ...algoria("ar"), nomAr: ALGORIA.nomAr }, code: "signature_cachet" },
  };
}

/** 147 — déclaration mensuelle d'août : retenues à la source, TFP et FOPROLOS. */
function declarationRetenues(f, { t, forme, commun }) {
  const masse = SALARIES.filter((s) => s.entree <= "2026-08-31").reduce(
    (a, s) => a + dinars(s.brut),
    0n,
  );
  const rasSalaires = SALARIES.filter((s) => s.entree <= "2026-08-31").reduce(
    (a, s) => a + paie([{ montant: dinars(s.brut) }]).irpp,
    0n,
  );
  const baseAchats = dinars(t.tirer(9000, 26000)) + BigInt(t.tirer(0, 1000));
  const rasAchats = multiplier(baseAchats, ratio(pourcentDe("RAS_MARCHES_ACQUISITIONS")));
  const rasLoyer = multiplier(
    commun.bail.loyer,
    ratio(pourcentDe("RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS")),
  );
  const totalRas = rasSalaires + rasAchats + rasLoyer;
  const tauxTfp = pourcentDe("TFP_TAUX_GENERAL");
  const tauxFoprolos = pourcentDe("FOPROLOS_TAUX");
  const tfp = multiplier(masse, ratio(tauxTfp));
  const foprolos = multiplier(masse, ratio(tauxFoprolos));
  const total = totalRas + tfp + foprolos;
  const depot = jour(9, t.tirer(14, 22));
  f.blocs.push(
    enteteDgi(f),
    {
      k: "titre",
      texte: ["DÉCLARATION MENSUELLE"],
      sous: [
        "Retenues à la source et taxes sur salaires — ",
        f.c("periode", "08/2026", periode(jour(8, 1), dernierJour(8))),
      ],
    },
    identification(f, forme, { activite: false }),
    { k: "section", texte: "Retenues à la source" },
    {
      k: "tableau",
      entetes: ["Nature", "Base", "Retenue"],
      nombres: [1, 2],
      lignes: [
        [
          "Traitements et salaires",
          f.m("ras_salaires_base", masse),
          f.m("ras_salaires_montant", rasSalaires),
        ],
        [
          "Marchés et acquisitions (1,5 %)",
          { t: f.mt(baseAchats) },
          f.m("ras_achats_1_5", rasAchats),
        ],
        [
          "Honoraires, commissions et loyers (10 %)",
          { t: f.mt(commun.bail.loyer) },
          f.m("ras_honoraires_10", rasLoyer),
        ],
      ],
      pied: [["Total des retenues", f.m("total_ras", totalRas)]],
    },
    { k: "section", texte: "Taxes sur les salaires" },
    {
      k: "tableau",
      entetes: ["Taxe", "Base", "Taux", "Montant"],
      nombres: [1, 2, 3],
      lignes: [
        [
          "TFP",
          f.m("tfp_base", masse),
          f.c("tfp_taux", `${tauxTfp} %`, tauxTfp),
          f.m("tfp_montant", tfp),
        ],
        [
          "FOPROLOS",
          f.m("foprolos_base", masse),
          f.c("foprolos_taux", `${tauxFoprolos} %`, tauxFoprolos),
          f.m("foprolos_montant", foprolos),
        ],
      ],
    },
    {
      k: "champs",
      lignes: [
        ["TOTAL À PAYER :", f.m("total_a_payer", total)],
        ["Déposée le :", f.d("date_depot", depot, "slash")],
      ],
    },
    { k: "signatures", gauche: "", droite: "Cachet et signature" },
  );
  f.notes.push(
    "Total = retenues (salaires + marchés + loyer) + TFP + FOPROLOS, aux taux relevés en base. Retenue sur salaires : l'IRPP mensuel de chaque salarié présent, comme au bulletin (sans indemnités).",
    "Type « declaration_impot » lu par la grille « declaration_mensuelle », que la base relie à ce type (ref.grilles.document_type).",
  );
  return {
    titre: "Déclaration mensuelle",
    scenario: "retenues_a_la_source",
    parties: [
      partie("contribuable", algoria("fr")),
      partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
    ],
    tampon: { partie: algoria("fr"), code: "signature_cachet" },
    signature: { code: "signature_cachet" },
  };
}

/** La masse salariale d'un mois d'un trimestre, salarié par salarié (CNSS). */
function salairesDuTrimestre(mois, lies) {
  return SALARIES.filter((s) => s.entree <= iso(dernierJour(mois[2]))).map((s) =>
    mois.map((m) => {
      if (s.entree > iso(dernierJour(m))) return 0n;
      // Le brut de septembre de Sana Belkorvi est celui de son bulletin (cas 141).
      if (m === 9 && lies.bulletinSeptembre && s.nom === lies.bulletinSeptembre.nom)
        return lies.bulletinSeptembre.brut;
      return dinars(s.brut);
    }),
  );
}

/** 144, 145 — déclaration trimestrielle des salaires à la CNSS. */
function declarationCnss(trimestre, bilingue) {
  return (f, { t, forme, lies }) => {
    const mois = [1, 2, 3].map((k) => (trimestre - 1) * 3 + k);
    const salaires = salairesDuTrimestre(mois, lies);
    const presents = SALARIES.filter((s) => s.entree <= iso(dernierJour(mois[2])));
    const masse = salaires.flat().reduce((a, m) => a + m, 0n);
    const taux = pourcentDe("CNSS_RSNA_TAUX_GLOBAL");
    const cotisations = multiplier(masse, ratio(taux));
    const depot = jour(mois[2] + 1, t.tirer(6, 14));
    const L = f.L;
    f.blocs.push(
      {
        k: "entete",
        gauche: [
          ["Caisse Nationale de Sécurité Sociale"],
          [L("Déclaration des salaires", "التصريح بالأجور")],
        ],
        droite: [
          ["الصندوق الوطني للضمان الاجتماعي"],
          [
            L("Trimestre", "الثلاثية"),
            " ",
            f.c("trimestre", `${trimestre}`, periode(jour(mois[0], 1), dernierJour(mois[2]))),
            " — ",
            f.c("annee", "2026", periode(jour(1, 1), jour(12, 31))),
          ],
        ],
      },
      {
        k: "titre",
        texte: [L("DÉCLARATION TRIMESTRIELLE DES SALAIRES", "التصريح الثلاثي بالأجور")],
      },
      {
        k: "champs",
        colonnes: 2,
        lignes: [
          [L("Employeur", "المؤجر"), f.c("employeur_raison_sociale", ALGORIA.nom)],
          [L("N° employeur", "رقم المؤجر"), f.c("employeur_numero_cnss", CNSS_ALGORIA)],
          [
            L("Matricule fiscal", "المعرف الجبائي"),
            f.mf("employeur_matricule_fiscal", ALGORIA.matricule, forme),
          ],
          [
            L("Régime", "النظام"),
            f.c("regime", L("Salariés non agricoles", "الأجراء غير الفلاحيين"), "RSNA"),
          ],
          ...(bilingue
            ? []
            : [
                ["Adresse", f.c("employeur_adresse", algoria("fr").adresse)],
                ["Code d'exploitation", f.c("code_exploitation", "01")],
              ]),
        ],
      },
      {
        k: "tableau",
        entetes: [
          "N°",
          L("Matricule CNSS", "رقم الضمان"),
          L("Nom et prénom", "الاسم واللقب"),
          ...mois.map((m) => (bilingue ? MOIS_AR[m - 1] : MOIS_FR[m - 1])),
          L("Trimestre", "الثلاثية"),
        ],
        nombres: [3, 4, 5, 6],
        lignes: presents.map((s, i) => {
          const [a, b, c] = salaires[i];
          return [
            f.ln(i, "ligne_ordre", i + 1),
            f.l(
              i,
              "ligne_matricule_cnss",
              `99${String(1000000 + i * 7919 + trimestre).slice(1)}-${deux((i * 37 + 11) % 97)}`,
            ),
            f.l(i, "ligne_nom_prenom", bilingue ? s.ar : s.nom),
            a ? f.lm(i, "ligne_salaire_mois1", a) : "—",
            b ? f.lm(i, "ligne_salaire_mois2", b) : "—",
            c ? f.lm(i, "ligne_salaire_mois3", c) : "—",
            f.lm(i, "ligne_salaire_trimestre", a + b + c),
          ];
        }),
      },
      {
        k: "cases",
        lignes: [
          ["A", L("Nombre de salariés", "عدد الأجراء"), f.n("nombre_salaries", presents.length)],
          [
            "B",
            L("Masse salariale déclarée", "جملة الأجور المصرح بها"),
            f.m("masse_salariale_declaree", masse),
          ],
          [
            "C",
            L("Taux global", "النسبة الجملية"),
            f.c("taux_global", `${taux.replace(".", ",")} %`, taux),
          ],
          [
            "D",
            L("Cotisations dues (B × C)", "الاشتراكات المستوجبة"),
            f.m("montant_cotisations", cotisations),
          ],
          [
            "E",
            L("Total à payer", "المبلغ الجملي للدفع"),
            f.m("montant_total_a_payer", cotisations),
          ],
        ],
      },
      {
        k: "texte",
        morceaux: [L("Déposée le", "أودعت في"), " ", f.d("date_depot", depot, "slash")],
      },
      {
        k: "signatures",
        gauche: "",
        droite: L("Cachet et signature de l'employeur", "ختم وإمضاء المؤجر"),
      },
    );
    f.notes.push(
      "Masse = Σ des salaires du trimestre (chaque ligne = mois 1 + mois 2 + mois 3) ; cotisations = masse × taux global relevé. Les numéros CNSS des salariés sont inventés (préfixe 99) ; aucun numéro de CIN n'est imprimé.",
      "INCERTAIN — taux global de 25,75 % relevé en base avec la confiance « a_confirmer » ; le taux d'accident du travail, propre à chaque employeur, n'y est pas distingué.",
    );
    return {
      titre: "Déclaration trimestrielle des salaires",
      scenario: `cnss_t${trimestre}`,
      parties: [
        partie("employeur", algoria("fr")),
        partie("administration", { nom: "CNSS", est: "administration" }),
        ...presents.map((s) => partie("salarie", { nom: s.nom })),
      ],
      tampon: { partie: algoria("fr"), code: "employeur_signature_cachet" },
      signature: { code: "signature_cachet" },
      lie: { date: plus(depot, 1), montant: cotisations },
    };
  };
}

/**
 * L'IS de l'exercice 2025 (cas 146), et sa base pour les acomptes de 2026
 * (cas 148, 149) : tiré une fois, pour que les trois pièces se répondent.
 */
function impotDe2025(t) {
  const caLocal = dinars(t.tirer(610000, 820000)) + BigInt(t.tirer(0, 1000));
  const caExport = dinars(t.tirer(40000, 90000));
  const resultat = dinars(t.tirer(95000, 140000)) + BigInt(t.tirer(0, 1000));
  const reintegrations = [
    ["Amendes et pénalités", dinars(t.tirer(300, 1200))],
    ["Cadeaux au-delà du plafond déductible", dinars(t.tirer(800, 2400))],
  ];
  const deductions = [["Reprise de provision déjà imposée", dinars(t.tirer(500, 1500))]];
  const somme = (l) => l.reduce((s, [, m]) => s + m, 0n);
  const fiscal = resultat + somme(reintegrations) - somme(deductions);
  const calcule = multiplier(fiscal, ratio(pourcentDe("IS_TAUX_DROIT_COMMUN")));
  const minimumCalcule = multiplier(caLocal, ratio(pourcentDe("IS_MIN_IMPOT_TAUX_NORMAL")));
  const plancher = dinars(pourcentDe("IS_MIN_IMPOT_PLANCHER_NORMAL"));
  const minimum = minimumCalcule > plancher ? minimumCalcule : plancher;
  const du = calcule > minimum ? calcule : minimum;
  const acomptes = dinars(t.tirer(9000, 14000)) + BigInt(t.tirer(0, 1000));
  const retenues = dinars(t.tirer(2500, 6000)) + BigInt(t.tirer(0, 1000));
  return {
    caLocal,
    caExport,
    resultat,
    reintegrations,
    deductions,
    fiscal,
    calcule,
    minimum,
    du,
    acomptes,
    retenues,
    reste: du - acomptes - retenues,
  };
}

/** 146 — déclaration annuelle de l'IS, exercice 2025. */
function declarationIs(f, { t, commun, forme }) {
  const i = commun.is2025;
  const depot = jour(3, t.tirer(10, 24));
  const tauxIs = pourcentDe("IS_TAUX_DROIT_COMMUN");
  f.blocs.push(
    enteteDgi(f),
    {
      k: "titre",
      texte: ["DÉCLARATION ANNUELLE DE L'IMPÔT SUR LES SOCIÉTÉS"],
      sous: [
        "Exercice ",
        f.c(
          "exercice",
          "2025",
          periode(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31))),
        ),
      ],
    },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        ["Raison sociale", f.c("raison_sociale", ALGORIA.nom)],
        ["Matricule fiscal", f.mf("matricule_fiscal", ALGORIA.matricule, forme)],
        ["Forme juridique", f.c("forme_juridique", "SARL")],
        ["Régime", f.c("regime_fiscal", "Régime réel", "reel")],
        ["Nature", f.c("nature_declaration", "Initiale", "initiale")],
      ],
    },
    { k: "section", texte: "Chiffre d'affaires" },
    {
      k: "cases",
      lignes: [
        ["100", "Chiffre d'affaires local TTC", f.m("ca_local_ttc", i.caLocal)],
        ["110", "Chiffre d'affaires à l'export", f.m("ca_export", i.caExport)],
        ["120", "Chiffre d'affaires total", f.m("ca_total_brut", i.caLocal + i.caExport)],
      ],
    },
    { k: "section", texte: "Détermination du résultat fiscal" },
    {
      k: "cases",
      lignes: [
        ["200", "Résultat comptable avant impôt", f.m("resultat_comptable", i.resultat)],
        ...i.reintegrations.map(([l, m], k) => [
          `21${k}`,
          ["Réintégration — ", f.v(`reintegrations.${k}`, l, "reintegrations", null)],
          { t: f.mt(m) },
        ]),
        ...i.deductions.map(([l, m], k) => [
          `23${k}`,
          ["Déduction — ", f.v(`deductions.${k}`, l, "deductions", null)],
          { t: f.mt(m) },
        ]),
        ["250", "Résultat fiscal avant déficits", f.m("resultat_fiscal_avant_deficits", i.fiscal)],
        ["260", "Bénéfice imposable", f.m("benefice_imposable", i.fiscal)],
      ],
    },
    { k: "section", texte: "Liquidation de l'impôt" },
    {
      k: "cases",
      lignes: [
        [
          "300",
          ["Impôt au taux de ", f.c("taux_is", `${tauxIs} %`, tauxIs)],
          f.m("is_calcule", i.calcule),
        ],
        ["310", "Minimum d'impôt", f.m("minimum_impot", i.minimum)],
        ["320", "Impôt dû", f.m("is_du", i.du)],
        ["330", "Acomptes provisionnels payés", f.m("acomptes_payes", i.acomptes)],
        ["340", "Retenues à la source subies", f.m("retenues_subies", i.retenues)],
        ["350", "Reste à payer", f.m("reste_a_payer", i.reste)],
      ],
    },
    {
      k: "champs",
      lignes: [
        ["Annexes :", f.c("etats_financiers", "états financiers de l'exercice joints", true)],
        ["Déposée le :", f.d("date_depot", depot, "slash")],
        ["Accusé n° :", f.c("reference_accuse", `IS-2025-${t.tirer(1000000, 9999999)}`)],
      ],
    },
    { k: "signatures", gauche: "", droite: "Cachet et signature" },
  );
  f.poseConcept(
    "reintegrations",
    i.reintegrations.map(([l]) => l),
  );
  f.poseConcept(
    "deductions",
    i.deductions.map(([l]) => l),
  );
  f.notes.push(
    "Résultat fiscal = résultat comptable + réintégrations − déductions ; IS = résultat fiscal × taux relevé (20 %) ; minimum = 0,2 % du CA local TTC, plancher 500 DT (relevés) ; impôt dû = le plus grand ; reste = dû − acomptes − retenues. L'impôt dû est la base des acomptes de 2026 (cas 148 et 149).",
    "Le résultat comptable avant impôt de cette déclaration ne se rapproche pas du bénéfice net du procès-verbal du cas 121 : deux tirages, pas une liasse.",
  );
  return {
    titre: "Déclaration annuelle de l'impôt sur les sociétés",
    scenario: "is_2025",
    parties: [
      partie("contribuable", algoria("fr")),
      partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
    ],
    tampon: { partie: algoria("fr"), code: null },
  };
}

/** 148, 149 — acompte provisionnel de 2026 sur l'IS de 2025. */
function acompte(rang, arabe) {
  return (f, { t, commun, forme }) => {
    const i = commun.is2025;
    const taux = pourcentDe("ACOMPTES_TAUX");
    const brut = multiplier(i.du, ratio(taux));
    const retenues = dinars(t.tirer(300, 1400)) + BigInt(t.tirer(0, 1000));
    const net = brut - retenues;
    const mois = rang === 1 ? 6 : 9;
    const depot = jour(mois, t.tirer(15, 27));
    const L = (fr, ar) => (arabe ? ar : fr);
    f.blocs.push(
      enteteDgi(f),
      {
        k: "titre",
        texte: [L("DÉCLARATION DE L'ACOMPTE PROVISIONNEL", "التصريح بالقسط الاحتياطي")],
        sous: [
          f.c(
            "numero_acompte",
            L(`${rang === 1 ? "1er" : "2e"} acompte`, rang === 1 ? "القسط الأول" : "القسط الثاني"),
            String(rang),
          ),
          " — ",
          f.c("nature_impot", L("Impôt sur les sociétés", "الضريبة على الشركات"), "IS"),
        ],
      },
      {
        k: "champs",
        lignes: [
          [
            L("Raison sociale", "الاسم الاجتماعي"),
            f.c("raison_sociale", arabe ? ALGORIA.nomAr : ALGORIA.nom),
          ],
          [
            L("Matricule fiscal", "المعرف الجبائي"),
            f.mf("matricule_fiscal", ALGORIA.matricule, forme),
          ],
          [
            L("Exercice de référence", "السنة المرجعية"),
            f.c(
              "exercice_reference",
              "2025",
              periode(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31))),
            ),
          ],
          [
            L("Exercice d'imputation", "سنة الخصم"),
            f.c("exercice_imputation", "2026", periode(jour(1, 1), jour(12, 31))),
          ],
        ],
      },
      {
        k: "cases",
        lignes: [
          [
            "1",
            L("Impôt dû au titre de l'exercice 2025", "الضريبة المستوجبة لسنة 2025"),
            f.m("impot_base_n_1", i.du),
          ],
          [
            "2",
            [L("Taux de l'acompte", "نسبة القسط"), " ", f.c("taux_acompte", `${taux} %`, taux)],
            f.m("montant_brut_acompte", brut),
          ],
          [
            "3",
            L("Retenues à la source imputées", "الخصم من المورد المطروح"),
            f.m("retenues_imputees", retenues),
          ],
          ["4", L("Net à payer (2 − 3)", "الصافي للدفع"), f.m("net_a_payer", net)],
        ],
      },
      {
        k: "champs",
        lignes: [
          [
            L("Date de dépôt", "تاريخ الإيداع"),
            f.d("date_depot", depot, arabe ? "inverse" : "slash"),
          ],
          [
            L("Quittance n°", "وصل عدد"),
            f.c("reference_quittance", `${t.tirer(100000, 999999)}/${mois}`),
          ],
        ],
      },
      { k: "signatures", gauche: "", droite: L("Signature", "الإمضاء") },
    );
    f.notes.push(
      `Acompte = impôt dû de 2025 (cas 146) × ${taux} % (ACOMPTES_TAUX relevé) ; net = acompte − retenues imputées.`,
    );
    return {
      titre: "Acompte provisionnel",
      scenario: `acompte_${rang}`,
      parties: [
        partie("contribuable", algoria(arabe ? "ar" : "fr")),
        partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
      ],
    };
  };
}

/** Le service fictif qui délivre une carte ou une attestation. */
const SERVICE = "Bureau de contrôle des impôts de Tunis — service fictif du banc";

/** 150 — carte d'identification fiscale (bilingue, photo) : le matricule en clair. */
function carteFiscale(f, { t }) {
  const L = f.L;
  f.blocs.push({
    k: "cadre",
    style: "carte",
    blocs: [
      {
        k: "entete",
        gauche: [["République Tunisienne"], ["Ministère des Finances"]],
        droite: [["الجمهورية التونسية"], ["وزارة المالية"]],
      },
      { k: "titre", texte: [L("CARTE D'IDENTIFICATION FISCALE", "بطاقة التعريف الجبائية")] },
      {
        k: "champs",
        lignes: [
          [
            L("Matricule fiscal", "المعرف الجبائي"),
            { ...f.mf("matricule_fiscal_complet", ALGORIA.matricule), cls: "gros" },
          ],
          [L("Raison sociale", "الاسم الاجتماعي"), f.c("raison_sociale", ALGORIA.nom)],
          [L("Nom commercial", "الاسم التجاري"), f.c("nom_commercial", "ALGORIA FACTORY")],
          [L("Forme juridique", "الشكل القانوني"), f.c("forme_juridique", "SARL")],
          [L("Activité", "النشاط"), f.c("activite", "Édition de logiciels applicatifs")],
          [L("Adresse", "العنوان"), f.c("adresse", algoria("fr").adresse)],
          [L("Régime", "النظام"), f.c("regime_fiscal", L("Réel", "حقيقي"), "reel")],
          [
            L("Début d'activité", "بداية النشاط"),
            f.d("date_debut_activite", new Date(Date.UTC(2024, 2, 11)), "slash"),
          ],
          [L("Délivrée le", "سلمت في"), f.d("date_delivrance", jour(9, t.tirer(2, 25)), "slash")],
        ],
      },
      {
        k: "duo",
        gauche: [
          {
            k: "texte",
            classe: "petit",
            morceaux: [
              f.c("service_emetteur", SERVICE),
              { br: true },
              L("Spécimen fictif — jeu d'essai, sans valeur.", "نموذج وهمي — لا قيمة له."),
            ],
          },
        ],
        droite: [{ k: "signatures", gauche: "", droite: L("Le chef de service", "رئيس المصلحة") }],
      },
    ],
  });
  for (const code of [
    "identifiant_unique",
    "cle_controle",
    "code_tva",
    "code_categorie",
    "numero_etablissement",
  ])
    f.confondus[code] = "matricule_fiscal_complet";
  const [chiffres, cle, tvaCode, cat, etab] = [
    ALGORIA.matricule.slice(0, 7),
    ALGORIA.matricule[7],
    ...ALGORIA.matricule.slice(9).split("/"),
  ];
  Object.assign(f.concepts, {
    identifiant_unique: chiffres,
    cle_controle: cle,
    code_tva: tvaCode,
    code_categorie: cat,
    numero_etablissement: etab,
  });
  f.notes.push(
    "Le matricule s'imprime UNE fois, en clair : identifiant, clé, code TVA, catégorie et établissement se lisent dedans (`confondus`).",
    "Pièce d'une administration : noms plains, aucun logo, mention « Spécimen fictif » imprimée. INCERTAIN — la mise en page de la carte réelle n'a pas été relue.",
  );
  return {
    titre: "Carte d'identification fiscale",
    scenario: "carte_fiscale",
    parties: [
      partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
      partie("contribuable", algoria("fr")),
    ],
    tampon: {
      partie: { nom: "DIRECTION GÉNÉRALE DES IMPÔTS", adresse: "Tunis", telephone: null },
      centre: "SPÉCIMEN",
      code: "cachet_signature",
    },
  };
}

/** 151 — attestation d'immatriculation fiscale (scan) : le matricule en cases. */
function attestationImmatriculation(f, { t }) {
  const [chiffres, cle, tvaCode, cat, etab] = [
    ALGORIA.matricule.slice(0, 7),
    ALGORIA.matricule[7],
    ...ALGORIA.matricule.slice(9).split("/"),
  ];
  f.blocs.push(
    enteteDgi(f),
    {
      k: "titre",
      texte: ["ATTESTATION D'IMMATRICULATION FISCALE"],
      sous: ["tenant lieu de carte d'identification fiscale"],
    },
    {
      k: "texte",
      morceaux: [
        "Le chef du service soussigné atteste que la société ",
        f.c("raison_sociale", ALGORIA.nom),
        ", ",
        f.c("forme_juridique", "société à responsabilité limitée", "SARL"),
        ", sise ",
        f.c("adresse", algoria("fr").adresse),
        ", exerçant l'activité de « ",
        f.c("activite", "édition de logiciels applicatifs"),
        " », est immatriculée au registre des contribuables sous l'identifiant suivant :",
      ],
    },
    {
      k: "tableau",
      entetes: ["Identifiant", "Clé", "Code TVA", "Catégorie", "Établissement"],
      lignes: [
        [
          f.c("identifiant_unique", chiffres),
          f.c("cle_controle", cle),
          f.c("code_tva", tvaCode),
          f.c("code_categorie", cat),
          f.c("numero_etablissement", etab),
        ],
      ],
    },
    {
      k: "champs",
      lignes: [
        ["Régime d'imposition :", f.c("regime_fiscal", "réel", "reel")],
        [
          "Date de début d'activité :",
          f.d("date_debut_activite", new Date(Date.UTC(2024, 2, 11)), "long"),
        ],
        ["Délivrée à Tunis le :", f.d("date_delivrance", jour(10, t.tirer(2, 25)), "long")],
        ["Service :", f.c("service_emetteur", SERVICE)],
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: ["Spécimen fictif — jeu d'essai du banc de lecture, sans valeur."],
    },
    { k: "signatures", gauche: "", droite: "Le chef de service" },
  );
  f.confondus.matricule_fiscal_complet = "identifiant_unique";
  f.concepts.matricule_fiscal_complet = ALGORIA.matricule;
  f.notes.push(
    "Le matricule s'imprime en cinq cases (identifiant, clé, code TVA, catégorie, établissement) et nulle part en clair : le matricule complet se reconstitue des cases (`confondus`). Aucune case ne porte à elle seule le matricule.",
  );
  return {
    titre: "Attestation d'immatriculation fiscale",
    scenario: "attestation_immatriculation",
    parties: [
      partie("administration", { nom: "Direction Générale des Impôts", est: "administration" }),
      partie("contribuable", algoria("fr")),
    ],
    tampon: {
      partie: { nom: "DIRECTION GÉNÉRALE DES IMPÔTS", adresse: "Tunis", telephone: null },
      centre: "SPÉCIMEN",
      code: "cachet_signature",
    },
    signature: { code: "cachet_signature" },
  };
}

/** 152 — certificat de retenue à la source : un client a retenu sur le paiement de la facture 103. */
function certificatRetenue(f, { t, factures, forme }) {
  const facture = factures["103"];
  const payeur = facture.piece.client;
  const brut = versMineur(facture.attendu.concepts.total_ttc, EXPOSANT);
  const taux = pourcentDe("RAS_MARCHES_ACQUISITIONS");
  const retenue = multiplier(brut, ratio(taux));
  const net = brut - retenue;
  const paiement = jour(10, t.tirer(1, 4));
  f.blocs.push(
    {
      k: "titre",
      texte: ["CERTIFICAT DE RETENUE D'IMPÔT À LA SOURCE"],
      sous: ["N° ", f.c("numero_certificat", `CRS-2026-${t.tirer(1000, 9999)}`)],
    },
    { k: "section", texte: "A — Personne ou organisme payeur" },
    {
      k: "champs",
      lignes: [
        ["Nom :", f.c("payeur_nom", payeur.nom)],
        ["Adresse :", f.c("payeur_adresse", payeur.adresse)],
        ["Matricule fiscal :", f.mf("payeur_matricule", payeur.matricule)],
      ],
    },
    { k: "section", texte: "B — Bénéficiaire" },
    {
      k: "champs",
      lignes: [
        ["Nom :", f.c("beneficiaire_nom", ALGORIA.nom)],
        ["Adresse :", f.c("beneficiaire_adresse", algoria("fr").adresse)],
        ["Matricule fiscal :", f.mf("beneficiaire_identifiant", ALGORIA.matricule, forme)],
      ],
    },
    { k: "section", texte: "C — Retenues effectuées" },
    {
      k: "tableau",
      entetes: ["Nature", "Montant brut", "Taux", "Retenue", "Net servi"],
      nombres: [1, 2, 3, 4],
      lignes: [
        [
          f.c("nature_montant", "Marchés et acquisitions de biens et services", "marches"),
          f.m("montant_brut", brut),
          f.c("taux_retenue", `${taux.replace(".", ",")} %`, taux),
          f.m("montant_retenue", retenue),
          f.m("net_servi", net),
        ],
      ],
    },
    {
      k: "champs",
      colonnes: 2,
      lignes: [
        [
          "Factures :",
          f.liste("references_factures", [facture.attendu.concepts.numero_facture])[0],
        ],
        ["Exercice :", f.c("exercice_facturation", "2026", periode(jour(1, 1), jour(12, 31)))],
        ["Payé le :", f.d("date_paiement", paiement, "slash")],
        ["Paiement :", f.c("reference_paiement", `VIR ${t.tirer(100000, 999999)}`)],
        ["Délivré le :", f.d("date_emission", plus(paiement, 1), "slash")],
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        "Je soussigné certifie exactes les informations figurant sur le présent certificat.",
      ],
    },
    { k: "signatures", gauche: "", droite: "Cachet et signature du payeur" },
  );
  f.notes.push(
    `Se rapporte à la vente du cas 103 (${facture.attendu.concepts.numero_facture}) : brut = son TTC ; retenue = brut × ${taux} % (RAS_MARCHES_ACQUISITIONS relevé, assiette TTC) ; net servi = brut − retenue, crédité au relevé du cas 136.`,
    "ALGORIA est la BÉNÉFICIAIRE (son matricule du côté du bénéficiaire) ; le payeur est son client inventé.",
  );
  return {
    titre: "Certificat de retenue à la source",
    scenario: "certificat_ras",
    parties: [partie("payeur", payeur), partie("beneficiaire", algoria("fr"))],
    tampon: { partie: payeur, code: "signature_cachet" },
    signature: { code: "signature_cachet" },
    lie: {
      datePaiement: paiement,
      payeur: payeur.nom,
      net,
      factures: `FACT ${facture.attendu.concepts.numero_facture}`,
    },
  };
}

/** 153 — attestation de travail, en arabe (ALGORIA employeur). */
function attestationTravail(f, { t }) {
  const s = SALARIES[3];
  const date = jour(10, t.tirer(5, 28));
  const a = algoria("ar");
  f.blocs.push(
    {
      k: "entete",
      gauche: [
        [{ ...f.c("employeur_raison_sociale", a.nom), cls: "gros" }],
        [f.c("employeur_adresse", a.adresse)],
        ["المعرف الجبائي : ", f.mf("employeur_matricule_fiscal", ALGORIA.matricule, "slash")],
        [
          "رقم المؤجر بالصندوق الوطني للضمان الاجتماعي : ",
          f.c("employeur_numero_cnss", CNSS_ALGORIA),
        ],
      ],
      droite: [],
    },
    { k: "titre", texte: [f.c("intitule", "شهادة عمل", "attestation de travail")] },
    {
      k: "texte",
      morceaux: [
        f.c("formule_atteste", "يشهد الممضي أسفله، مسير الشركة، أن"),
        " السيدة ",
        f.c("salarie_nom_prenom", s.ar),
        " تعمل بالشركة بخطة ",
        f.c("emploi_poste", s.posteAr),
        " منذ ",
        f.d("date_entree", new Date(`${s.entree}T00:00:00Z`), "arabe"),
        " بمقتضى ",
        f.c("type_contrat", "عقد شغل لمدة غير معينة", "CDI"),
        "، ",
        f.c("encore_en_fonction", "ولا تزال تعمل بها إلى تاريخ هذه الشهادة", true),
        ".",
      ],
    },
    {
      k: "texte",
      morceaux: [
        f.c("objet_remise", "سلمت هذه الشهادة للمعنية بالأمر بطلب منها للإدلاء بها عند الحاجة."),
      ],
    },
    { k: "texte", morceaux: ["تونس في ", f.d("lieu_date", date, "arabe")] },
    { k: "signatures", gauche: "", droite: f.c("signataire_qualite", "المسير", "gérant") },
  );
  return {
    titre: "شهادة عمل",
    scenario: "attestation_travail",
    parties: [partie("employeur", a), partie("salarie", { nom: s.ar })],
    tampon: { partie: { ...a, nomAr: ALGORIA.nomAr }, code: "employeur_signature_cachet" },
    signature: { code: "employeur_signature_cachet" },
  };
}

/* ============================================================ contrats et baux */

/** 154 — contrat de prestation et d'abonnement : ALGORIA prestataire, une clinique cliente. */
function contratCommercial(f, { t, parties, forme }) {
  const c = parties.clients.find((x) => x.fr.startsWith("Clinique"));
  const signature = jour(t.tirer(1, 4), t.tirer(5, 25));
  const effet = jour(signature.getUTCMonth() + 2, 1);
  const prix = dinars(t.tirer(36, 60) * 100);
  const reference = `ALG-CT-2026-${String(t.tirer(10, 99)).padStart(3, "0")}`;
  const p = (i, role, denomination, formeCapital, matricule, mfForme, siege, representant) => [
    f.l(i, "partie_denomination", denomination),
    ", ",
    f.l(i, "partie_forme_capital", formeCapital),
    ", matricule fiscal ",
    matricule === ALGORIA.matricule
      ? (f.dossier.push(`lignes[${i}].partie_matricule_fiscal`),
        f.l(i, "partie_matricule_fiscal", formeDuMatricule(matricule, mfForme), matricule))
      : f.l(i, "partie_matricule_fiscal", matricule),
    ", dont le siège est au ",
    f.l(i, "partie_siege", siege),
    ", représentée par ",
    f.l(i, "partie_representant", representant),
    ", ci-après « ",
    f.l(i, "partie_role", role, role.toLowerCase()),
    " »,",
  ];
  f.blocs.push(
    {
      k: "titre",
      texte: [
        f.c(
          "intitule",
          "CONTRAT DE PRESTATION DE SERVICES ET D'ABONNEMENT",
          "prestation de services",
        ),
      ],
      sous: ["Réf. ", f.c("reference", reference)],
    },
    { k: "texte", morceaux: ["ENTRE LES SOUSSIGNÉES :"] },
    {
      k: "texte",
      morceaux: p(
        0,
        "Le Prestataire",
        ALGORIA.nom,
        ALGORIA.forme,
        ALGORIA.matricule,
        forme,
        algoria("fr").adresse,
        `M. ${GERANT.nom}, gérant`,
      ),
    },
    { k: "texte", morceaux: ["ET"] },
    {
      k: "texte",
      morceaux: p(
        1,
        "Le Client",
        c.fr,
        "SARL au capital de 300 000 DT",
        c.matricule,
        "slash",
        `${c.numeroDeRue}, ${c.rue[0]}, ${c.ville}`,
        "Mme Selma Varzouki, directrice générale",
      ),
    },
    { k: "texte", classe: "gras", morceaux: ["Article 1 — Objet"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "objet",
          "Le Prestataire met à la disposition du Client la suite Malica Office (palier Foundation), en mode hébergé, et en assure le paramétrage, la maintenance et l'assistance.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 2 — Durée"] },
    {
      k: "texte",
      morceaux: [
        "Le contrat est conclu pour ",
        f.c("duree", "une durée de douze (12) mois", "P12M"),
        " à compter du ",
        f.d("date_effet", effet, "long"),
        ". ",
        f.c(
          "renouvellement",
          "Il se renouvelle par tacite reconduction pour des périodes de douze mois, sauf dénonciation par lettre recommandée deux mois avant l'échéance.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 3 — Prix et paiement"] },
    {
      k: "texte",
      morceaux: [
        "Le prix annuel de l'abonnement est de ",
        f.m("prix_montant", prix),
        " ",
        f.c("devise", "dinars tunisiens", "TND"),
        " hors taxes. ",
        f.c(
          "modalites_paiement",
          "Il est facturé trimestriellement d'avance et payable à trente jours par virement.",
        ),
        " ",
        f.c(
          "retenue_source_clause",
          "Les retenues à la source légales sont opérées par le Client, qui en remet le certificat au Prestataire.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 6 — Confidentialité et données"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "confidentialite",
          "Chaque partie garde confidentielles les informations de l'autre ; les données du Client restent sa propriété et sont hébergées en Tunisie.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 9 — Résiliation"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "resiliation",
          "En cas de manquement grave non réparé dans les trente jours d'une mise en demeure, l'autre partie peut résilier le contrat de plein droit.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 11 — Droit applicable et litiges"] },
    {
      k: "texte",
      morceaux: [
        f.c("droit_applicable", "Le présent contrat est régi par le droit tunisien."),
        " ",
        f.c("juridiction_arbitrage", "Tout litige relève des tribunaux de Tunis."),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Fait à ",
        f.c("lieu_signature", "Tunis"),
        ", le ",
        f.d("date_signature", signature, "slash"),
        ", en ",
        f.n("nombre_exemplaires", 2),
        " exemplaires originaux.",
      ],
    },
    { k: "signatures", gauche: "Pour le Client", droite: "Pour le Prestataire" },
  );
  f.notes.push(
    "Les deux parties ont chacune leur matricule, une fois : celui d'ALGORIA dans la partie « Prestataire » (lignes[0]), celui du client dans la sienne (lignes[1]).",
  );
  return {
    titre: "Contrat de prestation de services",
    scenario: "contrat_prestation",
    parties: [
      partie("partie", { ...algoria("fr"), role: "prestataire" }),
      partie("partie", { nom: c.fr, matricule: c.matricule }),
    ],
    tampon: { partie: algoria("fr"), code: "signatures" },
    signature: { code: "signatures" },
  };
}

/** 155 — contrat de travail à durée indéterminée, dactylographié (ALGORIA employeur). */
function contratCdi(f, { t, forme }) {
  const s = SALARIES.find((x) => x.entree.startsWith("2026"));
  const debut = new Date(`${s.entree}T00:00:00Z`);
  const signature = plus(debut, -t.tirer(5, 12));
  f.blocs.push(
    {
      k: "titre",
      texte: [f.c("intitule", "CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE")],
      sous: ["N° ", f.c("reference_contrat", `RH-CDI-2026-${t.tirer(10, 99)}`)],
    },
    { k: "texte", morceaux: ["Entre :"] },
    {
      k: "texte",
      morceaux: [
        f.c("employeur_raison_sociale", ALGORIA.nom),
        ", dont le siège est au ",
        f.c("employeur_adresse", algoria("fr").adresse),
        ", matricule fiscal ",
        f.mf("employeur_matricule_fiscal", ALGORIA.matricule, forme),
        ", affiliée à la CNSS sous le n° ",
        f.c("employeur_numero_cnss", CNSS_ALGORIA),
        ", représentée par son gérant, ci-après « l'Employeur », d'une part,",
      ],
    },
    { k: "texte", morceaux: ["Et :"] },
    {
      k: "texte",
      morceaux: [
        "Mme ",
        f.c("salarie_nom_prenom", s.nom),
        ", de nationalité ",
        f.c("salarie_nationalite", "tunisienne"),
        ", demeurant ",
        f.c("salarie_adresse", s.adresse),
        ", titulaire du ",
        f.c("salarie_diplome_qualification", s.diplome),
        ", ci-après « la Salariée », d'autre part.",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 1 — Engagement"] },
    {
      k: "texte",
      morceaux: [
        "La Salariée est engagée à durée indéterminée à compter du ",
        f.d("date_debut", debut, "long"),
        " en qualité d'",
        f.c("emploi_poste", s.poste),
        ", ",
        f.c("categorie_echelon", s.categorie),
        ". Elle exerce ses fonctions au ",
        f.c("lieu_travail", algoria("fr").adresse),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 2 — Période d'essai"] },
    {
      k: "texte",
      morceaux: [
        "Le présent contrat ne devient définitif qu'à l'issue d'une période d'essai de ",
        f.c("periode_essai_duree", "six mois", "P6M"),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 3 — Durée du travail"] },
    {
      k: "texte",
      morceaux: [
        "La durée du travail est de ",
        f.c("duree_hebdo", "quarante heures par semaine", "40 heures"),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 4 — Rémunération"] },
    {
      k: "texte",
      morceaux: [
        "La Salariée perçoit un salaire mensuel ",
        f.c("salaire_brut_ou_net", "brut", "brut"),
        " de ",
        f.m("salaire_base", dinars(s.brut)),
        " dinars, payable ",
        f.c("periodicite_paie", "mensuellement", "mensuelle"),
        " par virement.",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 6 — Confidentialité"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "clause_confidentialite",
          "La Salariée s'engage à ne divulguer aucune information relative aux clients, aux logiciels et aux méthodes de l'Employeur, pendant et après le contrat.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 8 — Préavis"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "preavis",
          "Chaque partie peut mettre fin au contrat moyennant un préavis d'un mois, sauf faute grave.",
        ),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Fait à Tunis, le ",
        f.d("lieu_date_signature", signature, "slash"),
        ", en ",
        f.n("nombre_exemplaires", 2),
        " exemplaires.",
      ],
    },
    { k: "signatures", gauche: "La Salariée (lu et approuvé)", droite: "L'Employeur" },
  );
  f.notes.push(
    "Salariée inventée, embauchée le 2 novembre 2026 : absente des déclarations CNSS des trimestres 2 et 3 (cas 144, 145). Aucun numéro de CIN.",
  );
  return {
    titre: "Contrat de travail à durée indéterminée",
    scenario: "contrat_cdi",
    parties: [partie("employeur", algoria("fr")), partie("salarie", { nom: s.nom })],
    tampon: { partie: algoria("fr"), code: "employeur_signature_cachet" },
    signature: { code: "signature_employeur" },
  };
}

/** 156 — bail à usage professionnel du siège (ALGORIA preneuse). */
function bailSiege(f, { t, autres, commun, forme }) {
  const b = autres.bailleur;
  const { loyer, refBail, signature, effet } = commun.bail;
  f.blocs.push(
    {
      k: "titre",
      texte: [f.c("type_bail", "CONTRAT DE BAIL À USAGE PROFESSIONNEL", "professionnel")],
      sous: [
        "Réf. ",
        refBail,
        " — ",
        f.c("forme_acte", "acte sous seing privé", "sous seing privé"),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Entre ",
        f.c("bailleur_identite", `${b.fr}, représentée par M. ${b.representant}, gérant`),
        ", matricule fiscal ",
        f.mf("bailleur_matricule_fiscal", b.matricule),
        ", agissant en qualité de ",
        f.c("titre_bailleur", "propriétaire"),
        ", ci-après « le Bailleur »,",
      ],
    },
    {
      k: "texte",
      morceaux: [
        "et ",
        f.c("preneur_identite", `${ALGORIA.nom}, représentée par son gérant M. ${GERANT.nom}`),
        ", matricule fiscal ",
        matriculeHorsGrille(f, "preneur_matricule_fiscal", forme),
        ", ci-après « le Preneur »,",
      ],
    },
    { k: "texte", morceaux: ["il a été convenu ce qui suit."] },
    { k: "texte", classe: "gras", morceaux: ["Article 1 — Désignation"] },
    {
      k: "texte",
      morceaux: [
        "Le Bailleur donne en location au Preneur ",
        f.c(
          "description_local",
          "un plateau de bureaux de 180 m² au deuxième étage, avec deux places de stationnement",
        ),
        ", sis au ",
        f.c("adresse_local", AUTRES.local),
        ", à usage de ",
        f.c("destination", "bureaux"),
        ". ",
        f.c("usage_siege_social", "Le Preneur est autorisé à y fixer son siège social.", true),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 2 — Durée"] },
    {
      k: "texte",
      morceaux: [
        "Le bail est consenti pour ",
        f.c("duree", "une durée de trois années", "P3Y"),
        " à compter du ",
        f.d("date_effet", effet, "long"),
        ". ",
        f.c("renouvellement", "Il se renouvelle par tacite reconduction d'année en année."),
        " ",
        f.c("preavis_conge", "Le congé est donné trois mois à l'avance par lettre recommandée."),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 3 — Loyer"] },
    {
      k: "texte",
      morceaux: [
        "Le loyer est fixé à ",
        f.m("loyer_montant", loyer),
        " dinars hors taxes par mois, ",
        f.c("tva_loyer", "majoré de la TVA au taux en vigueur", true),
        ", payable ",
        f.c("periodicite", "mensuellement", "mensuelle"),
        " : ",
        f.c(
          "modalites_paiement",
          "d'avance, au plus tard le cinq de chaque mois, par virement bancaire",
        ),
        ". ",
        f.c(
          "augmentation_loyer",
          "Il est augmenté de cinq pour cent par an à compter de la troisième année.",
        ),
        " ",
        f.c(
          "retenue_source_loyer",
          "Le Preneur opère la retenue à la source légale sur le loyer et en remet le certificat au Bailleur.",
        ),
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 4 — Dépôt de garantie"] },
    {
      k: "texte",
      morceaux: [
        "Le Preneur verse ce jour un dépôt de garantie de ",
        f.m("depot_garantie", loyer * 2n),
        " dinars, restituable en fin de bail.",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["Article 7 — Clause résolutoire"] },
    {
      k: "texte",
      morceaux: [
        f.c(
          "clause_resolutoire",
          "À défaut de paiement d'un seul terme, un mois après un commandement resté sans effet, le bail sera résilié de plein droit.",
        ),
      ],
    },
    {
      k: "texte",
      morceaux: [
        "Fait à Tunis, le ",
        f.d("date_signature", signature, "slash"),
        ", en trois exemplaires. ",
        f.c("juridiction", "Tribunal de première instance de Tunis compétent."),
      ],
    },
    { k: "signatures", gauche: "Le Bailleur", droite: "Le Preneur" },
  );
  f.notes.push(
    "Piège des parties : le matricule d'ALGORIA (preneuse) est imprimé dans sa comparution, mais la grille bail_commercial n'a pas de champ pour lui — il ne doit JAMAIS être lu comme bailleur_matricule_fiscal (`cheminsDuDossier`).",
    "Le loyer et la référence du bail sont ceux de la quittance du cas 133.",
  );
  return {
    titre: "Contrat de bail à usage professionnel",
    scenario: "bail_siege",
    parties: [
      partie("bailleur", { nom: b.fr, matricule: b.matricule }),
      partie("preneur", algoria("fr")),
    ],
    tampon: { partie: algoria("fr"), code: "signatures" },
    signature: { code: "signatures" },
  };
}

/** 157 — bail en arabe du dépôt de Sfax (établissement secondaire du cas 125). */
function bailSfax(f, { t, autres }) {
  const b = autres.bailleurSfax;
  const signature = jour(10, t.tirer(20, 28));
  const effet = jour(11, 1);
  const loyer = dinars(t.tirer(9, 16) * 100);
  const a = algoria("ar");
  f.blocs.push(
    { k: "titre", texte: [f.c("type_bail", "عقد كراء محل للاستعمال المهني", "professionnel")] },
    {
      k: "texte",
      morceaux: [
        "بين الممضين أسفله : ",
        f.c("bailleur_identite", `${b.ar}، في شخص ممثلها القانوني السيد ${b.representant}`),
        "، المعرف الجبائي ",
        f.mf("bailleur_matricule_fiscal", b.matricule),
        "، بصفتها ",
        f.c("titre_bailleur", "مالكة", "propriétaire"),
        "، ويشار إليها فيما يلي بالمسوّغ،",
      ],
    },
    {
      k: "texte",
      morceaux: [
        "و ",
        f.c("preneur_identite", `${a.nom}، في شخص مسيرها`),
        "، ويشار إليها فيما يلي بالمتسوّغ.",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["الفصل الأول : موضوع الكراء"] },
    {
      k: "texte",
      morceaux: [
        "يسوّغ المسوّغ للمتسوّغ ",
        f.c("description_local", "مستودعا مساحته 420 م² مع مكتب"),
        " كائنا ب",
        f.c("adresse_local", AUTRES.localSfax),
        "، معدا ل",
        f.c("destination", "خزن المعدات الإعلامية"),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["الفصل الثاني : المدة"] },
    {
      k: "texte",
      morceaux: [
        "أبرم هذا العقد ",
        f.c("duree", "لمدة سنتين", "P2Y"),
        " تبتدئ من ",
        f.d("date_effet", effet, "arabe"),
        ".",
      ],
    },
    { k: "texte", classe: "gras", morceaux: ["الفصل الثالث : معين الكراء"] },
    {
      k: "texte",
      morceaux: [
        "حدد معين الكراء الشهري بـ ",
        f.m("loyer_montant", loyer),
        " دينارا دون اعتبار الأداء على القيمة المضافة، يدفع ",
        f.c("periodicite", "شهريا", "mensuelle"),
        " مسبقا. ويدفع المتسوّغ ضمانا قدره ",
        f.m("depot_garantie", loyer * 3n),
        " دينارا.",
      ],
    },
    {
      k: "texte",
      morceaux: ["حرر بصفاقس في ", f.d("date_signature", signature, "arabe"), " في نظيرين."],
    },
    { k: "signatures", gauche: "المسوّغ", droite: "المتسوّغ" },
  );
  f.notes.push(
    "Bail arabe : ALGORIA preneuse, sans son matricule ; le dépôt de Sfax est l'établissement secondaire ouvert par la décision du cas 125.",
  );
  return {
    titre: "عقد كراء",
    scenario: "bail_depot",
    parties: [partie("bailleur", { nom: b.ar, matricule: b.matricule }), partie("preneur", a)],
    signature: { code: "signatures" },
  };
}

/* ============================================================ autres pièces */

/** 158 — avis d'échéance d'assurance multirisque bureaux (ALGORIA souscriptrice). */
function avisEcheance(f, { t, autres }) {
  const a = autres.assureur;
  const echeance = jour(12, 1);
  const prime = dinars(t.tirer(1400, 2600)) + BigInt(t.tirer(0, 1000));
  const accessoires = dinars(t.tirer(15, 40));
  const taxes = dinars(t.tirer(120, 320)) + BigInt(t.tirer(0, 1000));
  const ttc = prime + accessoires + taxes;
  f.blocs.push(
    {
      k: "entete",
      gauche: [[{ ...f.c("assureur", a.fr), cls: "gros" }], [a.adresse]],
      droite: [[f.c("souscripteur", ALGORIA.nom)], [algoria("fr").adresse]],
    },
    {
      k: "titre",
      texte: ["AVIS D'ÉCHÉANCE N° ", f.c("numero_avis", `AE-26-${t.tirer(100000, 999999)}`)],
    },
    {
      k: "champs",
      lignes: [
        ["Police n° :", f.c("numero_police", `MRB-${t.tirer(10000, 99999)}`)],
        ["Risque :", f.c("risque_concerne", `Multirisque bureaux — ${AUTRES.local}`)],
        [
          "Période couverte :",
          f.c("periode_couverte", "du 01/12/2026 au 30/11/2027", "2026-12-01/2027-11-30"),
        ],
        ["Échéance :", f.d("date_echeance", echeance, "slash")],
      ],
    },
    {
      k: "tableau",
      entetes: ["Décompte", "Montant (DT)"],
      nombres: [1],
      lignes: [
        ["Prime nette", f.m("prime_nette", prime)],
        ["Accessoires", f.m("accessoires", accessoires)],
        ["Taxes", f.m("taxes", taxes)],
      ],
      pied: [["Total à payer", f.m("montant_ttc", ttc)]],
    },
    {
      k: "texte",
      morceaux: [
        "À régler au plus tard le ",
        f.d("date_limite_paiement", plus(echeance, 9), "slash"),
        " — ",
        ...f
          .liste("modes_paiement", ["chèque", "virement", "espèces en agence"])
          .flatMap((m, i) => (i ? [", ", m] : [m])),
        ".",
      ],
    },
    {
      k: "texte",
      classe: "petit",
      morceaux: [
        f.c(
          "mention_non_paiement",
          "À défaut de paiement dans les dix jours de l'échéance, la garantie est suspendue trente jours après mise en demeure.",
        ),
      ],
    },
  );
  f.notes.push(
    "Type « autre_document » lu par la grille « avis_echeance_assurance », que la base relie à ce type. Total = prime nette + accessoires + taxes. La période couverte déborde sur 2027 : c'est l'année d'assurance.",
  );
  return {
    titre: "Avis d'échéance",
    scenario: "avis_echeance",
    parties: [partie("assureur", { nom: a.fr }), partie("souscripteur", algoria("fr"))],
  };
}

/** Le cas sans grille : rien à lire, et toute valeur lue est une valeur fausse. */
const SANS_GRILLE =
  "Aucune grille ne lit cette pièce (grille null) : l'issue attendue est qu'AUCUN champ ne soit extrait. Le banc compte zéro valeur fausse : toute date, tout montant ou tout nom posé sur un champ est une faute.";

/** 159 — attestation de participation à un séminaire (autre document, sans grille). */
function attestationParticipation(f, { t }) {
  const s = SALARIES[0];
  const debut = jour(10, t.tirer(19, 23));
  const a = AUTRES.association;
  f.blocs.push(
    { k: "entete", gauche: [[{ t: a.nom, cls: "gros" }], [a.adresse]], droite: [] },
    { k: "titre", texte: ["ATTESTATION DE PARTICIPATION"] },
    {
      k: "texte",
      morceaux: [
        `L'${a.nom} atteste que M. ${s.nom}, de la société ${ALGORIA.nom}, a participé au séminaire « Gouvernance des données et intelligence artificielle souveraine », tenu à Hammamet les ${f.dateTexte(debut, "slash")} et ${f.dateTexte(plus(debut, 1), "slash")}, d'une durée de seize heures.`,
      ],
    },
    {
      k: "texte",
      morceaux: ["Cette attestation est délivrée pour servir et valoir ce que de droit."],
    },
    { k: "signatures", gauche: "", droite: "Le président de l'association" },
  );
  f.notes.push(
    SANS_GRILLE,
    "Pièges : deux dates, un nom de société réel (ALGORIA), un nom de salarié — rien n'est à lire.",
  );
  return {
    titre: "Attestation de participation",
    scenario: "sans_grille",
    parties: [partie("organisme", { nom: a.nom }), partie("participant", algoria("fr"))],
    signature: { code: null },
  };
}

/** 160 — menu du jour d'un restaurant (non comptable) : des prix, rien à lire. */
function menuRestaurant(f, { t }) {
  const r = AUTRES.restaurant;
  const plats = [
    ["Brik à l'œuf", 6, 9],
    ["Salade méchouia", 7, 11],
    ["Couscous au mérou", 24, 34],
    ["Ojja aux merguez", 14, 19],
    ["Poisson grillé du jour", 28, 42],
    ["Makroudh et thé à la menthe", 6, 9],
  ];
  f.blocs.push(
    { k: "titre", texte: [r.nom], sous: [r.adresse] },
    { k: "section", texte: `Menu du jour — ${f.dateTexte(jour(10, t.tirer(5, 28)), "long")}` },
    {
      k: "tableau",
      entetes: ["Plat", "Prix (DT)"],
      nombres: [1],
      lignes: plats.map(([p, a, b]) => [
        p,
        { t: f.mt(dinars(t.tirer(a, b)) + BigInt(t.choisir([0, 500]))) },
      ]),
    },
    { k: "texte", classe: "centre", morceaux: ["Service compris — réservations au 00 71 845 210"] },
  );
  f.notes.push(
    SANS_GRILLE,
    "Piège : des prix et une date imprimés, qui ne sont ni des montants ni une date de pièce.",
  );
  return {
    titre: "Menu du jour",
    scenario: "sans_grille",
    parties: [partie("restaurant", { nom: r.nom })],
  };
}

/** 161 — avis du syndic d'immeuble, en arabe (non comptable). */
function avisSyndic(f, { t }) {
  const jourCoupure = jour(11, t.tirer(10, 20));
  f.blocs.push(
    { k: "titre", texte: [AUTRES.syndic.ar], sous: ["إعلام"] },
    {
      k: "texte",
      morceaux: [
        `يعلم اتحاد المالكين كافة متساكني الإقامة والمكاتب أنه سيتم قطع الماء يوم ${f.dateTexte(jourCoupure, "arabe")} من الساعة التاسعة صباحا إلى الساعة الرابعة بعد الزوال، وذلك لإصلاح القنوات الرئيسية.`,
      ],
    },
    { k: "texte", morceaux: ["نرجو منكم اتخاذ الاحتياطات اللازمة، ونعتذر عن الإزعاج."] },
    { k: "signatures", gauche: "", droite: "رئيس الاتحاد" },
  );
  f.notes.push(SANS_GRILLE, "Piège : une date et des heures, en arabe.");
  return {
    titre: "إعلام",
    scenario: "sans_grille",
    parties: [partie("syndic", { nom: AUTRES.syndic.ar })],
  };
}

/* ============================================================ la matrice */

/*
 * Les 41 pièces, dans l'ordre de leurs numéros (121 à 161). `grille` : celle
 * que la base relie au type (`ref.grilles.document_type`), sauf
 * `declaration_tva` (aucune grille en base : la déclaration mensuelle, qui
 * porte la TVA) et `document_gouvernance` (la décision du gérant, la grille
 * la plus proche d'une décision de SARL). `mf` : la forme imprimée du
 * matricule d'ALGORIA. `apres` : la passe où la pièce se compose, quand elle
 * reprend les montants d'une autre (le relevé reprend six paiements).
 */
const PIECES = [
  { type: "pv_ago", grille: "pv_ago", langue: "fr", rendu: "pdf", gabarit: "H", faire: pvAgo },
  {
    type: "pv_age",
    grille: "pv_age",
    langue: "fr",
    rendu: "scan",
    gabarit: "H",
    police: "machine",
    faire: pvAge,
  },
  {
    type: "statuts",
    grille: "statuts",
    langue: "fr",
    rendu: "pdf_image",
    capture: "scan",
    gabarit: "H",
    police: "machine",
    faire: statuts,
  },
  {
    type: "extrait_rne",
    grille: "extrait_rne",
    langue: "hybride",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "slash",
    faire: extraitRne,
  },
  {
    type: "document_gouvernance",
    grille: "decision_gerant",
    langue: "fr",
    rendu: "photo",
    gabarit: "H",
    faire: decisionGerant,
  },
  {
    type: "avoir",
    grille: "avoir",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "compact",
    faire: avoirRecu,
  },
  {
    type: "avoir",
    grille: "avoir",
    langue: "ar",
    rendu: "scan",
    gabarit: "G",
    style: "bande",
    couleur: "#5a2d82",
    faire: avoirEmis,
  },
  {
    type: "bon_livraison",
    grille: "bon_livraison",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "bande",
    couleur: "#1e7f4f",
    mf: "espace",
    faire: blImprime,
  },
  {
    type: "bon_livraison",
    grille: "bon_livraison",
    langue: "ar",
    rendu: "manuscrit",
    capture: "photo",
    gabarit: "J",
    orientaux: true,
    faire: blManuscrit,
  },
  {
    type: "justificatif_paiement",
    grille: "virement",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    faire: ordreDeVirement,
  },
  {
    type: "justificatif_paiement",
    grille: "cheque",
    langue: "fr",
    rendu: "manuscrit",
    capture: "photo",
    gabarit: "K",
    milliers: " ",
    faire: cheque,
  },
  {
    type: "recu_de_paiement",
    grille: "recu_quittance",
    langue: "ar",
    rendu: "manuscrit",
    capture: "scan",
    gabarit: "J",
    orientaux: true,
    faire: recuManuscrit,
  },
  {
    type: "recu_de_paiement",
    grille: "recu_quittance",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "bande",
    couleur: "#7a4b16",
    mf: "slash",
    milliers: ".",
    faire: quittanceLoyer,
  },
  {
    type: "note_frais",
    grille: "note_frais",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "bande",
    couleur: "#0a0a0a",
    faire: noteDeFraisImprimee,
  },
  {
    type: "note_frais",
    grille: "note_frais",
    langue: "fr",
    rendu: "manuscrit",
    capture: "photo",
    gabarit: "J",
    milliers: "",
    faire: noteDeFraisManuscrite,
  },
  {
    type: "releve_bancaire",
    grille: "releve_bancaire",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "compact",
    milliers: ".",
    apres: 2,
    faire: releveOctobre,
  },
  {
    type: "releve_bancaire",
    grille: "releve_bancaire",
    langue: "hybride",
    rendu: "scan",
    gabarit: "G",
    style: "bande",
    couleur: "#14506b",
    faire: releveSeptembre,
  },
  {
    type: "ticket_caisse",
    grille: "ticket_caisse",
    langue: "fr",
    rendu: "photo",
    gabarit: "I",
    milliers: "",
    faire: ticketPapeterie,
  },
  {
    type: "ticket_caisse",
    grille: "ticket_caisse",
    langue: "ar",
    rendu: "pdf_image",
    capture: "scan",
    gabarit: "I",
    milliers: "",
    faire: ticketSuperette,
  },
  {
    type: "bulletin_paie",
    grille: "bulletin_paie",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "slash",
    faire: bulletinOctobre,
  },
  {
    type: "bulletin_paie",
    grille: "bulletin_paie",
    langue: "hybride",
    rendu: "scan",
    gabarit: "G",
    style: "bande",
    couleur: "#2f5d3a",
    faire: bulletinSeptembre,
  },
  {
    type: "declaration_tva",
    grille: "declaration_mensuelle",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "slash",
    faire: declarationTva,
  },
  {
    type: "declaration_tva",
    grille: "declaration_mensuelle",
    langue: "ar",
    rendu: "pdf_image",
    capture: "photo",
    gabarit: "G",
    style: "bande",
    couleur: "#333333",
    faire: declarationTvaCredit,
  },
  {
    type: "declaration_cnss",
    grille: "declaration_cnss_trimestrielle",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "compact",
    apres: 1,
    faire: declarationCnss(3, false),
  },
  {
    type: "declaration_cnss",
    grille: "declaration_cnss_trimestrielle",
    langue: "hybride",
    rendu: "scan",
    gabarit: "G",
    style: "bande",
    couleur: "#1f3b63",
    mf: "slash",
    faire: declarationCnss(2, true),
  },
  {
    type: "declaration_impot",
    grille: "declaration_annuelle_is_irpp",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "slash",
    milliers: ".",
    faire: declarationIs,
  },
  {
    type: "declaration_impot",
    grille: "declaration_mensuelle",
    langue: "fr",
    rendu: "scan",
    gabarit: "G",
    style: "bande",
    couleur: "#4a4a4a",
    mf: "espace",
    faire: declarationRetenues,
  },
  {
    type: "acompte_provisionnel",
    grille: "acompte_provisionnel",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "compact",
    faire: acompte(1, false),
  },
  {
    type: "acompte_provisionnel",
    grille: "acompte_provisionnel",
    langue: "ar",
    rendu: "photo",
    gabarit: "G",
    style: "bande",
    couleur: "#3a3a3a",
    mf: "oriental",
    faire: acompte(2, true),
  },
  {
    type: "carte_identification_fiscale",
    grille: "carte_identification_fiscale",
    langue: "hybride",
    rendu: "photo",
    gabarit: "K",
    faire: carteFiscale,
  },
  {
    type: "carte_identification_fiscale",
    grille: "carte_identification_fiscale",
    langue: "fr",
    rendu: "scan",
    gabarit: "G",
    style: "encadre",
    faire: attestationImmatriculation,
  },
  {
    type: "document_fiscal_social",
    grille: "certificat_retenue_source",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "encadre",
    mf: "slash",
    faire: certificatRetenue,
  },
  {
    type: "document_fiscal_social",
    grille: "attestation_travail",
    langue: "ar",
    rendu: "scan",
    gabarit: "H",
    faire: attestationTravail,
  },
  {
    type: "contrat",
    grille: "contrat_commercial",
    langue: "fr",
    rendu: "pdf",
    gabarit: "H",
    mf: "slash",
    faire: contratCommercial,
  },
  {
    type: "contrat",
    grille: "contrat_cdi",
    langue: "fr",
    rendu: "scan",
    gabarit: "H",
    police: "machine",
    mf: "compact",
    faire: contratCdi,
  },
  {
    type: "bail",
    grille: "bail_commercial",
    langue: "fr",
    rendu: "pdf",
    gabarit: "H",
    mf: "slash",
    faire: bailSiege,
  },
  {
    type: "bail",
    grille: "bail_commercial",
    langue: "ar",
    rendu: "scan",
    gabarit: "H",
    faire: bailSfax,
  },
  {
    type: "autre_document",
    grille: "avis_echeance_assurance",
    langue: "fr",
    rendu: "pdf",
    gabarit: "G",
    style: "bande",
    couleur: "#0b5aa6",
    faire: avisEcheance,
  },
  {
    type: "autre_document",
    grille: null,
    langue: "fr",
    rendu: "photo",
    gabarit: "H",
    faire: attestationParticipation,
  },
  {
    type: "non_comptable",
    grille: null,
    langue: "fr",
    rendu: "photo",
    gabarit: "G",
    style: "bande",
    couleur: "#6b2fa0",
    faire: menuRestaurant,
  },
  {
    type: "non_comptable",
    grille: null,
    langue: "ar",
    rendu: "scan",
    gabarit: "H",
    faire: avisSyndic,
  },
];

/** Le premier numéro des pièces : après les 120 factures. */
export const PREMIER_NUMERO = 121;

/** Les parties inventées des pièces, tirées une fois (matricules fictifs, RIB « 99 »). */
function lesAutresParties({ tirer }) {
  const id = (p) => ({
    ...p,
    matricule: matriculeDEssai("A", "M", tirer),
    telephone: `00 ${tirer(30, 79)} ${tirer(100, 999)} ${tirer(100, 999)}`,
  });
  const autres = {
    banqueOuzrane: id({ nom: ALGORIA.banque }),
    banqueSelvane: id({ nom: "Crédit Selvane" }),
    bailleur: id(AUTRES.bailleur),
    bailleurSfax: id(AUTRES.bailleurSfax),
    assureur: id(AUTRES.assureur),
    artisan: id(AUTRES.artisan),
    papeterie: id(AUTRES.papeterie),
    superette: id(AUTRES.superette),
    ribSelvane: `99 204 ${tirer(1000000, 9999999)}${tirer(100000, 999999)} ${deux(tirer(1, 97))}`,
  };
  for (const p of Object.values(autres))
    if (p.matricule === ALGORIA.matricule)
      throw new Error("matricule fictif égal à celui d'ALGORIA");
  return autres;
}

/* ------------------------------------------------------- le contrôle des matricules */

/** Les chiffres orientaux d'un texte, en chiffres latins. */
const COMPACT = (s) => String(s).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
/** Les matricules d'un texte, sous forme compacte : « 1958330VAM000 ». */
const matriculesDans = (texte) =>
  [
    ...COMPACT(texte)
      .replace(/[\s/]/g, "")
      .matchAll(/\d{7}[A-Z][A-Z][A-Z]\d{3}/g),
  ].map((m) => m[0]);
/** Tous les textes des blocs, hors des champs (qui sont dans `imprime`). */
function textesDesBlocs(x, sortie = []) {
  if (typeof x === "string") sortie.push(x);
  else if (Array.isArray(x)) x.forEach((y) => textesDesBlocs(y, sortie));
  else if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x))
      if (k !== "c" && k !== "barres") textesDesBlocs(v, sortie);
  return sortie;
}

/**
 * Aucun matricule deux fois sur une page, et celui d'ALGORIA seulement du côté
 * d'ALGORIA (`cheminsDuDossier`), jamais dans un texte hors champ.
 */
function controlerLesMatricules(cas) {
  const algoria = ALGORIA.matricule.replaceAll("/", "");
  const vus = new Map();
  for (const [chemin, texte] of Object.entries(cas.piece.imprime))
    for (const m of matriculesDans(texte)) {
      vus.set(m, (vus.get(m) ?? 0) + 1);
      if (m === algoria && !cas.piece.cheminsDuDossier.includes(chemin))
        throw new Error(`${cas.id} : le matricule d'ALGORIA hors de son côté (${chemin})`);
    }
  for (const texte of textesDesBlocs(cas.piece.blocs))
    for (const m of matriculesDans(texte)) {
      if (m === algoria)
        throw new Error(`${cas.id} : le matricule d'ALGORIA dans un texte hors champ`);
      vus.set(m, (vus.get(m) ?? 0) + 1);
    }
  for (const [m, n] of vus)
    if (n > 1) throw new Error(`${cas.id} : le matricule ${m} imprimé ${n} fois`);
}

/* ------------------------------------------------------------- la composition */

/**
 * Les 41 pièces. `parties` : celles des factures (mêmes fournisseurs, mêmes
 * matricules) ; `factures` : les 120 cas déjà composés, par numéro, auxquels
 * des pièces se rapportent (avoirs, paiements, retenue).
 */
export function composerPieces({ parties, factures, graine }) {
  const tAutres = tirages(mulberry32(graine ^ 0x0121_5eed));
  const autres = lesAutresParties(tAutres);
  const commun = {
    bail: {
      loyer: dinars(tAutres.tirer(24, 36) * 100),
      charges: dinars(tAutres.tirer(120, 260)),
      refBail: `BAIL-VZ-2026-${String(tAutres.tirer(1, 99)).padStart(3, "0")}`,
      signature: jour(1, tAutres.tirer(12, 26)),
      effet: jour(2, 1),
    },
    is2025: impotDe2025(tAutres),
  };
  const lies = {};
  const nomsDesLiens = {
    130: "virement",
    131: "cheque",
    133: "quittance",
    141: "bulletinSeptembre",
    142: "dgi",
    144: "cnss",
    152: "certificat",
  };
  const sortie = new Array(PIECES.length);
  for (const passe of [0, 1, 2])
    PIECES.forEach((spec, rang) => {
      if ((spec.apres ?? 0) !== passe) return;
      const numero = PREMIER_NUMERO + rang;
      const id = String(numero).padStart(3, "0");
      const t = tirages(mulberry32((graine + numero * 7919) >>> 0));
      const f = feuille(spec);
      const forme = spec.mf ?? "slash";
      const r = spec.faire(f, { t, parties, factures, autres, commun, lies, forme });
      if (nomsDesLiens[numero]) lies[nomsDesLiens[numero]] = r.lie;
      sortie[rang] = habiller({ id, spec, r, f, t, graine });
    });
  return sortie;
}

/** Le cas d'une pièce : sa vérité, ses parties, son réel simulé. */
function habiller({ id, spec, r, f, t, graine }) {
  const capture =
    spec.rendu === "pdf"
      ? null
      : spec.rendu === "pdf_image" || spec.rendu === "manuscrit"
        ? spec.capture
        : spec.rendu;
  const realisme = effetsDeLaPriseDeVue(capture, t.tirer);
  const marques = {};
  if (r.tampon) {
    realisme.push("tampon");
    if (r.tampon.code) {
      marques.cachet_emetteur = r.tampon.code;
      f.poseConcept(r.tampon.code, true);
    }
  }
  if (r.signature) {
    realisme.push("signature");
    if (r.signature.code) {
      marques.signature_emetteur = r.signature.code;
      f.poseConcept(r.signature.code, true);
    }
  }
  if (r.souche) realisme.push("souche_carbone");
  if (r.ratures?.length) realisme.push("ratures");
  if (spec.orientaux || spec.mf === "oriental") realisme.push("chiffres_orientaux");
  const [emetteur, client = null] = r.parties;
  return {
    id,
    synthetique: true,
    provenance: `jeu d'ALGORIA, composé par outils/jeu-algoria/composer.mjs (graine ${graine}) : pièce inventée ; seule partie réelle, ALGORIA FACTORY SARL et son matricule (à la demande du dirigeant)`,
    type: spec.type,
    grille: spec.grille,
    langue: spec.langue,
    rendu: spec.rendu,
    capture,
    gabarit: spec.gabarit,
    mise_en_page: [spec.gabarit, spec.style, spec.police].filter(Boolean).join("-"),
    scenario: r.scenario ?? spec.type,
    realisme,
    dossier: { nom: ALGORIA.nom, identifiantFiscal: ALGORIA.matricule },
    piece: {
      titre: r.titre,
      parties: r.parties,
      emetteur,
      client,
      style: spec.style ?? null,
      police: spec.police ?? null,
      couleur: spec.couleur ?? null,
      main: spec.rendu === "manuscrit",
      souche: r.souche ?? null,
      tampon: r.tampon ?? null,
      ratures: r.ratures ?? [],
      format: f.format,
      blocs: f.blocs,
      imprime: f.imprime,
      versConcept: f.versConcept,
      marques,
      cheminsDuDossier: f.dossier,
    },
    graineDuRendu: t.tirer(1, 2 ** 31),
    attendu: {
      concepts: f.concepts,
      confondus: f.confondus,
      notes: f.notes,
    },
  };
}

export { controlerLesMatricules };
