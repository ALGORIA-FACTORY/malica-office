/**
 * Le circuit n'a pas d'impasse (revue Codex de #146).
 *
 * Trouvé par la revue : le propriétaire « garde » la pièce d'un siège, puis
 * accorde son rappel. Le rappel s'inscrivait, mais la garde restait posée :
 * la pièce restait « Gardée », et le siège perdait « Envoyer ».
 *
 * Plutôt qu'une épreuve par séquence connue, celle-ci PARCOURT le circuit :
 * depuis une pièce de siège, elle joue chaque geste que les écrans proposent
 * (`gestesDuCircuit`, `demandeDuSiegeATrancher`, sous les droits réels de
 * chacun), en largeur, jusqu'à cinq gestes. Chaque état atteint est rejoué sur
 * une pièce neuve, par les vraies portes. À chaque pas :
 *   - quelqu'un a un geste — la société, ou le comptable si la pièce est chez
 *     lui : rien ne bloque ;
 *   - le statut lu dit le DERNIER fait : ce qu'on vient de faire.
 * Deux états qui se lisent pareil ne sont explorés qu'une fois.
 *
 *   node --experimental-strip-types --test src/le-circuit-n-a-pas-d-impasse.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  demandeDuSiegeATrancher,
  etatDeMaDemande,
  gestesDuCircuit,
  resteAEnvoyer,
} from "@malica/socle/circuit";
import type { Droit, EtatDeDemande, PieceLue } from "@malica/socle/ports/repositories";
import { statutDuCircuit, type StatutDuCircuit } from "@malica/socle/statut-d-envoi";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

type Geste =
  | "siege.envoyer"
  | "siege.demander_rappel"
  | "proprietaire.envoyer"
  | "proprietaire.garder"
  | "proprietaire.retourner"
  | "proprietaire.accorder"
  | "proprietaire.refuser"
  | "cabinet.retourner";

interface Vue {
  statut: StatutDuCircuit;
  vis: string;
}

interface Etat {
  siege: Vue;
  proprietaire: Vue;
  gestes: Geste[];
  /** Ce que l'envoi EN LOT compterait, pour chacun (le seul prédicat). */
  lot: { siege: boolean; proprietaire: boolean; gardee: boolean };
}

const PROFONDEUR = 5;

describe("le circuit n'a pas d'impasse", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  const droits = {} as Record<Personne, Droit[]>;

  before(async () => {
    s = await monterUneSociete(`impasse-${Date.now()}`);
    for (const qui of ["sami", "amel"] as const)
      droits[qui] = ((await s.fait(qui, "acces.monAcces", s.pme)) as { droits: Droit[] }).droits;
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const lue = async (qui: Personne, id: string) => {
    const liste = (await s.fait(qui, "capture.listAvecLecture", s.pme)) as PieceLue[];
    const p = liste.find((x) => x.id === id);
    assert.ok(p, `${qui} lit la pièce`);
    return p;
  };
  const demandes = (qui: Personne, id: string) =>
    s.fait(qui, "collab.etatDesDemandes", id) as Promise<EtatDeDemande[]>;

  /** Ce que chacun voit, et les gestes que les écrans lui proposent. */
  const lire = async (id: string): Promise<Etat> => {
    const gestes: Geste[] = [];
    const ps = await lue("sami", id);
    const vs = statutDuCircuit(ps);
    const gs = gestesDuCircuit(
      { ...ps, gardeeLe: ps.gardeeLe ?? null, circuit: ps.circuit ?? null, statut: vs },
      droits.sami,
      true,
    );
    const ds = await demandes("sami", id);
    if (gs.envoyer === "proprietaire" || (gs.renvoyer && vs.chez === "proprietaire"))
      gestes.push("siege.envoyer");
    const maDemande = etatDeMaDemande(ds, "rappel", gs.demanderA);
    if (gs.demanderA === "proprietaire" && maDemande?.fait !== "demandee")
      gestes.push("siege.demander_rappel");

    const pp = await lue("amel", id);
    const vp = statutDuCircuit(pp);
    const gp = gestesDuCircuit(
      { ...pp, gardeeLe: pp.gardeeLe ?? null, circuit: pp.circuit ?? null, statut: vp },
      droits.amel,
      true,
    );
    const dp = await demandes("amel", id);
    if (gp.envoyer === "cabinet" || (gp.renvoyer && vp.chez === "cabinet"))
      gestes.push("proprietaire.envoyer");
    if (gp.garder || gp.garderLeRetour) gestes.push("proprietaire.garder");
    if (gp.retournerAuSiege) gestes.push("proprietaire.retourner");
    if (demandeDuSiegeATrancher(dp, droits.amel) === "rappel")
      gestes.push("proprietaire.accorder", "proprietaire.refuser");

    // Le comptable : la pièce est chez lui, ni retournée ni prise en charge.
    if (pp.vis === "partage" && pp.status !== "retournee") gestes.push("cabinet.retourner");

    // Le lot compte ce que la fiche propose d'envoyer — hors décision de garder,
    // qui ne porte que sur l'envoi au comptable.
    const lotSiege = resteAEnvoyer(ps, droits.sami, true);
    const lotProprietaire = resteAEnvoyer(pp, droits.amel, true);
    assert.equal(lotSiege, gs.envoyer, "lot du siège = sa fiche");
    assert.equal(
      lotProprietaire,
      gp.envoyer === "cabinet" && pp.gardeeLe ? null : gp.envoyer,
      "lot du propriétaire = sa fiche",
    );
    return {
      siege: { statut: vs, vis: ps.vis },
      proprietaire: { statut: vp, vis: pp.vis },
      gestes,
      lot: {
        siege: lotSiege !== null,
        proprietaire: lotProprietaire !== null,
        gardee: Boolean(pp.gardeeLe),
      },
    };
  };

  /**
   * La base tient la même règle que le lot, porte contournée : ce que le lot
   * ne compte pas pour une personne, l'envoi en lot ne le fait pas partir
   * (refus, ou rien de changé). Une garde est une décision, pas une barrière.
   */
  const sonder = async (id: string, e: Etat, chemin: string) => {
    for (const [qui, compte] of [
      ["sami", e.lot.siege],
      ["amel", e.lot.proprietaire || e.lot.gardee],
    ] as const) {
      if (compte || e.proprietaire.vis !== "entite") continue;
      await s.fait(qui, "collab.transmettreLesPieces", [id]).catch(() => undefined);
      const apres = await lire(id);
      assert.equal(cle(apres), cle(e), `${chemin} : le lot de ${qui} n'a rien fait partir`);
    }
  };

  const motif = () => s.motifs["piece_illisible"];
  const jouer = async (id: string, g: Geste) => {
    // Le propriétaire décide sur la fiche : l'ouvrir la « voit », comme à l'écran.
    if (g.startsWith("proprietaire.")) await s.fait("amel", "supervision.voir", id);
    switch (g) {
      case "siege.envoyer":
        return s.fait("sami", "collab.envoyer", id);
      case "siege.demander_rappel":
        return s.fait("sami", "collab.demanderSurPiece", id, "rappel");
      case "proprietaire.envoyer":
        return s.fait("amel", "collab.envoyer", id);
      case "proprietaire.garder":
        return s.fait("amel", "collab.garderPiece", id);
      case "proprietaire.retourner":
        return s.fait("amel", "supervision.retourner", {
          pieceId: id,
          motifId: motif(),
          note: "R",
        });
      case "proprietaire.accorder":
        return s.fait("amel", "collab.repondreSurPiece", id, "rappel", true, null);
      case "proprietaire.refuser":
        return s.fait("amel", "collab.repondreSurPiece", id, "rappel", false, "Non");
      case "cabinet.retourner":
        return s.fait("expert", "supervision.retourner", {
          pieceId: id,
          motifId: motif(),
          note: "C",
        });
    }
  };

  /** Le statut dit le dernier fait. */
  const ditLeDernierFait = (g: Geste, e: Etat, avant: Etat, chemin: string) => {
    const enSociete = avant.proprietaire.vis === "entite";
    switch (g) {
      case "siege.envoyer":
        assert.equal(e.siege.statut.chez, "proprietaire", chemin);
        assert.ok(["recue", "corrigee"].includes(e.proprietaire.statut.statut), chemin);
        break;
      case "proprietaire.garder":
        assert.equal(e.proprietaire.statut.statut, "gardee", chemin);
        break;
      case "proprietaire.envoyer":
        assert.equal(e.proprietaire.statut.chez, "cabinet", chemin);
        break;
      case "proprietaire.retourner":
        assert.deepEqual(
          [e.siege.statut.statut, e.siege.statut.chez],
          ["retour", "proprietaire"],
          chemin,
        );
        break;
      case "proprietaire.accorder":
        if (enSociete) {
          // Rendue au siège, dans la société : à envoyer de nouveau.
          assert.equal(e.siege.statut.statut, "a_envoyer", chemin);
          assert.ok(e.gestes.includes("siege.envoyer"), `${chemin} : le siège renvoie`);
        }
        break;
      case "cabinet.retourner":
        assert.deepEqual(
          [e.proprietaire.statut.statut, e.proprietaire.statut.chez],
          ["retour", "cabinet"],
          chemin,
        );
        break;
      default:
        break;
    }
  };

  /** Une pièce de Sami, lue, dans la société, puis le chemin rejoué. */
  const rejouer = async (chemin: readonly Geste[]) => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    for (const g of chemin) await jouer(id, g);
    return id;
  };

  const cle = (e: Etat) => JSON.stringify([e.siege, e.proprietaire, [...e.gestes].sort()]);

  it("la garde du propriétaire ne survit pas au rappel qu'il accorde", async () => {
    const id = await rejouer(["siege.envoyer", "proprietaire.garder", "siege.demander_rappel"]);
    await jouer(id, "proprietaire.accorder");
    const e = await lire(id);
    assert.equal(e.siege.statut.statut, "a_envoyer");
    assert.ok(e.gestes.includes("siege.envoyer"));
    // Renvoyée, le propriétaire peut la garder de nouveau : pas « déjà gardée ».
    await jouer(id, "siege.envoyer");
    const r = (await s.fait("amel", "collab.garderPiece", id)) as { changed: boolean };
    assert.equal(r.changed, true);
  });

  it("chaque suite de gestes jusqu'à cinq laisse un geste, et dit son dernier fait", async () => {
    const vus = new Set<string>();
    let file: Array<{ chemin: Geste[]; etat: Etat }> = [];
    const depart = await lire(await rejouer([]));
    vus.add(cle(depart));
    file.push({ chemin: [], etat: depart });
    let parcourus = 0;
    for (let profondeur = 0; profondeur < PROFONDEUR && file.length > 0; profondeur += 1) {
      const suivante: typeof file = [];
      for (const { chemin, etat } of file) {
        for (const g of etat.gestes) {
          const nouveau = [...chemin, g];
          const id = await rejouer(nouveau);
          const e = await lire(id);
          await sonder(id, e, nouveau.join(" → "));
          parcourus += 1;
          const nom = nouveau.join(" → ");
          const societe = e.gestes.some((x) => !x.startsWith("cabinet."));
          assert.ok(
            societe || (e.proprietaire.vis === "partage" && e.gestes.length > 0),
            `${nom} : personne n'a de geste`,
          );
          ditLeDernierFait(g, e, etat, nom);
          const k = cle(e);
          if (!vus.has(k)) {
            vus.add(k);
            suivante.push({ chemin: nouveau, etat: e });
          }
        }
      }
      file = suivante;
    }
    assert.ok(parcourus >= 10, `${parcourus} suites parcourues`);
  });
});
