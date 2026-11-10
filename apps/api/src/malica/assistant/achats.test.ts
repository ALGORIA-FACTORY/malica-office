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

function contexte(pieces = PIECES): { ctx: ContexteDesOutils; appels: string[] } {
  const appels: string[] = [];
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string): Promise<T> {
      const nom = `${depot}.${methode}`;
      appels.push(nom);
      if (nom === "referentiel.activePack") return { id: "pack-tn" } as T;
      if (nom === "referentiel.socleParams") return { moneyDecimals: 3 } as T;
      if (nom === "capture.listAvecLecture") return pieces as T;
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
    const texte = r.sources[0]!.texte;
    assert.match(texte, /Total des achats comptés : 17209\.500 TND/);
    assert.match(texte, /- 1\. Sismara Plasturgie SA : 8000\.000 TND \(2 pièces\)/);
    assert.match(texte, /- 2\. Electro Import Tunisie : 4999\.000 TND \(1 pièce\)/);
    assert.match(texte, /Achats écartés des sommes : 1 sans total lisible/);
    // La vente n'entre nulle part.
    assert.ok(!texte.includes("99999"));
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
    assert.match(r.sources[0]!.texte, /Total des achats comptés : 127\.323 TND/);
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
    const texte = r.sources[0]!.texte;
    assert.match(texte, /de 2026-09 à 2026-11/);
    assert.match(texte, /pas un chiffre d'affaires comptable/);
    assert.match(texte, /- 2026-09 : ventes aucune pièce lue ; achats aucune pièce lue/);
    assert.match(
      texte,
      /- 2026-10 : ventes 99999\.000 TND \(1 pièce\) ; achats 17082\.177 TND \(3 pièces\)/,
    );
    assert.match(texte, /- 2026-11 : ventes aucune pièce lue ; achats 127\.323 TND \(1 pièce\)/);
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
