/**
 * Les libellés lisibles — jamais un chemin brut ni un code technique à l'écran.
 *
 * Garantit que les montants et dates se disent dans la langue du lecteur, qu'un champ
 * lu (« articles[3].designation ») se nomme par son rang et sa feuille, qu'un code de
 * contrôle ou une action d'audit a sa phrase, et que le motif pour lequel une pièce
 * n'est pas lue se dit en clair. Une pièce privée n'attend pas une lecture : son état
 * se dérive de la visibilité, sans réécrire un fait (R7). Une panne n'est pas prise
 * pour un refus.
 */
import { describe, expect, it } from "vitest";

import {
  libelleDeLAction,
  libelleDuChamp,
  libelleDuCode,
  libelleDuControle,
  libelleDuRefus,
  motifDeLEtat,
  motifDeRefusConnu,
  valeurDuChamp,
  valeurLisible,
} from "../champ-lisible";

describe("valeurLisible", () => {
  it("met un montant dans les séparateurs de la langue", () => {
    expect(valeurLisible("totals.ttc", "404.600", "fr")).toBe("404,600");
    expect(valeurLisible("articles[0].unit_price_ht", "14.000", "en")).toBe("14.000");
  });

  it("met une date au format de la langue", () => {
    expect(valeurLisible("document_date", "2026-09-30", "fr")).toBe("30/09/2026");
  });

  it("laisse un texte tel quel, et un montant qui n'en est pas un", () => {
    expect(valeurLisible("issuer", "GROSSISTE DU SUD", "fr")).toBe("GROSSISTE DU SUD");
    expect(valeurLisible("totals.ttc", "quatre cents", "fr")).toBe("quatre cents");
    expect(valeurLisible("references.numero", "4488", "fr")).toBe("4488");
  });
});

/** Un traducteur d'épreuve : rend la clé, avec ses variables, pour lire ce qui a été choisi. */
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

describe("libelleDuChamp", () => {
  it("nomme un article par son rang et sa feuille", () => {
    expect(libelleDuChamp("articles[3].designation", t as never)).toBe(
      "cab.champ.article(4) · pme.extract.designation",
    );
    expect(libelleDuChamp("lines[0].vat_amount", t as never)).toBe(
      "cab.champ.ligne(1) · pme.extract.vat",
    );
    expect(libelleDuChamp("other_charges[0].amount", t as never)).toBe(
      "cab.champ.droit(1) · pme.extract.charges",
    );
  });

  it("efface les conteneurs sans sens pour la personne", () => {
    expect(libelleDuChamp("totals.base_ht", t as never)).toBe("pme.extract.base");
    expect(libelleDuChamp("references.matricule_fiscal", t as never)).toBe("cab.champ.matricule");
    expect(libelleDuChamp("issuer", t as never)).toBe("pme.extract.issuer");
  });

  it("ne rend jamais un chemin brut, même inconnu", () => {
    expect(libelleDuChamp("nouveau_champ", t as never)).toBe("nouveau champ");
    expect(libelleDuChamp("bidules[1].truc_machin", t as never)).toBe("bidules 2 · truc machin");
  });
});

describe("valeurDuChamp", () => {
  const payload = {
    issuer: "MYTEK",
    totals: { ttc: "510.000" },
    articles: [{ designation: "Office 365", quantity: 1 }, { designation: "Encre" }],
  };

  it("suit le chemin jusqu'à la valeur", () => {
    expect(valeurDuChamp(payload, "issuer")).toBe("MYTEK");
    expect(valeurDuChamp(payload, "totals.ttc")).toBe("510.000");
    expect(valeurDuChamp(payload, "articles[1].designation")).toBe("Encre");
    expect(valeurDuChamp(payload, "articles[0].quantity")).toBe("1");
  });

  it("rend rien quand le chemin ne mène nulle part", () => {
    expect(valeurDuChamp(payload, "articles[7].designation")).toBeNull();
    expect(valeurDuChamp(payload, "totals.vat")).toBeNull();
    expect(valeurDuChamp(null, "issuer")).toBeNull();
    expect(valeurDuChamp(payload, "articles")).toBeNull();
  });
});

describe("codes et actions", () => {
  it("traduit un code connu et retombe sur une phrase générique", () => {
    expect(libelleDuCode("direction.incertaine", t as never)).toBe("cab.code.direction");
    expect(libelleDuCode("inconnu", t as never)).toBe("cab.code.autre");
  });

  it("nomme l'hésitation sur un montant, et la décision qui l'a levée", () => {
    // « Signalement de lecture » ne dit pas quoi faire. Ces deux-là, si :
    // l'un demande une confirmation, l'autre explique pourquoi il n'y en a pas.
    expect(libelleDuCode("SEPARATEUR_AMBIGU", t as never)).toBe("cab.code.separateur");
    expect(libelleDuCode("DECIDE_PAR_ARITHMETIQUE", t as never)).toBe("cab.code.arithmetique");
  });

  it("nomme chaque contrôle du jugement, jamais « Signalement de lecture »", () => {
    // Le panneau du cabinet intitulait chaque contrôle « Signalement de
    // lecture. » ; la réserve « immobilisation à trancher » doit dire sa question.
    expect(libelleDuControle("immobilisation_a_trancher", t as never)).toBe(
      "cab.controle.immobilisation_a_trancher",
    );
    // Sous le seuil du cabinet (31 octobre 2026) : une réserve qui se nomme aussi.
    expect(libelleDuControle("immobilisation_faible_valeur", t as never)).toBe(
      "cab.controle.immobilisation_faible_valeur",
    );
    expect(libelleDuControle("nature_piece", t as never)).toBe("cab.controle.nature_piece");
    expect(libelleDuControle("inconnu", t as never)).toBe("cab.code.autre");
  });

  it("traduit une action d'audit et retombe sur une phrase générique", () => {
    expect(libelleDeLAction("extract.v1", t as never)).toBe("cab.audit.extract");
    expect(libelleDeLAction("ecriture.booked", t as never)).toBe("cab.notif.kind.ecriture.booked");
    expect(libelleDeLAction("immo.prorata", t as never)).toBe("cab.audit.autre");
    // Le dépôt et la lecture décomptée se disent : plus d'« Événement du dossier ».
    expect(libelleDeLAction("piece.recue", t as never)).toBe("cab.journal.piece.recue");
    expect(libelleDeLAction("lecture.consommee", t as never)).toBe("cab.journal.lecture.consommee");
  });

  it("dit où la pièce est allée, et qui l'a précisée, quand le payload le porte", () => {
    const lit = (action: string, payload: unknown) => libelleDeLAction(action, t as never, payload);
    expect(lit("piece.vis_changed", { from: "entite", to: "partage" })).toBe(
      "cab.journal.piece.vers_cabinet",
    );
    expect(lit("piece.vis_changed", { from: "partage", to: "entite", par_accord: true })).toBe(
      "cab.journal.piece.rendue",
    );
    expect(lit("piece.vis_changed", { from: "personnel", to: "entite" })).toBe(
      "cab.journal.piece.rangee_societe",
    );
    expect(lit("piece.vis_changed", { from: "partage", to: "entite" })).toBe(
      "cab.journal.piece.vers_societe",
    );
    expect(lit("piece.vis_changed", { from: "entite", to: "personnel" })).toBe(
      "cab.journal.piece.vers_mon_espace",
    );
    // Le type établi par le cabinet n'est pas une précision du client.
    expect(
      lit("piece.precisee", {
        champ: "document_kind",
        valeur: "facture_achat",
        par_le_cabinet: true,
      }),
    ).toBe("cab.journal.piece.type_etabli");
    expect(lit("piece.precisee", { champ: "document_kind", valeur: "facture_vente" })).toBe(
      "cab.journal.piece.type_corrige",
    );
    expect(lit("piece.precisee", { champ: "document_date", valeur: "2026-10-01" })).toBe(
      "cab.journal.piece.date_corrigee",
    );
    expect(lit("piece.demande", { objet: "suppression" })).toBe(
      "cab.notif.kind.piece.demande.suppression",
    );
    expect(lit("piece.demande_tranchee", { objet: "rappel", accorde: false })).toBe(
      "cab.journal.piece.demande_refusee",
    );
  });

  it("garde la phrase du genre pour un payload ancien, sans deviner", () => {
    expect(libelleDeLAction("piece.vis_changed", t as never, {})).toBe(
      "cab.notif.kind.piece.vis_changed",
    );
    expect(libelleDeLAction("piece.precisee", t as never, null)).toBe(
      "cab.notif.kind.piece.precisee",
    );
    expect(libelleDeLAction("piece.demande_tranchee", t as never, { objet: "rappel" })).toBe(
      "cab.notif.kind.piece.demande_tranchee",
    );
  });
});

describe("pourquoi une pièce n'est pas lue", () => {
  /*
   * Deux défauts de la même famille, et ils ont le même remède.
   *
   * Le premier : `piece_personnelle` s'affichait TEL QUEL à l'écran de la
   * pièce. `libelleDuRefus` existait, était testé, et n'était pas importé par
   * l'écran qui en avait besoin — la quatrième fois dans ce dépôt.
   *
   * Le second : trente pièces privées disaient « En attente de lecture »
   * parce qu'aucun refus n'avait été inscrit pour elles. Elles n'attendaient
   * rien : une pièce personnelle n'est jamais lue. Cet état se DÉRIVE de la
   * visibilité — on ne réécrit pas un fait pour le rattraper (R7).
   */
  it("traduit chaque motif que la base inscrit", () => {
    expect(libelleDuRefus("piece_personnelle", t as never)).toBe("pme.refus.piece_personnelle");
    expect(libelleDuRefus("plafond_atteint", t as never)).toBe("pme.refus.plafond_atteint");
    expect(libelleDuRefus("piece_remplacee", t as never)).toBe("pme.refus.piece_remplacee");
    expect(libelleDuRefus("licence_resiliee", t as never)).toBe("pme.refus.licence.autre");
    expect(libelleDuRefus("inconnu", t as never)).toBe("pme.refus.autre");
  });

  it("reconnaît un motif de refus, et ne prend pas une panne pour un refus", () => {
    // Sans cette garde, l'écran de la pièce aurait repeint toute panne de
    // réseau en « je ne l'ai pas lue, et je ne sais pas pourquoi ».
    expect(motifDeRefusConnu("piece_personnelle")).toBe(true);
    expect(motifDeRefusConnu("licence_suspendue")).toBe(true);
    expect(motifDeRefusConnu("licence_nimporte_quoi")).toBe(true);
    expect(motifDeRefusConnu("Failed to fetch")).toBe(false);
    expect(motifDeRefusConnu("lecture.illisible")).toBe(false);
  });

  it("une pièce privée sans refus inscrit n'attend rien : elle est privée", () => {
    expect(motifDeLEtat(null, "personnel")).toBe("piece_personnelle");
    expect(motifDeLEtat(undefined, "personnel")).toBe("piece_personnelle");
  });

  it("une pièce de la société ou du cabinet sans refus attend bien son tour", () => {
    expect(motifDeLEtat(null, "entite")).toBeNull();
    expect(motifDeLEtat(null, "partage")).toBeNull();
  });

  it("dans l'espace privé, un refus inscrit gagne sur celui que la visibilité implique", () => {
    // Le forfait se recharge, la visibilité non : c'est le plafond qu'il faut
    // dire, parce que c'est lui qui a tranché en dernier.
    expect(motifDeLEtat({ motif: "plafond_atteint" }, "personnel")).toBe("plafond_atteint");
  });

  it("une fois la pièce entrée dans la société, le refus « pièce personnelle » se tait", () => {
    /*
     * Relevé à l'écran le 18 octobre 2026 : une pièce qu'on venait de faire
     * entrer dans la société affichait encore « je ne la lis pas tant que
     * vous ne la transmettez pas ». Le refus avait bien eu lieu, et on ne le
     * réécrit pas (R7) — mais il ne décrit plus l'état de la pièce.
     */
    expect(motifDeLEtat({ motif: "piece_personnelle" }, "entite")).toBeNull();
    expect(motifDeLEtat({ motif: "piece_personnelle" }, "partage")).toBeNull();
  });

  it("un plafond ou une licence suspendue, eux, ne se lèvent pas en déplaçant la pièce", () => {
    expect(motifDeLEtat({ motif: "plafond_atteint" }, "entite")).toBe("plafond_atteint");
    expect(motifDeLEtat({ motif: "licence_suspendue" }, "partage")).toBe("licence_suspendue");
  });
});
