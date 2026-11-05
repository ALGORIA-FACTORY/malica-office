/**
 * Les treize écritures d'un matricule fiscal, et la seule clé qui les réunit.
 *
 * ================================================================= POURQUOI
 *
 * Sur une pièce, le matricule arrive comme l'œil l'a vu : avec son étiquette,
 * en chiffres arabes, séparé par des espaces ou des tirets, parfois abîmé par
 * une confusion de caractères. Comparer deux écritures mot à mot ferait échouer
 * toutes les pièces d'un dossier — et le motif affiché accuserait la pièce.
 *
 * Les treize variantes ci-dessous sont celles que j'ai retenues faute d'avoir
 * la liste d'origine sous les yeux : la note qui les énumère vit dans le projet
 * du commanditaire, pas dans le dépôt. Elles sont nommées une par une pour
 * qu'on puisse la confronter à ce fichier et compléter ce qui manque.
 *
 * Toutes désignent la même entreprise. La clé doit donc être la même treize
 * fois, et c'est la seule assertion qui compte.
 */
import { describe, expect, it } from "vitest";

import { lettreDeControle, memeMatricule, normaliserMatricule } from "../matricule.ts";

import { FORMAT_D_ESSAI } from "./regles-de-lecture-d-essai.ts";

const CLE = "1876543W";
const COMPLET = "1876543W/A/M/000";

/** Les treize écritures, nommées : une liste muette ne se complète pas. */
const VARIANTES: ReadonlyArray<readonly [string, string]> = [
  ["canonique", "1876543W/A/M/000"],
  ["entourée d'espaces", "   1876543W/A/M/000  "],
  ["étiquette « MF »", "MF : 1876543W/A/M/000"],
  ["étiquette complète", "Matricule fiscal : 1876543W/A/M/000"],
  ["étiquette abrégée pointée", "M.F. 1876543W/A/M/000"],
  ["séparée par des espaces", "1876543W A M 000"],
  ["séparée par des tirets", "1876543W-A-M-000"],
  ["en minuscules", "1876543w/a/m/000"],
  ["chiffres arabes", "١٨٧٦٥٤٣W/A/M/000"],
  ["étiquette arabe", "المعرف الجبائي : 1876543W/A/M/000"],
  ["forme courte", "1876543W"],
  ["confusion l pour 1", "l876543W/A/M/000"],
  ["confusion B pour 8", "1B76543W/A/M/000"],
];

/**
 * ===================== LA QUATORZIÈME, VENUE D'UNE VRAIE FACTURE
 *
 * Relevée le 7 octobre 2026 sur la facture SUARL CASA-ELECT (FA262266),
 * photographiée par le commanditaire :
 *
 *     1589037 /M/P/M/000
 *
 * Sept chiffres, UNE ESPACE, puis QUATRE groupes. La lettre de contrôle — le
 * « M » — est séparée du numéro comme les autres groupes, alors que les treize
 * écritures précédentes la collaient aux chiffres.
 *
 * Mon normaliseur la rendait « illisible ». Conséquence en cascade, et c'est
 * ce qui en fait un cas et non un détail : sans matricule lisible, la déduction
 * du sens ne pouvait pas se faire, le modèle gardait la main, il a dit
 * « facture_vente » sur une facture d'achat, et le contrôle du destinataire a
 * alors vérifié que l'ÉMETTEUR était ALGORIA. Il a trouvé CASA-ELECT, et il a
 * REJETÉ une facture d'achat parfaitement normale.
 *
 * Une écriture de matricule non reconnue a donc suffi à faire rejeter la pièce.
 */
const CASA_ELECT = "1589037 /M/P/M/000";

describe("les treize écritures d'un même matricule", () => {
  it("il y en a bien treize, nommées", () => {
    // Si la liste d'origine en porte d'autres, ce compte doit changer avec
    // elles : un test qui s'ajuste en silence ne dit plus rien.
    expect(VARIANTES).toHaveLength(13);
  });

  for (const [nom, ecriture] of VARIANTES) {
    it(`${nom} → ${CLE}`, () => {
      expect(normaliserMatricule(ecriture, FORMAT_D_ESSAI).cle).toBe(CLE);
    });
  }

  it("et elles sont toutes égales entre elles", () => {
    for (const [nom, a] of VARIANTES) {
      expect(
        memeMatricule(a, COMPLET, FORMAT_D_ESSAI),
        `${nom} doit égaler la forme canonique`,
      ).toBe(true);
    }
  });

  it("la forme pleine est reconstituée quand les trois groupes sont là", () => {
    for (const [nom, ecriture] of VARIANTES) {
      const lu = normaliserMatricule(ecriture, FORMAT_D_ESSAI);
      if (lu.forme === "complete") {
        expect(lu.complet, nom).toBe(COMPLET);
      }
    }
  });

  it("la forme courte se dit courte, et se compare quand même", () => {
    const lu = normaliserMatricule("1876543W", FORMAT_D_ESSAI);
    expect(lu.forme).toBe("courte");
    expect(lu.complet).toBeNull();
    expect(memeMatricule("1876543W", COMPLET, FORMAT_D_ESSAI)).toBe(true);
  });

  it("une correction se dit : on ne répare pas un identifiant en silence", () => {
    // « l876543W » devient « 1876543W ». La personne doit pouvoir contester une
    // correction qu'on a faite sur son identifiant.
    expect(normaliserMatricule("l876543W/A/M/000", FORMAT_D_ESSAI).corrections).toContain(
      "I ou L lu pour 1",
    );
    expect(normaliserMatricule("١٨٧٦٥٤٣W/A/M/000", FORMAT_D_ESSAI).corrections).toContain(
      "chiffres arabes convertis",
    );
    expect(normaliserMatricule("MF : 1876543W/A/M/000", FORMAT_D_ESSAI).corrections).toContain(
      "étiquette retirée",
    );
  });
});

describe("la lettre de contrôle séparée par un séparateur — vraie facture CASA-ELECT", () => {
  it("se lit, et rend la clé 1589037M", () => {
    const lu = normaliserMatricule(CASA_ELECT, FORMAT_D_ESSAI);
    expect(lu.cle).toBe("1589037M");
    expect(lu.forme).toBe("complete");
    expect(lu.complet).toBe("1589037M/P/M/000");
  });

  it("égale la même entreprise écrite sans l'espace", () => {
    expect(memeMatricule(CASA_ELECT, "1589037M/P/M/000", FORMAT_D_ESSAI)).toBe(true);
  });

  it("et n'est PAS confondue avec le dossier", () => {
    // C'est le fournisseur. La déduction du sens doit donc dire « ce n'est pas
    // le dossier », et non « je ne sais pas lire ».
    expect(memeMatricule(CASA_ELECT, "1876543W/A/M/000", FORMAT_D_ESSAI)).toBe(false);
  });

  it("les quatre groupes ne sont pas pris pour trois", () => {
    /*
     * Le piège exact : lu comme TROIS groupes, « /M/P/M/000 » donnerait un
     * matricule SANS lettre de contrôle, de clé nulle — et la pièce repartirait
     * en question au lieu d'être déduite. Lu comme QUATRE, le premier groupe
     * est la lettre de contrôle.
     */
    const lu = normaliserMatricule(CASA_ELECT, FORMAT_D_ESSAI);
    expect(lu.chiffres).toBe("1589037");
    expect(lu.cle).not.toBeNull();
  });
});

describe("ce que le normaliseur refuse de deviner", () => {
  it("sept chiffres sans lettre de contrôle : une forme partielle, dont la lettre se calcule", () => {
    /*
     * C'est l'ancienne fiche du staging, et c'est la forme qu'une pièce peut
     * porter. Jamais le rejet du document, qui n'y est pour rien.
     *
     * DÉCISION du dirigeant (5 novembre 2026) : la lettre se CALCULE par la règle
     * du pack (somme pondérée 7..1, modulo 23 : 1·7+8·6+5·5+6·4+3·3+2·2+4·1 = 121,
     * 121 mod 23 = 6, « G »). Elle sert à comparer ; elle n'est pas affichée.
     */
    const lu = normaliserMatricule("1856324/A/M/000", FORMAT_D_ESSAI);
    expect(lu.forme).toBe("partielle");
    expect(lu.cle).toBe("1856324G");
    expect(lu.complet).toBeNull();
    expect(lu.chiffres).toBe("1856324");
    expect(lu.corrections).toContain("lettre de contrôle calculée : G");
    expect(lettreDeControle(lu, FORMAT_D_ESSAI)).toBeNull();
  });

  it("sans règle au pack, une forme partielle n'égale rien, pas même elle-même", () => {
    const sansRegle = { ...FORMAT_D_ESSAI, controle: null };
    expect(normaliserMatricule("1856324/A/M/000", sansRegle).cle).toBeNull();
    expect(memeMatricule("1856324/A/M/000", "1856324/A/M/000", sansRegle)).toBe(false);
  });

  it("avec la règle, elle égale l'écriture dont la lettre est la lettre calculée, et aucune autre", () => {
    expect(memeMatricule("1856324/A/M/000", "1856324/A/M/000", FORMAT_D_ESSAI)).toBe(true);
    expect(memeMatricule("1856324/A/M/000", "1856324G/A/M/000", FORMAT_D_ESSAI)).toBe(true);
    expect(memeMatricule("1856324/A/M/000", "1856324K/A/M/000", FORMAT_D_ESSAI)).toBe(false);
  });

  it("ne répare jamais un chiffre vu à la place de la lettre de contrôle", () => {
    /*
     * « 18765430/A/M/000 » : huit chiffres avant les groupes. C'est peut-être
     * « 1876543 » + un « O » lu « 0 » — et c'est peut-être autre chose. La
     * lettre de contrôle peut être n'importe laquelle, donc toute réparation y
     * serait une INVENTION, ce que R2 interdit.
     *
     * Aucune clé, donc aucune comparaison ne réussira : la pièce part en
     * question, et la personne lit le matricule sur sa facture.
     */
    const lu = normaliserMatricule("18765430/A/M/000", FORMAT_D_ESSAI);
    expect(lu.cle).toBeNull();
    expect(lu.forme).toBe("illisible");
  });

  it("un texte qui n'est pas un matricule reste illisible", () => {
    for (const rien of ["", "   ", "ALGORIA FACTORY", "MF :", "FA/2026/00412"]) {
      expect(normaliserMatricule(rien, FORMAT_D_ESSAI).forme, rien).toBe("illisible");
    }
  });

  it("ne rend jamais null ni undefined", () => {
    expect(normaliserMatricule(null, FORMAT_D_ESSAI).forme).toBe("illisible");
    expect(normaliserMatricule(undefined, FORMAT_D_ESSAI).forme).toBe("illisible");
  });

  it("ne juge PAS les séries réglementaires : c'est le pack qui le fait", () => {
    /*
     * « /Z/Q/ » n'existe pas, et ce module l'accepte quand même — exprès. Les
     * codes de TVA et les catégories d'établissement vivent dans
     * `ref.identifiant_formats`, datés par juridiction. Les recopier ici en
     * ferait deux sources de vérité, et R4 interdit la constante réglementaire
     * dans le code.
     *
     * Ce module lit. Le pack juge.
     */
    const lu = normaliserMatricule("1876543W/Z/Q/000", FORMAT_D_ESSAI);
    expect(lu.forme).toBe("complete");
    expect(lu.cle).toBe(CLE);
  });

  it("deux matricules différents ne se confondent pas", () => {
    expect(memeMatricule("1876543W/A/M/000", "1456987L/A/P/000", FORMAT_D_ESSAI)).toBe(false);
    // Même sept chiffres, lettre de contrôle différente : deux entreprises.
    expect(memeMatricule("1876543W/A/M/000", "1876543X/A/M/000", FORMAT_D_ESSAI)).toBe(false);
  });

  it("l'établissement ne change pas l'entreprise", () => {
    // Le siège et sa succursale portent le même noyau : la pièce adressée à
    // l'un concerne bien le dossier.
    expect(memeMatricule("1876543W/A/M/000", "1876543W/A/E/042", FORMAT_D_ESSAI)).toBe(true);
  });
});

/**
 * ===================== LA FORME COLLÉE, RELEVÉE LE 3 NOVEMBRE 2026
 *
 * « 1958330VAM000 » : aucun séparateur. Le jeu d'ALGORIA l'imprime sur 35
 * factures ; le normaliseur la rendait illisible, et le sens de la pièce ne se
 * déduisait plus (« le matricule du dossier n'est pas lu »).
 */
describe("la forme collée, sans un séparateur", () => {
  it("se lit pleine, et égale la forme barrée", () => {
    const lu = normaliserMatricule("1876543WAM000", FORMAT_D_ESSAI);
    expect(lu.forme).toBe("complete");
    expect(lu.complet).toBe(COMPLET);
    expect(memeMatricule("MF/CIN: 1876543WAM000", COMPLET, FORMAT_D_ESSAI)).toBe(true);
  });

  it("une lettre de moins ne se devine pas : on ne saurait pas laquelle manque", () => {
    expect(normaliserMatricule("1876543AM000", FORMAT_D_ESSAI).cle).toBeNull();
  });

  it("un numéro plus long ne s'y découpe pas", () => {
    expect(normaliserMatricule("91876543WAM000", FORMAT_D_ESSAI).forme).toBe("illisible");
    expect(normaliserMatricule("1876543WAM0001", FORMAT_D_ESSAI).forme).not.toBe("complete");
  });
});
