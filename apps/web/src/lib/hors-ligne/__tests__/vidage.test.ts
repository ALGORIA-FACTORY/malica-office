/**
 * Le vidage, avec un dépôt en mémoire et des ports factices.
 *
 * Ce qu'il établit : la pièce est rangée avant tout appel ; une application
 * tuée entre deux pas reprend au pas manquant avec la même clé ; un réseau
 * absent arrête la passe et recule ; un refus n'arrête pas les autres ; dix
 * appels concurrents ne font qu'une passe ; le plafond se dit.
 */
import { describe, expect, it } from "vitest";

import { ErreurApi, ErreurReseau } from "@/lib/transport/erreurs";

import { depotMemoire } from "../depot";
import { PLAFOND_ELEMENTS } from "../file";
import { creerVidage, FilePleine, type PortsDuVidage } from "../vidage";

const ENTREE = {
  tenantId: "t1",
  entityId: null,
  source: "photo" as const,
  vis: "personnel" as const,
  contentType: "application/pdf",
  nomFichier: "recu.pdf",
};

function octets(n = 10): Blob {
  return new Blob([new Uint8Array(n)], { type: "application/pdf" });
}

/** Des ports qui comptent, et échouent quand on le leur dit. */
function ports(defauts: Partial<Record<keyof PortsDuVidage, () => Error | null>> = {}) {
  const appels: string[] = [];
  let n = 0;
  const p: PortsDuVidage = {
    async enregistrer(e) {
      appels.push(`enregistrer:${e.cle}`);
      const d = defauts.enregistrer?.();
      if (d) throw d;
      n += 1;
      return `piece-${e.cle}`;
    },
    async deposerOctets(pieceId) {
      appels.push(`deposer:${pieceId}`);
      const d = defauts.deposerOctets?.();
      if (d) throw d;
    },
    async demanderLaLecture(pieceId) {
      appels.push(`lire:${pieceId}`);
      const d = defauts.demanderLaLecture?.();
      if (d) throw d;
    },
  };
  return { ports: p, appels, enregistrees: () => n };
}

describe("un dépôt en ligne", () => {
  it("range d'abord, puis enregistre, dépose, demande la lecture, et purge", async () => {
    const depot = depotMemoire();
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    const cle = await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    const arrivee = await v.attendre(cle, 1000);
    expect(arrivee).toMatchObject({ pieceId: "piece-k1" });
    await v.vider();
    expect(r.appels).toEqual(["enregistrer:k1", "deposer:piece-k1", "lire:piece-k1"]);
    expect(await depot.lister()).toEqual([]);
  });

  it("un reçu que Malica vient de fabriquer ne repart PAS en lecture", async () => {
    /*
     * 13 octobre 2026. Trois reçus se sont retrouvés en base classés
     * « facture_vente » : déposés puis envoyés au modèle comme n'importe
     * quelle photo, ils en revenaient défigurés. Un reçu compté comme une
     * vente double le chiffre d'affaires, et il réapparaissait dans la liste
     * comme un document à classer — ces « Émetteur non trouvé » que
     * personne ne comprenait.
     *
     * Malica sait ce qu'elle vient de dessiner. La relire coûte un appel de
     * modèle pour en apprendre moins qu'elle n'en savait.
     */
    const depot = depotMemoire();
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });

    const cle = await v.deposer(
      { ...ENTREE, cle: "recu", documentKind: "recu_de_paiement" },
      octets(),
    );
    await v.attendre(cle, 1000);
    await v.vider();

    expect(r.appels).toEqual(["enregistrer:recu", "deposer:piece-recu"]);
    // Et la file se vide quand même : ne pas lire n'est pas rester coincé.
    expect(await depot.lister()).toEqual([]);
  });
});

describe("hors ligne, puis de retour", () => {
  it("garde tout, n'appelle rien, et part dans l'ordre au retour du réseau", async () => {
    const depot = depotMemoire();
    let enLigne = false;
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => enLigne });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v.deposer({ ...ENTREE, cle: "k2" }, octets());
    expect(await v.attendre("k1", 20)).toMatchObject({ etat: "a_envoyer", pieceId: null });
    expect(r.appels).toEqual([]);
    expect((await depot.lister()).map((e) => e.cle)).toEqual(["k1", "k2"]);

    enLigne = true;
    await v.vider();
    expect(r.appels).toEqual([
      "enregistrer:k1",
      "deposer:piece-k1",
      "lire:piece-k1",
      "enregistrer:k2",
      "deposer:piece-k2",
      "lire:piece-k2",
    ]);
  });
});

describe("tuée entre deux pas", () => {
  it("reprend au pas manquant, avec la même clé, sans enregistrer deux fois", async () => {
    const depot = depotMemoire();
    // Première vie : les octets tombent en panne réseau après l'enregistrement.
    let panne = true;
    const r1 = ports({ deposerOctets: () => (panne ? new ErreurReseau("hors_ligne") : null) });
    const v1 = creerVidage({ depot, ports: r1.ports, enLigne: () => true });
    await v1.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v1.vider();
    expect(r1.appels).toEqual(["enregistrer:k1", "deposer:piece-k1"]);
    const persiste = (await depot.lister())[0]!;
    expect(persiste).toMatchObject({ etat: "enregistree", pieceId: "piece-k1", tentatives: 1 });

    // Seconde vie : un nouveau vidage sur le même dépôt, une fois le délai passé.
    panne = false;
    const r2 = ports();
    const v2 = creerVidage({
      depot,
      ports: r2.ports,
      enLigne: () => true,
      maintenant: () => Date.now() + 10_000,
    });
    await v2.vider();
    expect(r2.appels).toEqual(["deposer:piece-k1", "lire:piece-k1"]);
    expect(r2.enregistrees()).toBe(0);
    expect(await depot.lister()).toEqual([]);
  });
});

describe("les échecs pendant une passe", () => {
  it("un réseau absent arrête la passe : les suivants attendent", async () => {
    const depot = depotMemoire();
    const r = ports({ enregistrer: () => new ErreurReseau("injoignable") });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v.deposer({ ...ENTREE, cle: "k2" }, octets());
    await v.vider();
    // Une seule tentative, sur le premier ; le second n'a pas été touché.
    expect(r.appels.filter((a) => a.startsWith("enregistrer")).length).toBeLessThanOrEqual(2);
    const [k1] = await depot.lister();
    expect(k1).toMatchObject({ cle: "k1", etat: "a_envoyer", tentatives: 1 });
    expect(k1!.prochainEssaiLe).not.toBeNull();
  });

  it("un refus de l'API marque l'élément, et laisse partir les suivants", async () => {
    const depot = depotMemoire();
    let premier = true;
    const r = ports({
      enregistrer: () => {
        if (premier) {
          premier = false;
          return new ErreurApi("pièce trop volumineuse", 413);
        }
        return null;
      },
    });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v.deposer({ ...ENTREE, cle: "k2" }, octets());
    await v.vider();
    const restants = await depot.lister();
    expect(restants).toHaveLength(1);
    expect(restants[0]).toMatchObject({
      cle: "k1",
      etat: "echec_definitif",
      derniereErreur: "pièce trop volumineuse",
    });
    expect(r.appels).toContain("lire:piece-k2");

    // « Réessayer » remet k1 en route ; « abandonner » le retire.
    await v.reessayer("k1");
    await v.vider();
    expect(await depot.lister()).toEqual([]);
  });

  it("un 401 arrête la passe sans compter une tentative : la session est à refaire", async () => {
    const depot = depotMemoire();
    const r = ports({ enregistrer: () => new ErreurApi("authentification requise", 401) });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v.vider();
    expect((await depot.lister())[0]).toMatchObject({ etat: "a_envoyer", tentatives: 0 });
  });
});

describe("le vol unique et le plafond", () => {
  it("dix appels concurrents ne font qu'une passe", async () => {
    const depot = depotMemoire();
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await Promise.all(Array.from({ length: 10 }, () => v.vider()));
    expect(r.appels).toEqual(["enregistrer:k1", "deposer:piece-k1", "lire:piece-k1"]);
  });

  it("au-delà du plafond, la file le dit au lieu de jeter", async () => {
    const depot = depotMemoire();
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => false });
    for (let i = 0; i < PLAFOND_ELEMENTS; i += 1) {
      await v.deposer({ ...ENTREE, cle: `k${i}` }, octets(1));
    }
    await expect(v.deposer({ ...ENTREE, cle: "trop" }, octets(1))).rejects.toBeInstanceOf(
      FilePleine,
    );
    await v.abandonner("k0");
    await expect(v.deposer({ ...ENTREE, cle: "encore" }, octets(1))).resolves.toBe("encore");
  });
});
