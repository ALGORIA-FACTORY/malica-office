/**
 * L'outil `achats_par_fournisseur` : le moteur du Socle somme, le serveur
 * compose le tableau, le modèle ne reçoit que des chiffres qu'il peut citer.
 * Sans base ni réseau : l'API est un dossier fictif.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppelApi } from "../appel-local.ts";
import { chiffresDe } from "./garde.ts";
import { executerOutil, LECTURES_DES_OUTILS, type ContexteDesOutils } from "./outils.ts";

const piece = (
  emetteur: string | null,
  total: string | null,
  date: string,
  kind = "facture_achat",
) => ({
  id: crypto.randomUUID(),
  status: "lue",
  createdAt: `${date}T08:00:00Z`,
  vis: "entite",
  emetteur,
  dateDocument: date,
  kind,
  typeDeDocument: null,
  total,
  devise: "TND",
});

const PIECES = [
  piece("Sismara Plasturgie SA", "7872.677", "2026-10-28"),
  piece("SISMARA PLASTURGIE SA", "127.323", "2026-11-02"),
  piece("Electro Import Tunisie", "4999.000", "2026-10-09"),
  piece("Kordane Digital SUARL", "4210.500", "2026-10-12"),
  piece("Émetteur illisible", null, "2026-10-13"),
  piece("Client X", "99999.000", "2026-10-14", "facture_vente"),
];

const SOC_A = "11111111-1111-4111-8111-111111111111";
const SOC_B = "22222222-2222-4222-8222-222222222222";
const SOC_C = "33333333-3333-4333-8333-333333333333";

const TOTAUX = [
  { mois: "2026-10", classe: "7", debit: "0.000", credit: "186300.000" },
  { mois: "2026-10", classe: "6", debit: "150700.500", credit: "0.000" },
  { mois: "2026-11", classe: "6", debit: "3759.500", credit: "0.000" },
  // Une classe de bilan : elle n'entre ni dans les produits ni dans les charges.
  { mois: "2026-11", classe: "4", debit: "0.000", credit: "999.000" },
];

function contexte(
  pieces = PIECES,
  totaux: typeof TOTAUX = TOTAUX,
): { ctx: ContexteDesOutils; appels: string[] } {
  const appels: string[] = [];
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string): Promise<T> {
      const nom = `${depot}.${methode}`;
      appels.push(nom);
      if (nom === "referentiel.activePack") return { id: "pack-tn" } as T;
      if (nom === "referentiel.socleParams") return { moneyDecimals: 3 } as T;
      if (nom === "capture.listAvecLecture") return pieces as T;
      if (nom === "capture.listAvecLectureDesSocietes")
        return [
          { tenantId: SOC_A, pieces },
          {
            tenantId: SOC_B,
            pieces: [
              piece("Nous", "5000.000", "2026-10-03", "facture_vente"),
              piece("Nous", "2500.500", "2026-11-04", "facture_vente"),
              piece("Un fournisseur", "300.000", "2026-11-05"),
            ],
          },
        ] as T;
      if (nom === "referentiel.classesDeComptes")
        return [
          { prefix: "6", nature: "charge" },
          { prefix: "7", nature: "produit" },
          { prefix: "4", nature: "passif" },
        ] as T;
      if (nom === "office.totauxParClasse") return totaux as T;
      throw new Error(`appel non prévu : ${nom}`);
    },
    async contenu() {
      throw new Error("le modèle ne lit jamais les octets d'une pièce (R2)");
    },
  };
  return {
    appels,
    ctx: {
      api,
      tenantId: "11111111-1111-4111-8111-111111111111",
      locale: "fr",
      organisation: { jurisdiction: "TN", currency: "TND", name: "SOTUMAG d'essai" },
      aujourdhui: "2026-11-10",
      conseil: () => {
        throw new Error("le conseil ne devait pas être appelé");
      },
      idProposition: () => "p",
    },
  };
}

describe("achats_par_fournisseur", () => {
  it("somme tout le dossier, classe, et dit ce qu'il écarte — par des lectures seulement", async () => {
    const { ctx, appels } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    assert.ok(r.ok);
    if (!r.ok) return;
    const texte = r.sources[0]!.texte.replace(/\s/g, " ");
    assert.match(texte, /Total des achats comptés : 17 209,500 TND/);
    assert.match(texte, /- 1\. Sismara Plasturgie SA : 8 000,000 TND \(2 pièces\)/);
    assert.match(texte, /- 2\. Electro Import Tunisie : 4 999,000 TND \(1 pièce\)/);
    assert.match(texte, /Achats écartés des sommes : 1 sans total lisible/);
    // La vente n'entre nulle part.
    assert.ok(!texte.includes("99 999"));
    for (const a of appels)
      assert.ok(LECTURES_DES_OUTILS.has(a), `${a} n'est pas une lecture déclarée`);
  });

  it("compose un tableau dont chaque montant se relit dans la source remise au modèle", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    assert.equal(r.visuels![0]!.cle, r.sources[0]!.cle);
    if (bloc.type !== "tableau") throw new Error("type");
    assert.deepEqual(
      bloc.lignes.map((l) => [l["fournisseur"], l["montant"]!.replace(/\s/g, " "), l["pieces"]]),
      [
        ["Sismara Plasturgie SA", "8 000,000", "2"],
        ["Electro Import Tunisie", "4 999,000", "1"],
        ["Kordane Digital SUARL", "4 210,500", "1"],
      ],
    );
    assert.equal(bloc.total!["montant"]!.replace(/\s/g, " "), "17 209,500");
    assert.equal(bloc.perimetre, "SOTUMAG d'essai");
    // Aucun chiffre du tableau que la garde ne retrouverait pas dans la source.
    const connus = new Set(chiffresDe(r.sources[0]!.texte));
    for (const l of [...bloc.lignes, bloc.total!])
      for (const n of chiffresDe(l["montant"]!))
        assert.ok(connus.has(n), `chiffre sans source : ${n}`);
  });

  it("avec un mois, ne compte que les factures datées de ce mois, et le dit", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", { mois: "2026-11" });
    if (!r.ok) throw new Error("outil en échec");
    assert.match(r.sources[0]!.texte, /factures datées de 2026-11/);
    assert.match(r.sources[0]!.texte, /Total des achats comptés : 127,323 TND/);
    const bloc = r.visuels![0]!.bloc;
    assert.equal(bloc.periode, "Novembre 2026");
  });

  it("sans achat compté : aucun montant, aucun visuel", async () => {
    const { ctx } = contexte([piece("Client X", "10.000", "2026-10-14", "facture_vente")]);
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    if (!r.ok) throw new Error("outil en échec");
    assert.match(r.sources[0]!.texte, /ne donne aucun montant/);
    assert.equal(r.visuels, undefined);
  });

  it("refuse un mois mal écrit sans rien lire", async () => {
    const { ctx, appels } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", { mois: "novembre" });
    assert.equal(r.ok, false);
    assert.deepEqual(appels, []);
  });
});

describe("le tableau des achats se trie et s'ouvre", () => {
  it("rend, par colonne, l'ordre croissant des lignes — l'écran ne compare aucun montant", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "tableau") throw new Error("type");
    // Lignes : 0 Sismara (8000.000, 2), 1 Electro (4999.000, 1), 2 Kordane (4210.500, 1).
    assert.deepEqual(bloc.ordres, {
      fournisseur: [1, 2, 0],
      montant: [2, 1, 0],
      pieces: [1, 2, 0],
    });
  });

  it("donne les pièces derrière chaque ligne, avec leur date et leur montant", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "tableau") throw new Error("type");
    assert.equal(bloc.pieces!.length, bloc.lignes.length);
    assert.deepEqual(
      bloc.pieces![0]!.map((p) => p.titre.replace(/\s/g, " ")),
      ["28/10/2026 · 7 872,677 TND", "02/11/2026 · 127,323 TND"],
    );
    assert.deepEqual(
      bloc.pieces![0]!.map((p) => p.id),
      [PIECES[0]!.id, PIECES[1]!.id],
    );
    // Aucune pièce d'un autre fournisseur, ni la vente, ni la pièce sans total.
    const ouvertes = new Set(bloc.pieces!.flatMap((l) => (l ?? []).map((p) => p.id)));
    assert.ok(!ouvertes.has(PIECES[4]!.id) && !ouvertes.has(PIECES[5]!.id));
  });
});

describe("evolution_mensuelle", () => {
  it("somme par mois, laisse vide le mois sans pièce, et dit que ce n'est pas un chiffre d'affaires", async () => {
    const { ctx, appels } = contexte();
    const r = await executerOutil(ctx, "evolution_mensuelle", { mois: 3 });
    if (!r.ok) throw new Error("outil en échec");
    const texte = r.sources[0]!.texte.replace(/\s/g, " ");
    assert.match(texte, /de Septembre 2026 à Novembre 2026 \(2026-09 à 2026-11\)/);
    assert.match(texte, /pas un chiffre d'affaires comptable/);
    assert.match(
      texte,
      /- Septembre 2026 \(2026-09\) : ventes aucune pièce lue ; achats aucune pièce lue/,
    );
    assert.match(
      texte,
      /- Octobre 2026 \(2026-10\) : ventes 99 999,000 TND \(1 pièce\) ; achats 17 082,177 TND \(3 pièces\)/,
    );
    assert.match(
      texte,
      /- Novembre 2026 \(2026-11\) : ventes aucune pièce lue ; achats 127,323 TND \(1 pièce\)/,
    );
    assert.match(texte, /Factures écartées des sommes : 1 sans total lisible/);
    for (const a of appels)
      assert.ok(LECTURES_DES_OUTILS.has(a), `${a} n'est pas une lecture déclarée`);
  });

  it("compose des barres dont la hauteur est rapportée à la plus haute, sans valeur pour un mois vide", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "evolution_mensuelle", { mois: 3 });
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "graphique") throw new Error("type");
    assert.equal(bloc.forme, "barres");
    assert.equal(bloc.unite, "TND");
    assert.deepEqual(
      bloc.series.map((s) => [s.nom, s.ton]),
      [
        ["Ventes", "positif"],
        ["Achats", "neutre"],
      ],
    );
    const [ventes, achats] = bloc.series;
    assert.deepEqual(
      ventes!.points.map((p) => [p.valeur?.replace(/\s/g, " ") ?? null, p.part]),
      [
        [null, 0],
        ["99 999,000", 1],
        [null, 0],
      ],
    );
    assert.deepEqual(
      achats!.points.map((p) => [p.valeur?.replace(/\s/g, " ") ?? null, p.part]),
      [
        [null, 0],
        ["17 082,177", 0.171],
        ["127,323", 0.001],
      ],
    );
    assert.equal(bloc.periode, "Septembre 2026 – Novembre 2026");
    // Chaque valeur affichée se relit dans la source remise au modèle.
    const connus = new Set(chiffresDe(r.sources[0]!.texte));
    for (const s of bloc.series)
      for (const p of s.points)
        for (const n of chiffresDe(p.valeur ?? ""))
          assert.ok(connus.has(n), `chiffre sans source : ${n}`);
  });

  it("sans facture dans la période : aucun montant, aucun visuel ; un nombre de mois hors bornes est refusé", async () => {
    const { ctx } = contexte([piece("X", "10.000", "2020-01-01")]);
    const r = await executerOutil(ctx, "evolution_mensuelle", {});
    if (!r.ok) throw new Error("outil en échec");
    assert.match(r.sources[0]!.texte, /ne donne aucun montant/);
    assert.equal(r.visuels, undefined);
    assert.equal((await executerOutil(ctx, "evolution_mensuelle", { mois: 99 })).ok, false);
  });
});

describe("resultat_comptabilise", () => {
  it("rend produits, charges et résultat du moteur, sur des totaux par classe — jamais des écritures", async () => {
    const { ctx, appels } = contexte();
    const r = await executerOutil(ctx, "resultat_comptabilise", { mois: 2 });
    if (!r.ok) throw new Error("outil en échec");
    const texte = r.sources[0]!.texte.replace(/\s/g, " ");
    assert.match(texte, /de Octobre 2026 à Novembre 2026 \(2026-10 à 2026-11\)/);
    assert.match(texte, /Produits : 186 300,000 TND/);
    assert.match(texte, /Charges : 154 460,000 TND/);
    assert.match(texte, /Résultat : 31 840,000 TND/);
    assert.match(texte, /pas encore inscrites n'y sont pas/);
    assert.ok(appels.includes("office.totauxParClasse"));
    for (const a of appels)
      assert.ok(LECTURES_DES_OUTILS.has(a), `${a} n'est pas une lecture déclarée`);
  });

  it("compose une cascade : les charges descendent du sommet des produits, le résultat repart de zéro", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "resultat_comptabilise", { mois: 2 });
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "cascade") throw new Error("type");
    assert.deepEqual(
      bloc.etapes.map((e) => [e.libelle, e.valeur.replace(/\s/g, " "), e.ton, e.debut, e.fin]),
      [
        ["Produits", "186 300,000", "neutre", 0, 1],
        ["Charges", "154 460,000", "negatif", 0.171, 1],
        ["Résultat", "31 840,000", "positif", 0, 0.171],
      ],
    );
    assert.equal(bloc.periode, "Octobre 2026 – Novembre 2026");
    assert.deepEqual(bloc.feuille, {
      entete: ["Libellé", "Montant (TND)"],
      lignes: [
        [{ texte: "Produits" }, { montant: "186300.000" }],
        [{ texte: "Charges" }, { montant: "154460.000" }],
      ],
      totaux: [[{ texte: "Résultat" }, { montant: "31840.000" }]],
    });
  });

  it("une perte se dit en négatif, et la barre des charges bute à zéro", async () => {
    const { ctx } = contexte(PIECES, [
      { mois: "2026-11", classe: "7", debit: "0.000", credit: "100.000" },
      { mois: "2026-11", classe: "6", debit: "400.000", credit: "0.000" },
    ]);
    const r = await executerOutil(ctx, "resultat_comptabilise", { mois: 1 });
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "cascade") throw new Error("type");
    assert.deepEqual(
      bloc.etapes.map((e) => [e.ton, e.debut, e.fin]),
      [
        ["neutre", 0, 0.25],
        ["negatif", 0, 0.25],
        ["negatif", 0, 0.75],
      ],
    );
    assert.match(r.sources[0]!.texte, /Résultat : -300,000 TND/);
  });

  it("sans écriture comptabilisée : aucun montant, aucun visuel", async () => {
    const { ctx } = contexte(PIECES, []);
    const r = await executerOutil(ctx, "resultat_comptabilise", {});
    if (!r.ok) throw new Error("outil en échec");
    assert.match(r.sources[0]!.texte, /ne donne aucun montant/);
    assert.equal(r.visuels, undefined);
  });
});

describe("ce qu'un bloc exporte", () => {
  it("le tableau des achats exporte TOUS les fournisseurs, en montants bruts", async () => {
    const beaucoup = Array.from({ length: 15 }, (_, i) =>
      piece(`Fournisseur ${String(i + 1).padStart(2, "0")}`, `${100 - i}.500`, "2026-10-01"),
    );
    const { ctx } = contexte(beaucoup);
    const r = await executerOutil(ctx, "achats_par_fournisseur", {});
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "tableau") throw new Error("type");
    // À l'écran : douze lignes puis « Autres fournisseurs (3) ».
    assert.equal(bloc.lignes.length, 13);
    assert.equal(bloc.lignes.at(-1)!["fournisseur"], "Autres fournisseurs (3)");
    // Dans la feuille : les quinze, et un montant qu'un tableur additionne.
    assert.equal(bloc.feuille!.lignes.length, 15);
    assert.deepEqual(bloc.feuille!.lignes[0], [
      { texte: "Fournisseur 01" },
      { montant: "100.500" },
      { montant: "1" },
    ]);
    assert.deepEqual(bloc.feuille!.totaux, [
      [{ texte: "Total" }, { montant: "1402.500" }, { montant: "15" }],
    ]);
  });

  it("au-delà de douze mois, l'évolution passe en courbe ; un mois vide reste une cellule vide", async () => {
    const { ctx } = contexte();
    const r = await executerOutil(ctx, "evolution_mensuelle", { mois: 18 });
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "graphique") throw new Error("type");
    assert.equal(bloc.forme, "courbe");
    assert.equal(bloc.series[0]!.points.length, 18);
    const septembre = bloc.feuille!.lignes.find(
      (l) => "texte" in l[0]! && l[0].texte === "2026-09",
    )!;
    assert.deepEqual(septembre, [{ texte: "2026-09" }, { texte: "" }, { texte: "" }]);
    const douze = await executerOutil(ctx, "evolution_mensuelle", { mois: 12 });
    if (!douze.ok) throw new Error("outil en échec");
    assert.equal((douze.visuels![0]!.bloc as { forme: string }).forme, "barres");
  });
});

describe("comparer_les_societes", () => {
  const avecSocietes = (societes: ContexteDesOutils["societes"]) => {
    const c = contexte();
    return { ...c, ctx: { ...c.ctx, ...(societes ? { societes } : {}) } };
  };
  const DEUX = [
    { id: SOC_A, name: "SOTUMAG d'essai", currency: "TND" },
    { id: SOC_B, name: "Nordex SARL", currency: "TND" },
  ];

  it("sans périmètre élargi, il ne regarde rien : le modèle ne peut pas l'ouvrir lui-même", async () => {
    for (const societes of [undefined, [DEUX[0]!]]) {
      const { ctx, appels } = avecSocietes(societes);
      const r = await executerOutil(ctx, "comparer_les_societes", {
        societes: [SOC_B],
        tenantId: SOC_B,
      });
      assert.equal(r.ok, false);
      assert.deepEqual(appels, []);
    }
  });

  it("ne lit que les sociétés que le serveur a établies, et somme chacune par mois", async () => {
    const { ctx, appels } = avecSocietes(DEUX);
    const r = await executerOutil(ctx, "comparer_les_societes", { mois: 3 });
    if (!r.ok) throw new Error("outil en échec");
    const texte = r.sources[0]!.texte.replace(/\s/g, " ");
    assert.match(texte, /Comparaison de 2 sociétés, de Septembre 2026 à Novembre 2026/);
    assert.match(texte, /- SOTUMAG d'essai : ventes 99 999,000 TND, achats 17 209,500 TND/);
    assert.match(texte, /- Nordex SARL : ventes 7 500,500 TND, achats 300,000 TND/);
    assert.match(texte, /pas un chiffre d'affaires comptable/);
    for (const a of appels)
      assert.ok(LECTURES_DES_OUTILS.has(a), `${a} n'est pas une lecture déclarée`);
  });

  it("compose une carte : une ligne par société, une case par mois, teintée par rapport à la plus forte", async () => {
    const { ctx } = avecSocietes(DEUX);
    const r = await executerOutil(ctx, "comparer_les_societes", { mois: 3 });
    if (!r.ok) throw new Error("outil en échec");
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "carte") throw new Error("type");
    assert.equal(bloc.colonnes.length, 3);
    assert.equal(bloc.perimetre, "2 sociétés");
    assert.deepEqual(
      bloc.lignes.map((l) => [
        l.libelle,
        l.cellules.map((c) => [c.valeur?.replace(/\s/g, " ") ?? null, c.part]),
        l.total.replace(/\s/g, " "),
      ]),
      [
        [
          "SOTUMAG d'essai",
          [
            [null, 0],
            ["99 999,000", 1],
            [null, 0],
          ],
          "99 999,000",
        ],
        [
          "Nordex SARL",
          [
            [null, 0],
            ["5 000,000", 0.05],
            ["2 500,500", 0.025],
          ],
          "7 500,500",
        ],
      ],
    );
    assert.deepEqual(bloc.feuille!.entete, [
      "Société",
      "2026-09",
      "2026-10",
      "2026-11",
      "Total (TND)",
    ]);
    assert.deepEqual(bloc.feuille!.lignes[1], [
      { texte: "Nordex SARL" },
      { texte: "" },
      { montant: "5000.000" },
      { montant: "2500.500" },
      { montant: "7500.500" },
    ]);
  });

  it("une société dans une autre devise reste hors de la carte, et c'est dit", async () => {
    const { ctx } = avecSocietes([...DEUX, { id: SOC_C, name: "Dakar SAS", currency: "XOF" }]);
    const r = await executerOutil(ctx, "comparer_les_societes", {});
    if (!r.ok) throw new Error("outil en échec");
    assert.match(
      r.sources[0]!.texte,
      /1 société dans une autre devise que TND : hors de cette comparaison/,
    );
    const bloc = r.visuels![0]!.bloc;
    if (bloc.type !== "carte") throw new Error("type");
    assert.deepEqual(
      bloc.lignes.map((l) => l.libelle),
      ["SOTUMAG d'essai", "Nordex SARL"],
    );
  });
});
