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
import type { EtapeDeLAppareil, SuiviDeTrace } from "@malica/socle/ports/repositories";

import { creerVidage, FilePleine, suiviDuPas, type PortsDuVidage } from "../vidage";

/*
 * ============================ POURQUOI L'ENTRÉE TYPE N'EST PLUS « PERSONNEL »
 *
 * Elle l'était, et tous ces cas attendaient une lecture derrière le dépôt.
 * C'était justement le défaut : `public.lecture_autorisee` refuse toute pièce
 * `personnel` (B6), et la file demandait quand même. Trente pièces
 * photographiées, zéro lue, trente refus au journal d'audit.
 *
 * Le lot type est donc une pièce destinée à la société — le cas où la lecture
 * part vraiment. Le cas `personnel` a son propre scénario, juste en dessous.
 */
const ENTREE = {
  tenantId: "t1",
  entityId: null,
  source: "photo" as const,
  vis: "entite" as const,
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

  it("un dépôt refusé parce que la pièce est déjà scellée (409) est un dépôt arrivé", async () => {
    // Même clé rejouée, ou reçu regénéré pour les mêmes règlements : les octets
    // qui font foi sont déjà chez l'API. L'élément ne reste pas en échec.
    const depot = depotMemoire();
    const r = ports({
      deposerOctets: () => new ErreurApi("le contenu de cette pièce est scellé", 409),
    });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    const cle = await v.deposer(
      { ...ENTREE, cle: "scelle", documentKind: "recu_de_paiement" },
      octets(),
    );
    const arrivee = await v.attendre(cle, 1000, "deposee");
    expect(arrivee).toMatchObject({ pieceId: "piece-scelle", etat: "deposee" });
    await v.vider();
    expect(await depot.lister()).toEqual([]);
  });

  it("les octets d'une pièce remplacée entre-temps (410) partent sans demander de lecture", async () => {
    // La photo a été reprise ailleurs avant que ses octets arrivent : l'API
    // n'en veut plus. Ce n'est ni un dépôt arrivé à relire, ni un échec à montrer.
    const depot = depotMemoire();
    const r = ports({ deposerOctets: () => new ErreurApi("refus.piece.remplacee", 410) });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    await v.deposer({ ...ENTREE, cle: "tard" }, octets());
    await v.vider();
    expect(r.appels).toEqual(["enregistrer:tard", "deposer:piece-tard"]);
    expect(await depot.lister()).toEqual([]);
  });

  it("une reprise refusée se garde comme une pièce à part, ou remplace la version actuelle", async () => {
    const depot = depotMemoire();
    const cibles: Array<string | null> = [];
    let refus = true;
    const r = ports();
    const reprise: PortsDuVidage = {
      ...r.ports,
      async enregistrer(e) {
        cibles.push(e.remplace ?? null);
        if (refus) throw new ErreurApi("refus.piece.remplacee", 400);
        return r.ports.enregistrer(e);
      },
    };
    const v = creerVidage({ depot, ports: reprise, enLigne: () => true });
    const cle = await v.deposer({ ...ENTREE, cle: "reprise", remplace: "A" }, octets());
    await v.vider();
    expect((await depot.lister())[0]).toMatchObject({
      etat: "echec_definitif",
      derniereErreur: "refus.piece.remplacee",
    });

    // « Remplacer la version actuelle » : la même photo, vers la courante.
    refus = false;
    await v.recibler(cle, "C");
    await v.vider();
    expect(cibles).toEqual(["A", "C"]);
    expect(await depot.lister()).toEqual([]);

    // « Garder comme nouvelle pièce » : sans lien.
    refus = true;
    const cle2 = await v.deposer({ ...ENTREE, cle: "libre", remplace: "A" }, octets());
    await v.vider();
    refus = false;
    await v.recibler(cle2, null);
    await v.vider();
    expect(cibles.slice(2)).toEqual(["A", null]);
    expect(await depot.lister()).toEqual([]);
  });

  it("attendre le dépôt ne conclut pas sur une pièce enregistrée mais encore vide", async () => {
    const depot = depotMemoire();
    const r = ports({ deposerOctets: () => new ErreurReseau("injoignable") });
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });
    const cle = await v.deposer({ ...ENTREE, cle: "vide" }, octets());
    const arrivee = await v.attendre(cle, 300, "deposee");
    expect(arrivee?.pieceId).toBe("piece-vide");
    expect(arrivee?.etat).toBe("enregistree");
  });

  it("un élément abandonné pendant son enregistrement ne revient pas quand l'appel aboutit", async () => {
    const depot = depotMemoire();
    let liberer: () => void = () => undefined;
    const enVol = new Promise<void>((r) => (liberer = r));
    const r = ports();
    const lent: PortsDuVidage = {
      ...r.ports,
      async enregistrer(e) {
        await enVol;
        return r.ports.enregistrer(e);
      },
    };
    const v = creerVidage({ depot, ports: lent, enLigne: () => true });
    const cle = await v.deposer({ ...ENTREE, cle: "lent" }, octets());
    await v.abandonner(cle);
    liberer();
    await v.vider();
    expect(await depot.lister()).toEqual([]);
  });

  it("un nouveau dépôt sous une clé abandonnée repart normalement", async () => {
    const depot = depotMemoire();
    const r = ports();
    let t = 0;
    const v = creerVidage({
      depot,
      ports: r.ports,
      enLigne: () => true,
      maintenant: () => Date.UTC(2026, 9, 25, 12, 0, t++),
    });
    const cle = await v.deposer({ ...ENTREE, cle: "meme-recu" }, octets());
    await v.abandonner(cle);
    await v.deposer({ ...ENTREE, cle: "meme-recu" }, octets());
    const arrivee = await v.attendre("meme-recu", 1000, "deposee");
    expect(arrivee).toMatchObject({ pieceId: "piece-meme-recu" });
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

  it("une pièce de l'espace privé est déposée, et PAS envoyée à la lecture", async () => {
    /*
     * 18 octobre 2026, mesuré sur le dossier d'atelier : 30 pièces
     * photographiées, 0 lue. Toute pièce née de l'obturateur naît
     * `personnel` — c'est la décision du 7 octobre, et elle est juste : rien
     * ne part avant d'être connu. Et `public.lecture_autorisee` refuse toute
     * pièce `personnel` : B6, l'espace privé l'est aussi du patron.
     *
     * La file demandait quand même, et récoltait un refus par pièce au
     * journal d'audit. Demander ce qu'on sait refusé n'est pas une sécurité,
     * c'est du bruit.
     *
     * Ce qui ne change pas, et c'est la règle absolue : la CAPTURE n'est
     * jamais bloquée. La pièce est enregistrée, ses octets déposés, elle
     * existe et se relit. Seule la lecture ne part pas — et c'est l'écran de
     * capture qui la demande, une fois la destination répondue.
     */
    const depot = depotMemoire();
    const r = ports();
    const v = creerVidage({ depot, ports: r.ports, enLigne: () => true });

    const cle = await v.deposer({ ...ENTREE, cle: "privee", vis: "personnel" }, octets());
    await v.attendre(cle, 1000);
    await v.vider();

    expect(r.appels).toEqual(["enregistrer:privee", "deposer:piece-privee"]);
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

describe("la trace suit la pièce, de la capture à la synchronisation", () => {
  const TRACE = "0b5c7f4e-2a51-4c1e-9d0e-6f7a1b2c3d4e";

  it("hors ligne puis deux échecs réseau : la même trace et la même clé à chaque renvoi", async () => {
    const depot = depotMemoire();
    let enLigne = false;
    let pannes = 2;
    const suivis: string[] = [];
    const noter = (pas: string, suivi: SuiviDeTrace | null) =>
      suivis.push(`${pas}:${suivi?.trace ?? "-"}:${suivi?.cle ?? "-"}`);
    const ports: PortsDuVidage = {
      async enregistrer(e) {
        noter("enregistrer", suiviDuPas(e, "enregistrer"));
        if (pannes > 0) {
          pannes -= 1;
          throw new ErreurReseau("injoignable");
        }
        return "piece-1";
      },
      async deposerOctets(_id, _o, _t, suivi) {
        noter("octets", suivi);
      },
      async demanderLaLecture(_id, suivi) {
        noter("lecture", suivi);
      },
    };
    const etapes: EtapeDeLAppareil[] = [];
    const retenues: string[] = [];
    let horloge = Date.parse("2026-11-03T08:00:00Z");
    const v = creerVidage({
      depot,
      ports,
      enLigne: () => enLigne,
      maintenant: () => horloge,
      nouvelleTrace: () => TRACE,
      parcours: {
        signaler: (e) => etapes.push(e),
        retenir: (ids, trace) => retenues.push(`${ids.join(",")}>${trace}`),
      },
    });

    // La capture, sans réseau : rangée, tracée, en attente.
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    const range = (await depot.lister())[0]!;
    expect(range).toMatchObject({ trace: TRACE, horsLigneLe: "2026-11-03T08:00:00.000Z" });
    expect(etapes.map((e) => e.etape)).toEqual(["capture", "file_hors_ligne"]);

    // Le réseau revient, tombe deux fois, puis tient : trois passes.
    enLigne = true;
    for (let i = 0; i < 3; i += 1) {
      horloge += 10 * 60 * 1000;
      await v.vider();
    }
    expect(await depot.lister()).toEqual([]);
    expect(suivis).toEqual([
      `enregistrer:${TRACE}:k1.enregistrer`,
      `enregistrer:${TRACE}:k1.enregistrer`,
      `enregistrer:${TRACE}:k1.enregistrer`,
      `octets:${TRACE}:k1.octets`,
      `lecture:${TRACE}:k1.lecture`,
    ]);
    expect(retenues).toEqual([`k1>${TRACE}`, `piece-1>${TRACE}`]);

    // Une seule trace d'un bout à l'autre ; la synchronisation nomme la pièce,
    // part une fois, et mesure l'attente depuis la mise en file.
    expect(new Set(etapes.map((e) => e.trace))).toEqual(new Set([TRACE]));
    const synchro = etapes.filter((e) => e.etape === "synchronisation");
    expect(synchro).toHaveLength(1);
    expect(synchro[0]).toMatchObject({
      issue: "ok",
      cle: "synchronisation",
      piece: "piece-1",
      debut: "2026-11-03T08:00:00.000Z",
      dureeMs: 30 * 60 * 1000,
      detail: { tentatives: 2 },
    });
    // Capture et attente se redisent à l'arrivée, avec la pièce et la même clé.
    expect(etapes.filter((e) => e.etape === "capture").map((e) => [e.cle, e.piece])).toEqual([
      ["capture", null],
      ["capture", "piece-1"],
    ]);
  });

  it("un refus définitif se dit comme une synchronisation refusée", async () => {
    const depot = depotMemoire();
    const r = ports({ enregistrer: () => new ErreurApi("refus.piece.remplacee", 400) });
    const etapes: EtapeDeLAppareil[] = [];
    const v = creerVidage({
      depot,
      ports: r.ports,
      enLigne: () => true,
      nouvelleTrace: () => TRACE,
      parcours: { signaler: (e) => etapes.push(e), retenir: () => undefined },
    });
    await v.deposer({ ...ENTREE, cle: "k1" }, octets());
    await v.vider();
    expect(etapes.find((e) => e.etape === "synchronisation")).toMatchObject({
      issue: "refus",
      trace: TRACE,
    });
  });
});
