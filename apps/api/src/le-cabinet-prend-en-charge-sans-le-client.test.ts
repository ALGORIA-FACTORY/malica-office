/**
 * Le cabinet prend en charge sans le client (« Malica sans blocage », lot 5).
 *
 * Relevé sur staging le 29 octobre 2026 : une pièce au montant illisible
 * s'ouvrait chez le comptable sur « Lue — le client n'a pas confirmé », un
 * bouton « Inscrire » éteint (le Socle ne proposait rien) et « Demander au
 * client de confirmer ». Le comptable ne pouvait rien en faire. Et forcer une
 * imputation RETOURNAIT la pièce au client, avec une notification.
 *
 * Décision du dirigeant : la PME ne voit aucune écriture et ne confirme rien.
 * Elle lit Envoyée · Vue · Retour · Prise en charge ; le comptable lit Reçue ·
 * Vue · Retournée · Corrigée · Validée · Forcée. Il valide, force (y compris
 * quand rien n'est proposé), ou retourne à toute étape.
 *
 * Le dossier est en mode MANDAT (le défaut) : le double regard y est actif, et
 * c'est là qu'un cabinet qui a pris une pièce en charge doit encore pouvoir la
 * retourner.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-cabinet-prend-en-charge-sans-le-client.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { SuiviDEnvoi } from "@malica/socle/statut-d-envoi";
import { statutCabinet, statutPme } from "@malica/socle/statut-d-envoi";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { journalDuJour } from "./depots/journal-du-jour.ts";
import { parametrage } from "./depots/parametrage.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { contratRpc, executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface Dossier {
  piece: { id: string; status: string; vis: "personnel" | "entite" | "partage" };
  suivi: SuiviDEnvoi | null;
}
interface LigneDeFile {
  pieceId: string;
  statut: string;
  status: string;
  suivi: SuiviDEnvoi | null;
}

describe("le cabinet prend en charge sans le client", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `prise-en-charge-${Date.now()}`;
  const mfDossier = matriculeDEssai("A", "M");
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let nomDuCabinet = "";
  let packId = "";
  let jour = "";
  const motifs: Record<string, string> = {};
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const pmeFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return rpc(dirigeant, depot, nom, ...args);
  };
  const cabinetFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return rpc(expert, depot, nom, ...args);
  };

  let n = 0;
  /**
   * Une facture transmise au cabinet, lue. `lisible` : ses montants se
   * recoupent et le Socle propose une écriture ; sinon la lecture n'a relevé
   * que le type, et le Socle ne propose rien — le cas qui bloquait.
   */
  const transmise = async (lisible: boolean) => {
    n += 1;
    const l = lectureDEssai({ clientMf: mfDossier, numero: `PEC-${n}` });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: lisible ? l.extract : { document_kind: "facture_achat" },
              citations: lisible ? l.citations : [],
              flags: [],
              articles: [],
              documentKind: "facture_achat",
              documentDate: lisible ? l.extract.document_date : null,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    // Le propriétaire l'envoie : la base pose l'heure de l'envoi.
    await pmeFait("collab.setPieceVis", p.id, "partage");
    return p.id;
  };

  const dossier = (u: Utilisateur, id: string) =>
    rpc(u, "capture", "dossier", id) as Promise<Dossier>;
  const vuParLaPme = async (id: string) => {
    const d = await dossier(dirigeant, id);
    return statutPme({ vis: d.piece.vis, status: d.piece.status, suivi: d.suivi });
  };
  /** Valider comme l'écran : la proposition affichée, et son empreinte. */
  const valider = async (id: string) => {
    const p = (await cabinetFait("office.propositionDePiece", id)) as {
      ok: boolean;
      empreinte?: string;
    };
    return cabinetFait("office.valider", id, p.empreinte ?? null);
  };
  const ligneDeFile = async (id: string) =>
    ((await cabinetFait("supervision.queue", cabinet)) as LigneDeFile[]).find(
      (r) => r.pieceId === id,
    );
  const vuParLeCabinet = async (id: string) => {
    const d = await dossier(expert, id);
    return statutCabinet({ status: d.piece.status, suivi: d.suivi });
  };
  const notifications = async (id: string, kind: string) =>
    Number(
      (
        await admin.query<{ n: string }>(
          `select count(*)::text as n from collab.notifications
            where tenant_id = $1 and kind = $2 and payload ->> 'piece_id' = $3`,
          [pme, kind, id],
        )
      ).rows[0]!.n,
    );
  const statutEnBase = async (id: string) =>
    (await admin.query<{ s: string }>(`select status as s from capture.pieces where id = $1`, [id]))
      .rows[0]!.s;
  const ecrituresVivantes = async (id: string) =>
    (
      await admin.query<{ id: string }>(
        `select e.id from socle.ecritures e
          where e.piece_id in (select app.versions_de_la_piece($1))
            and e.nature = 'piece' and app.ecriture_vivante(e.id)`,
        [id],
      )
    ).rows.map((r) => r.id);
  const journal = async () => {
    const j = await sousIdentite(expert.id, (db) =>
      journalDuJour.lire(db, cabinet, pme, jour, "fr"),
    );
    return j.journaux.flatMap((x) => x.ecritures);
  };

  /** Deux lignes équilibrées : des montants qu'un flottant ne sait pas additionner juste. */
  const lignesSaisies = (charge: string) => [
    { account_code: charge, libelle: "Achat", debit: "0.1", credit: "0", tax_code: "EXO" },
    { account_code: charge, libelle: "Achat", debit: "0.2", credit: "0", tax_code: "EXO" },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "0.3", tax_code: null },
  ];

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    nomDuCabinet = `CABINET D'ESSAI ${marque}`;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME D'ESSAI ${marque}`, mfDossier);
    cabinet = await creer(expert, "cabinet", nomDuCabinet, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfDossier));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    for (const m of await sousIdentite(expert.id, (db) => supervision.motifs(db, "fr")))
      motifs[m.code] = m.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la relance « confirmez » et l'inscription « au nom du client » n'existent plus", async () => {
    const contrat = contratRpc();
    assert.ok(!contrat["supervision"]!.includes("demanderConfirmation"));
    assert.ok(!contrat["office"]!.includes("inscrireLaPieceDuClient"));
    assert.ok(!contrat["office"]!.includes("corrigerLImputation"));
    for (const m of ["valider", "forcer"]) assert.ok(contrat["office"]!.includes(m), m);
    assert.ok(contrat["supervision"]!.includes("voir"));
    const { rows } = await admin.query(
      `select proname from pg_proc
        where proname in ('piece_demander_confirmation', 'piece_confirmer_le_type_lu')`,
    );
    assert.deepEqual(rows, []);
  });

  it("envoyée, puis « Vue » à l'ouverture, une fois par envoi — et la PME lit « Vue par »", async () => {
    const id = await transmise(true);
    assert.equal(await vuParLaPme(id), "envoyee");
    assert.equal((await ligneDeFile(id))?.statut, "recue");

    const premiere = (await cabinetFait("supervision.voir", id)) as {
      vueLe: string;
      deja: boolean;
    };
    assert.equal(premiere.deja, false);
    const seconde = (await cabinetFait("supervision.voir", id)) as {
      vueLe: string;
      deja: boolean;
    };
    assert.equal(seconde.deja, true, "rouvrir n'écrit rien");
    assert.equal(seconde.vueLe, premiere.vueLe);
    const { rows } = await admin.query(
      `select par, par_nom from capture.vues where piece_id = $1`,
      [id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].par, expert.id, "qui l'a vue");

    const d = await dossier(dirigeant, id);
    assert.equal(d.suivi?.vuePar, nomDuCabinet);
    assert.equal(await vuParLaPme(id), "vue");
    assert.equal((await ligneDeFile(id))?.statut, "vue");

    // Ouvrir sa propre pièce, côté PME, n'est pas « la voir » pour le cabinet :
    // la même porte sert la « Vue » du propriétaire (lot 4), et ici n'écrit rien.
    assert.deepEqual(await pmeFait("supervision.voir", id), { vueLe: null, deja: false });
    const apres = await admin.query(`select 1 from capture.vues where piece_id = $1`, [id]);
    assert.equal(apres.rows.length, 1);
  });

  it("retournée avec un motif, reprise en photo, renvoyée : le cabinet lit « Corrigée »", async () => {
    const id = await transmise(true);
    await cabinetFait("supervision.voir", id);
    await cabinetFait("supervision.retourner", {
      pieceId: id,
      motifId: motifs["montant_incoherent"],
      note: "Le total ne se lit pas : reprenez la photo.",
    });
    assert.equal(await vuParLaPme(id), "retour");
    assert.equal(await vuParLeCabinet(id), "retournee");

    // Reprendre la photo (lot 1) : la nouvelle remplace l'ancienne, puis repart.
    const nouvelle = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-reprise-${id}`,
      contentType: "application/pdf",
      pageCount: 1,
      remplace: id,
    })) as { id: string };
    await pmeFait("capture.renvoyer", nouvelle.id);
    assert.equal(await vuParLaPme(nouvelle.id), "envoyee");
    assert.equal((await ligneDeFile(nouvelle.id))?.statut, "corrigee");

    // Rouverte, elle est vue ; renvoyée sans rien changer, elle redevient « Reçue ».
    await cabinetFait("supervision.voir", nouvelle.id);
    assert.equal((await ligneDeFile(nouvelle.id))?.statut, "vue");
    await cabinetFait("supervision.retourner", {
      pieceId: nouvelle.id,
      motifId: motifs["imputation_a_revoir"],
      note: "Charge ou immobilisation ?",
    });
    await pmeFait("capture.repondreAuCabinet", nouvelle.id, "Une charge.");
    await pmeFait("capture.renvoyer", nouvelle.id);
    assert.equal((await ligneDeFile(nouvelle.id))?.statut, "recue");
  });

  it("le Socle ne propose rien : le comptable saisit l'écriture, elle est « forcée »", async () => {
    const id = await transmise(false);
    const proposition = (await cabinetFait("office.propositionDePiece", id)) as { ok: boolean };
    assert.equal(proposition.ok, false, "le cas qui bloquait : rien de proposé");

    // Déséquilibrée : refusée, et le refus dit quoi faire.
    await assert.rejects(
      cabinetFait("office.forcer", {
        pieceId: id,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture saisie",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "0.3", credit: "0", tax_code: "EXO" },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "0.2",
            tax_code: null,
          },
        ],
      }),
      /refus\.ecriture\.desequilibre/,
    );

    const ecriture = (await cabinetFait("office.forcer", {
      pieceId: id,
      journal: "ACH",
      date: "2026-10-02",
      libelle: "Facture saisie",
      lignes: lignesSaisies("601"),
    })) as string;
    assert.deepEqual(await ecrituresVivantes(id), [ecriture]);
    assert.equal(await statutEnBase(id), "supervisee");
    assert.equal(await vuParLaPme(id), "prise_en_charge");
    assert.equal(await vuParLeCabinet(id), "forcee");
    const d = await dossier(dirigeant, id);
    assert.equal(d.suivi?.prisePar, null, "le nom du comptable reste au cabinet");

    // Au journal du jour, forcée, avec le nom et l'heure.
    const e = (await journal()).find((x) => x.id === ecriture);
    assert.equal(e?.origine, "forcee");
    assert.equal(e?.par, `expert-${marque}@essai.local`);
    assert.match(e?.heure ?? "", /^\d{2}:\d{2}$/);
    assert.equal(e?.debit, "0.300", "des montants exacts, sans flottant");
    assert.equal(await notifications(id, "piece.retournee"), 0);
  });

  it("le Socle propose : le comptable valide, sans le client, même en mode mandat", async () => {
    const id = await transmise(true);
    const ecriture = (await valider(id)) as string;
    assert.deepEqual(await ecrituresVivantes(id), [ecriture]);
    assert.equal(await statutEnBase(id), "supervisee");
    assert.equal(await vuParLeCabinet(id), "validee");
    assert.equal(await vuParLaPme(id), "prise_en_charge");
    assert.equal((await journal()).find((x) => x.id === ecriture)?.origine, "validee");
    // Le type est établi au nom du cabinet (le verrou R2 garde son objet).
    const { rows } = await admin.query<{ par: string }>(
      `select decided_by::text as par from capture.precisions
        where piece_id = $1 and champ = 'document_kind'`,
      [id],
    );
    assert.deepEqual(
      rows.map((r) => r.par),
      [expert.id],
    );
    await assert.rejects(valider(id), /refus\.prise_en_charge\.deja/);
    // La PME ne valide rien.
    await assert.rejects(pmeFait("office.valider", id), /supervision revient/);
  });

  it("forcer une écriture validée ne retourne pas la pièce et ne prévient pas le client", async () => {
    const id = await transmise(true);
    const validee = (await valider(id)) as string;
    const avant = await notifications(id, "piece.retournee");

    const forcee = (await cabinetFait("office.forcer", {
      pieceId: id,
      journal: "ACH",
      date: "2026-10-02",
      libelle: "Facture réimputée",
      lignes: lignesSaisies("622"),
    })) as string;
    assert.deepEqual(await ecrituresVivantes(id), [forcee], "l'ancienne est contre-passée");
    assert.equal(await statutEnBase(id), "supervisee", "jamais « retournee »");
    assert.equal(await notifications(id, "piece.retournee"), avant, "le client n'est pas prévenu");
    assert.equal(await vuParLaPme(id), "prise_en_charge");
    assert.equal(await vuParLeCabinet(id), "forcee");

    const lignes = await journal();
    assert.equal(lignes.find((x) => x.id === forcee)?.origine, "forcee");
    assert.equal(
      lignes.find((x) => x.contrePasse === validee)?.origine,
      "contre_passation",
      "la contre-passation est au journal du jour",
    );
  });

  it("retourner une pièce prise en charge : contre-passation, puis « Retour » chez la PME", async () => {
    const id = await transmise(true);
    const validee = (await valider(id)) as string;
    // Le même comptable qui l'a validée la retourne : défaire n'est pas valider.
    await cabinetFait("supervision.retourner", {
      pieceId: id,
      motifId: motifs["justificatif_manquant"],
      note: "Joignez le bon de livraison.",
    });
    assert.deepEqual(await ecrituresVivantes(id), []);
    assert.equal(await statutEnBase(id), "retournee");
    assert.equal(await vuParLaPme(id), "retour");
    assert.equal(await vuParLeCabinet(id), "retournee");
    assert.equal(
      (await journal()).find((x) => x.contrePasse === validee)?.origine,
      "contre_passation",
    );
    const r = (await pmeFait("capture.retourDeLaPiece", id, "fr")) as { motif: string } | null;
    assert.equal(r?.motif, "justificatif_manquant");
    await assert.rejects(
      cabinetFait("supervision.retourner", {
        pieceId: id,
        motifId: motifs["doublon"],
        note: null,
      }),
      /refus\.retour\.deja/,
    );
  });

  it("une pièce que la lecture n'a pas typée se force avec le type choisi par le comptable", async () => {
    const id = await transmise(false);
    await admin.query(
      `update capture.pieces set document_kind = null, document_kind_statut = 'a_determiner'
        where id = $1`,
      [id],
    );
    const forcer = (typeDeDocument?: string) =>
      cabinetFait("office.forcer", {
        pieceId: id,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture saisie",
        lignes: lignesSaisies("601"),
        typeDeDocument,
      });
    await assert.rejects(forcer(), /refus\.inscription\.type_inconnu/);
    await forcer("facture_achat");
    assert.equal(await vuParLeCabinet(id), "forcee");
  });

  /** Le suivi tel que la base le rend à `u` : aucune ligne = refusé. */
  const suiviEnBase = async (u: Utilisateur, id: string) =>
    sousIdentite(u.id, async (db) => {
      const { rows } = await db.query(`select * from app.suivi_de_la_piece($1)`, [id]);
      return rows;
    });

  it("le suivi d'une version précédente se ferme quand sa courante est retirée", async () => {
    const id = await transmise(true);
    assert.equal((await suiviEnBase(expert, id)).length, 1, "envoyée : le cabinet la suit");
    // Le client reprend la photo, puis la rappelle avec l'accord du cabinet :
    // la version courante n'est plus transmise. L'ancienne, figée, porte
    // encore `partage`.
    const nouvelle = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-retiree-${id}`,
      contentType: "application/pdf",
      pageCount: 1,
      remplace: id,
    })) as { id: string };
    await pmeFait("collab.demanderSurPiece", nouvelle.id, "rappel");
    await cabinetFait("collab.repondreSurPiece", nouvelle.id, "rappel", true, null);
    assert.equal(
      (await admin.query(`select vis from capture.pieces where id = $1`, [nouvelle.id])).rows[0]
        .vis,
      "entite",
    );
    assert.equal(
      (await admin.query(`select vis from capture.pieces where id = $1`, [id])).rows[0].vis,
      "partage",
    );
    assert.deepEqual(
      await suiviEnBase(expert, id),
      [],
      "l'ancienne version n'a pas de visibilité propre : la courante juge",
    );
  });

  it("le suivi d'une pièce personnelle ne se lit que par son auteur", async () => {
    // Un dossier à deux dirigeants, sans licence qui compte les places.
    const auteur = await creerCompte(`auteur-${marque}@essai.local`, mdp);
    const associe = await creerCompte(`associe-${marque}@essai.local`, mdp);
    assert.ok(auteur && associe);
    const { rows } = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`PME A DEUX ${marque}`],
    );
    const aDeux = rows[0]!.id;
    try {
      for (const u of [auteur, associe])
        await admin.query(
          `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')`,
          [aDeux, u.id],
        );
      const p = (await rpc(auteur, "capture", "enregistrer", {
        tenantId: aDeux,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-personnelle`,
        contentType: "application/pdf",
        pageCount: 1,
      })) as { id: string };
      assert.equal((await suiviEnBase(auteur, p.id)).length, 1, "son auteur la suit");
      assert.deepEqual(await suiviEnBase(associe, p.id), [], "un autre membre, non");
    } finally {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [aDeux],
      );
    }
  });

  it("une pièce prise en charge avant la migration ne compte pas « À traiter »", async () => {
    const id = await transmise(true);
    await valider(id);
    // L'état d'avant « Malica sans blocage » : l'écriture inscrite par le
    // cabinet laissait la pièce « comptabilisee », sa prise en charge faite.
    await admin.query(`update capture.pieces set status = 'comptabilisee' where id = $1`, [id]);

    const ligne = await ligneDeFile(id);
    assert.equal(ligne?.statut, "validee");
    const client = (
      (await cabinetFait("supervision.listClients", cabinet)) as {
        tenantId: string;
        aTraiter: number;
        parStatut: Record<string, number>;
      }[]
    ).find((c) => c.tenantId === pme)!;
    const file = (await cabinetFait("supervision.queue", cabinet)) as LigneDeFile[];
    assert.equal(
      client.aTraiter,
      file.filter((r) => ["recue", "vue", "corrigee"].includes(r.statut)).length,
      "le compteur et la file classent par la même règle",
    );
    assert.equal(client.parStatut["validee"], file.filter((r) => r.statut === "validee").length);
    await assert.rejects(valider(id), /refus\.prise_en_charge\.deja/);
  });

  it("le pilotage compte la prise en charge du mois, au nom du comptable", async () => {
    const id = await transmise(true);
    await valider(id);
    const st = (await cabinetFait("supervision.statistiques", cabinet, "fr")) as {
      parMois: { mois: string; collaborateur: string | null; supervisees: number }[];
    };
    const mois = new Date().toISOString().slice(0, 7);
    const ligne = st.parMois.find(
      (m) => m.mois === mois && m.collaborateur === `expert-${marque}@essai.local`,
    );
    assert.ok(ligne && ligne.supervisees >= 1, JSON.stringify(st.parMois));
  });

  it("en mandat, la PME n'inscrit pas l'écriture d'une pièce ; un dossier autonome, si", async () => {
    // Le dirigeant tente de passer par les méthodes de bas niveau.
    const id = await transmise(true);
    // Le sens non plus n'est pas à elle (29 octobre 2026).
    await assert.rejects(
      pmeFait("capture.preciser", id, "document_kind", "facture_achat"),
      /refus\.sens\.reserve_au_cabinet/,
    );
    const ecriture = (await pmeFait("office.proposerDepuisPiece", id)) as string;
    await assert.rejects(
      pmeFait("office.book", ecriture),
      /refus\.inscription\.reservee_au_cabinet/,
    );
    assert.deepEqual(await ecrituresVivantes(id), []);

    // Un dossier autonome tient ses livres : rien ne change pour lui.
    const mfAutonome = matriculeDEssai("B", "M");
    const autonome = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME AUTONOME ${marque}`, mfAutonome],
      );
      return rows[0]!.id;
    });
    try {
      const l = lectureDEssai({ clientMf: mfAutonome, numero: "AUTO-1" });
      const p = (await pmeFait("capture.enregistrer", {
        tenantId: autonome,
        source: "pdf",
        vis: "entite",
        idempotencyKey: `${marque}-autonome`,
        contentType: "application/pdf",
        pageCount: 1,
      })) as { id: string };
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        executerRpc(
          db,
          {
            depot: "capture",
            methode: "persisterLecture",
            args: [
              {
                pieceId: p.id,
                packId,
                tokens: l.tokens,
                contract: "extract.v1",
                extract: l.extract,
                citations: l.citations,
                flags: [],
                articles: [],
                documentKind: "facture_achat",
                documentDate: l.extract.document_date,
                mode: "pdf-text",
                confianceParChamp: { "totals.ttc": 0.95 },
              },
            ],
          },
          "serveur",
        ),
      );
      await pmeFait("capture.preciser", p.id, "document_kind", "facture_achat");
      const e = (await pmeFait("office.proposerDepuisPiece", p.id)) as string;
      await pmeFait("office.book", e);
      assert.equal(await statutEnBase(p.id), "comptabilisee");
    } finally {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [autonome],
      );
    }
  });
});
