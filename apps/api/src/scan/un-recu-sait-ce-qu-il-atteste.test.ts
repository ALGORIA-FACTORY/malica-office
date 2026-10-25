/**
 * Un reçu sait ce qu'il atteste ; un justificatif se déplace, se reprend et
 * se supprime sans rien casser.
 *
 * Maquette « Reçus et justificatifs d'une pièce », validée par Wissem le
 * 25 octobre 2026 ; règles dans `20261025223000_un_recu_sait_ce_qu_il_atteste.sql`.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/scan/un-recu-sait-ce-qu-il-atteste.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

interface Fiche {
  genre: "recu" | "justificatif";
  vis: string;
  mere: { id: string; emetteur: string | null; ttc: string | null } | null;
  reglements: Array<{
    id: string;
    moyenPar: string;
    nomDeLaPreuve: string;
    montantMineur: number | null;
    eteint: boolean;
  }>;
  vaut: boolean;
  annulation: { paiementId: string; le: string; motif: string } | null;
  candidats: Array<{ id: string; tiers: string | null }>;
}

interface Ligne {
  id: string;
  justificatifPieceId: string | null;
}

describe("un reçu sait ce qu'il atteste", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `accompagne-${Date.now()}`;
  let u: Utilisateur;
  let intrus: Utilisateur;
  let org = "";
  let orgIntrus = "";
  let packId = "";
  const motifs: Record<string, string> = {};

  const rpcDe = (qui: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui.id, (db) => executerRpc(db, { depot, methode, args }));
  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    rpcDe(u, depot, methode, ...args);

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une facture lue, émise par `emetteur`. */
  async function facture(cle: string, emetteur: string, vis = "personnel") {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis,
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
    })) as { id: string };
    await admin((a) =>
      a.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', $3::jsonb)`,
        [
          org,
          p.id,
          JSON.stringify({
            issuer: emetteur,
            document_kind: "facture_achat",
            document_date: "2026-06-02",
            currency: "TND",
            totals: { ttc: "1969.610" },
          }),
        ],
      ),
    );
    return p.id;
  }

  /** Une pièce née d'une autre : un reçu (avec ce qu'il atteste) ou un talon. */
  async function nee(
    cle: string,
    source: string,
    documentKind: "recu_de_paiement" | "justificatif_paiement",
    paiementsAttestes: string[] | null = null,
    vis = "personnel",
  ) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: documentKind === "recu_de_paiement" ? "pdf" : "photo",
      vis,
      idempotencyKey: `${marque}-${cle}`,
      contentType: documentKind === "recu_de_paiement" ? "application/pdf" : "image/jpeg",
      documentKind,
      sourcePieceId: source,
      paiementsAttestes,
    })) as { id: string };
    return p.id;
  }

  async function regler(pieceId: string, moyenCode: string, justificatifPieceId?: string) {
    await rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId,
      moyenCode,
      montantMineur: 1_969_610,
      devise: "TND",
      payeLe: "2026-10-13",
      ...(justificatifPieceId ? { justificatifPieceId } : {}),
    });
    const l = await lignes(pieceId);
    return l[l.length - 1]!.id;
  }

  const lignes = async (pieceId: string) =>
    (await rpc("capture", "paiementsDUnePiece", pieceId)) as Ligne[];
  const fiche = (pieceId: string) =>
    rpc("capture", "pieceQuiAccompagne", pieceId, "fr") as Promise<Fiche | null>;
  const existe = (pieceId: string) =>
    admin(async (a) => {
      const { rows } = await a.query(`select 1 from capture.pieces where id = $1`, [pieceId]);
      return rows.length === 1;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    const i = await creerCompte(`intrus-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c && i);
    u = c;
    intrus = i;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ESSAI ACCOMPAGNE SARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    orgIntrus = await sousIdentite(intrus.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ESSAI INTRUS SARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
    for (const m of (await rpc("capture", "motifsDAnnulation", "fr")) as Array<{
      id: string;
      code: string;
      proposable: boolean;
      remplace: boolean;
    }>) {
      if (m.proposable) motifs[m.code] = m.id;
    }
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[])`,
        [[org, orgIntrus]],
      ),
    );
    await fermerLePool();
  });

  it("un reçu inscrit les règlements qu'il atteste, et compte tant qu'ils vivent", async () => {
    const f = await facture("valide-f", "COMPTOIR ESSAI");
    const p = await regler(f, "especes");
    const recu = await nee("valide-r", f, "recu_de_paiement", [p]);

    const v = await fiche(recu);
    assert.ok(v);
    assert.equal(v.genre, "recu");
    assert.equal(v.vaut, true);
    assert.equal(v.annulation, null);
    assert.equal(v.mere?.id, f);
    assert.equal(v.mere?.emetteur, "COMPTOIR ESSAI");
    assert.equal(v.mere?.ttc, "1969.610");
    assert.deepEqual(
      v.reglements.map((r) => [r.id, r.moyenPar, r.montantMineur]),
      [[p, "en espèces", 1_969_610]],
      "le libellé « en espèces » vient du référentiel",
    );
    assert.deepEqual(v.candidats, [], "un reçu ne se rattache à aucun règlement");
  });

  it("la même clé ne double pas le lien (file hors ligne rejouée)", async () => {
    const f = await facture("rejeu-f", "COMPTOIR ESSAI");
    const p = await regler(f, "especes");
    const recu = await nee("rejeu-r", f, "recu_de_paiement", [p]);
    const encore = await nee("rejeu-r", f, "recu_de_paiement", [p]);
    assert.equal(encore, recu);
    const n = await admin(async (a) => {
      const { rows } = await a.query<{ n: string }>(
        `select count(*) as n from capture.recu_paiements where piece_id = $1`,
        [recu],
      );
      return Number(rows[0]!.n);
    });
    assert.equal(n, 1);
  });

  it("annuler un règlement attesté : le reçu ne compte plus, avec la date et le motif", async () => {
    const f = await facture("perime-f", "COMPTOIR ESSAI");
    const p = await regler(f, "cheque");
    const recu = await nee("perime-r", f, "recu_de_paiement", [p]);
    await rpc("capture", "annulerPaiement", p, motifs["montant_errone"]);

    const v = await fiche(recu);
    assert.ok(v);
    assert.equal(v.vaut, false);
    assert.equal(v.annulation?.paiementId, p);
    assert.equal(v.annulation?.motif, "Ce n'est pas le bon montant");
    assert.ok(v.annulation?.le, "la date de l'annulation est dite");
    assert.equal(v.reglements[0]!.eteint, true);
  });

  it("un reçu ancien, sans lien, compte : on ne devine pas ce qu'il attestait", async () => {
    const f = await facture("ancien-f", "COMPTOIR ESSAI");
    await regler(f, "especes");
    const recu = await nee("ancien-r", f, "recu_de_paiement");
    const v = await fiche(recu);
    assert.ok(v);
    assert.equal(v.vaut, true);
    assert.deepEqual(v.reglements, []);
  });

  it("un reçu n'atteste que les règlements réels de SA facture", async () => {
    const f = await facture("autre-f", "COMPTOIR ESSAI");
    const g = await facture("autre-g", "AUTRE ESSAI");
    const pg2 = await regler(g, "especes");
    // Écarté et tracé, jamais lié : lever bloquerait un reçu rejoué depuis
    // la file hors ligne dont un règlement a disparu entre-temps.
    const r = await nee("autre-r", f, "recu_de_paiement", [pg2]);
    assert.deepEqual((await fiche(r))?.reglements ?? [], []);
    const ecartes = await admin(async (a) => {
      const { rows } = await a.query(
        `select payload ->> 'paiement' as p from audit.event_log
          where object_id = $1 and action = 'recu.reglement_ecarte'`,
        [r],
      );
      return rows.map((x) => x.p as string);
    });
    assert.deepEqual(ecartes, [pg2]);
    const talon = await nee("autre-t", f, "justificatif_paiement");
    await assert.rejects(
      () =>
        sousIdentite(u.id, (db) =>
          db.query(`select public.recu_attester_paiements($1, $2::uuid[])`, [talon, [pg2]]),
        ),
      /seul un reçu/,
    );
  });

  it("une pièce qui n'accompagne rien n'a pas cette fiche, et un autre dossier ne la voit pas", async () => {
    const f = await facture("seule-f", "COMPTOIR ESSAI");
    assert.equal(await fiche(f), null);
    const p = await regler(f, "especes");
    const recu = await nee("seule-r", f, "recu_de_paiement", [p]);
    await assert.rejects(
      () => rpcDe(intrus, "capture", "pieceQuiAccompagne", recu, "fr"),
      /introuvable ou non autorisee/,
    );
  });

  it("un justificatif dit ce qu'il prouve, et ne propose que les règlements sans preuve", async () => {
    const f = await facture("just-f", "COMPTOIR ESSAI");
    const talon = await nee("just-t", f, "justificatif_paiement");
    const p = await regler(f, "cheque", talon);

    const g = await facture("just-g", "SOFT ESSAI");
    const libre = await regler(g, "especes");
    const prouve = await regler(g, "cheque", await nee("just-gt", g, "justificatif_paiement"));
    const eteint = await regler(g, "virement");
    await rpc("capture", "annulerPaiement", eteint, motifs["montant_errone"]);

    const v = await fiche(talon);
    assert.ok(v);
    assert.equal(v.genre, "justificatif");
    assert.equal(v.vaut, true);
    assert.equal(v.mere?.id, f);
    assert.deepEqual(
      v.reglements.map((r) => [r.id, r.moyenPar, r.nomDeLaPreuve]),
      [[p, "par chèque", "Talon de chèque"]],
    );
    const ids = v.candidats.map((c) => c.id);
    assert.ok(ids.includes(libre), "un règlement sans preuve est proposé");
    assert.equal(v.candidats.find((c) => c.id === libre)?.tiers, "SOFT ESSAI");
    assert.ok(!ids.includes(prouve), "un règlement déjà prouvé ne l'est pas");
    assert.ok(!ids.includes(eteint), "un règlement annulé non plus");
    assert.ok(!ids.includes(p), "ni celui qu'il prouve déjà");
  });

  it("rattacher à un autre règlement : il quitte l'ancien par un fait, rejoint le nouveau, suit sa facture", async () => {
    const f = await facture("dep-f", "COMPTOIR ESSAI");
    const talon = await nee("dep-t", f, "justificatif_paiement");
    const ancien = await regler(f, "cheque", talon);
    const g = await facture("dep-g", "SOFT ESSAI");
    const nouveau = await regler(g, "especes");

    await rpc("capture", "deplacerJustificatif", talon, nouveau);

    assert.equal((await lignes(f))[0]!.justificatifPieceId, null, "l'ancien n'a plus de preuve");
    assert.equal((await lignes(g))[0]!.justificatifPieceId, talon);
    const v = await fiche(talon);
    assert.equal(v?.mere?.id, g, "la preuve suit sa nouvelle facture");
    assert.deepEqual(
      v?.reglements.map((r) => r.id),
      [nouveau],
    );

    // R7 : le paiement d'origine n'est pas réécrit ; deux faits nouveaux.
    const faits = await admin(async (a) => {
      const { rows } = await a.query<{ fait: string }>(
        `select fait from capture.paiement_justificatifs
          where paiement_id = any($1::uuid[]) order by fait`,
        [[ancien, nouveau]],
      );
      return rows.map((r) => r.fait);
    });
    assert.deepEqual(faits, ["detache", "rattache"]);
  });

  it("rattacher refuse un règlement déjà prouvé ou annulé, par une clé du dictionnaire", async () => {
    const f = await facture("refus-f", "COMPTOIR ESSAI");
    const talon = await nee("refus-t", f, "justificatif_paiement");
    await regler(f, "cheque", talon);
    const g = await facture("refus-g", "SOFT ESSAI");
    const prouve = await regler(g, "cheque", await nee("refus-gt", g, "justificatif_paiement"));
    const annule = await regler(g, "especes");
    await rpc("capture", "annulerPaiement", annule, motifs["montant_errone"]);

    await assert.rejects(
      () => rpc("capture", "deplacerJustificatif", talon, prouve),
      /refus\.justificatif\.reglement_deja_prouve/,
    );
    await assert.rejects(
      () => rpc("capture", "deplacerJustificatif", talon, annule),
      /refus\.justificatif\.reglement_eteint/,
    );
  });

  it("une preuve ne franchit pas la frontière du cabinet en changeant de règlement", async () => {
    const f = await facture("front-f", "COMPTOIR ESSAI");
    const talon = await nee("front-t", f, "justificatif_paiement");
    await regler(f, "cheque", talon);
    const transmise = await facture("front-g", "SOFT ESSAI", "partage");
    const ailleurs = await regler(transmise, "especes");

    assert.ok(
      !(await fiche(talon))?.candidats.some((c) => c.id === ailleurs),
      "un règlement d'une pièce transmise n'est pas proposé pour une preuve privée",
    );
    await assert.rejects(
      () => rpc("capture", "deplacerJustificatif", talon, ailleurs),
      /refus\.justificatif\.autre_cote_du_cabinet/,
    );
  });

  it("reprendre la photo : la nouvelle prouve le même règlement, l'ancienne disparaît", async () => {
    const f = await facture("rep-f", "COMPTOIR ESSAI");
    const floue = await nee("rep-floue", f, "justificatif_paiement");
    const p = await regler(f, "cheque", floue);
    const nette = await nee("rep-nette", f, "justificatif_paiement");

    await rpc("capture", "remplacerJustificatif", floue, nette);

    assert.equal(await existe(floue), false, "l'ancienne photo est supprimée");
    assert.equal((await lignes(f))[0]!.justificatifPieceId, nette);
    assert.deepEqual(
      (await fiche(nette))?.reglements.map((r) => r.id),
      [p],
      "le rattachement au règlement est gardé",
    );
  });

  it("reprendre la photo n'accepte qu'une photo de preuve neuve, jamais une facture lue", async () => {
    const f = await facture("rep2-f", "COMPTOIR ESSAI");
    const talon = await nee("rep2-t", f, "justificatif_paiement");
    await regler(f, "cheque", talon);
    const autre = await facture("rep2-autre", "AUTRE ESSAI");
    await assert.rejects(
      () => rpc("capture", "remplacerJustificatif", talon, autre),
      /refus\.justificatif\.nouvelle_photo/,
    );
    assert.equal(await existe(talon), true, "rien ne bouge");
  });

  it("un autre dossier ne déplace ni ne remplace une preuve qui n'est pas la sienne", async () => {
    const f = await facture("x-f", "COMPTOIR ESSAI");
    const talon = await nee("x-t", f, "justificatif_paiement");
    const p = await regler(f, "cheque", talon);
    await assert.rejects(
      () => rpcDe(intrus, "capture", "deplacerJustificatif", talon, p),
      undefined,
      "deplacer",
    );
    // Invisible pour lui : la porte rend « rien effacé », comme `supprimer`.
    assert.equal(await rpcDe(intrus, "capture", "supprimerPieceQuiAccompagne", talon), false);
    assert.equal(await existe(talon), true);
  });

  it("une pièce transmise ne se reprend ni ne se supprime : la clé le dit, rien ne bouge", async () => {
    const f = await facture("part-f", "COMPTOIR ESSAI", "partage");
    const talon = await nee("part-t", f, "justificatif_paiement", null, "partage");
    await regler(f, "cheque", talon);
    const nette = await nee("part-n", f, "justificatif_paiement", null, "partage");

    await assert.rejects(
      () => rpc("capture", "remplacerJustificatif", talon, nette),
      /refus\.accompagne\.transmise/,
    );
    await assert.rejects(
      () => rpc("capture", "supprimerPieceQuiAccompagne", talon),
      /refus\.accompagne\.transmise/,
    );
    assert.equal(await existe(talon), true);
    assert.equal((await lignes(f))[0]!.justificatifPieceId, talon);
  });

  it("supprimer un justificatif : le règlement reste, SANS preuve — l'ancienne photo ne revient pas", async () => {
    const f = await facture("sup-f", "COMPTOIR ESSAI");
    const premiere = await nee("sup-1", f, "justificatif_paiement");
    const p = await regler(f, "cheque", premiere);
    const seconde = await nee("sup-2", f, "justificatif_paiement");
    await rpc("capture", "rattacherJustificatif", p, seconde);
    assert.equal((await lignes(f))[0]!.justificatifPieceId, seconde);

    await rpc("capture", "supprimerPieceQuiAccompagne", seconde);

    assert.equal(await existe(seconde), false);
    const [ligne] = await lignes(f);
    assert.equal(ligne!.id, p, "le règlement reste inscrit");
    assert.equal(ligne!.justificatifPieceId, null, "« Prendre le justificatif » réapparaît");
  });

  it("supprimer un reçu : la pièce et ses liens partent, le règlement reste", async () => {
    const f = await facture("supr-f", "COMPTOIR ESSAI");
    const p = await regler(f, "especes");
    const recu = await nee("supr-r", f, "recu_de_paiement", [p]);
    await rpc("capture", "supprimerPieceQuiAccompagne", recu);
    assert.equal(await existe(recu), false);
    assert.equal((await lignes(f)).length, 1);
  });

  it("supprimer la facture emporte ses règlements ; le reçu qui les attestait reste lisible", async () => {
    const f = await facture("mere-f", "COMPTOIR ESSAI");
    const p = await regler(f, "especes");
    const recu = await nee("mere-r", f, "recu_de_paiement", [p]);
    await rpc("capture", "supprimer", f);
    assert.equal(await existe(f), false);
    assert.equal(await existe(recu), true);
  });

  it("une facture ne se supprime pas par la porte des pièces qui accompagnent", async () => {
    const f = await facture("pas-f", "COMPTOIR ESSAI");
    await assert.rejects(
      () => rpc("capture", "supprimerPieceQuiAccompagne", f),
      /introuvable ou non autorisee/,
    );
    assert.equal(await existe(f), true);
  });
});
