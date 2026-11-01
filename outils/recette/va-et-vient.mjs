/**
 * La recette du va-et-vient PME ↔ cabinet, jouée sur une instance réelle.
 *
 *   MALICA_BASE=https://staging… node outils/recette/va-et-vient.mjs [nombre]
 *
 * ================================================================= POURQUOI
 *
 * Le CEO a demandé (1er novembre 2026) de valider « en vrai » les cas
 * d'usage, offre par offre : une PME `team` avec un siège, une PME `premium`
 * avec deux sociétés et des places, une PME `basic` seule, et le cabinet qui
 * tient leurs livres. Tout passe par l'application, sous l'identité de la
 * personne qui ferait le geste : `/auth/inscription`, `/rpc`, `/pieces/:id/
 * contenu` et `/malica/lectures/:id` (la VRAIE lecture du serveur).
 *
 * Les factures sont celles du jeu synthétique (`outils/jeu-synthetique`) :
 * inventées, leurs dossiers et leurs fournisseurs aussi ; l'écriture attendue
 * de chacune est connue avant l'impression. Aucune donnée réelle.
 *
 * Rejouable : les adresses sont fixes (@essai.local), les organisations se
 * retrouvent par leur identifiant fiscal, chaque pièce par sa clé
 * d'idempotence. Un second passage ne recrée rien.
 *
 * Ce que l'outil NE fait PAS : il n'invente aucune écriture. Une pièce que le
 * Socle propose est validée telle quelle si elle est l'écriture attendue ;
 * sinon elle est FORCÉE avec l'écriture attendue, et l'écart est un verdict
 * en échec — c'est ce qu'on cherche.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { creerEpreuve, MDP_EPREUVE } from "../epreuves/socle.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const JEU = join(ICI, "..", "jeu-synthetique");
const e = creerEpreuve("le va-et-vient PME ↔ cabinet", process.env["MALICA_BASE"]);
const PAR_DOSSIER = Number(process.argv[2] ?? 8);

const SCENARIOS = JSON.parse(readFileSync(join(ICI, "scenarios.json"), "utf8"));
const compte = ({ local, nom }) => ({
  email: `${local}@recette.essai.local`,
  motDePasse: MDP_EPREUVE,
  nom,
});
const EXPERT = compte(SCENARIOS.cabinet.expert);
const CABINET = { name: SCENARIOS.cabinet.name, legalId: SCENARIOS.cabinet.legalId };
/** Les trois dossiers du jeu synthétique, une offre chacun (scenarios.json). */
const DOSSIERS = SCENARIOS.dossiers.map((d) => ({
  ...d,
  dirigeant: compte(d.dirigeant),
  ...(d.siege ? { siege: compte(d.siege) } : {}),
}));

const cas = Array.from({ length: 100 }, (_, i) => {
  const id = String(i + 1).padStart(3, "0");
  return JSON.parse(readFileSync(join(JEU, "cas", `${id}.json`), "utf8"));
});
for (const [i, d] of DOSSIERS.entries()) {
  const parDossier = [...new Set(cas.map((c) => c.dossier.identifiantFiscal))];
  d.legalId = parDossier[i];
  d.nom = cas.find((c) => c.dossier.identifiantFiscal === d.legalId).dossier.nom;
  // Un mélange : PDF, photos, manuscrits ; français, arabe, hybride ; défauts compris.
  d.cas = cas
    .filter((c) => c.dossier.identifiantFiscal === d.legalId)
    .sort((a, b) => `${a.rendu}${a.langue}${a.id}`.localeCompare(`${b.rendu}${b.langue}${b.id}`))
    .filter((_, k, tous) => k % Math.max(1, Math.floor(tous.length / PAR_DOSSIER)) === 0)
    .slice(0, PAR_DOSSIER);
}

const journal = { base: e.BASE, le: new Date().toISOString(), dossiers: {}, ecarts: [] };
const ecart = (quoi, detail) => journal.ecarts.push({ quoi, ...detail });

async function etape(libelle, fn) {
  try {
    return await fn();
  } catch (err) {
    e.verdict(libelle, false, String(err?.message ?? err).slice(0, 300));
    ecart(libelle, { erreur: String(err?.message ?? err).slice(0, 500) });
    return null;
  }
}

const mesOrganisations = () => e.rpc("identite", "listMyOrganizations");

async function organisation(kind, nom, legalId, extra = {}) {
  let org = (await mesOrganisations()).find(
    (o) => o.kind === kind && (o.legalId ?? o.legal_id) === legalId,
  );
  if (org) return org;
  const pack = await e.rpc("referentiel", "activePack", [SCENARIOS.juridiction]);
  const id = await e.rpc("identite", "createOrganization", [
    {
      kind,
      name: nom,
      legalId,
      jurisdiction: SCENARIOS.juridiction,
      currency: pack.currency,
      ...extra,
    },
  ]);
  org = (await mesOrganisations()).find((o) => o.id === id);
  return org;
}

/* ------------------------------------------------------------- le cabinet */
e.section("1. Le cabinet");
await e.inscrireOuConnecter(EXPERT, EXPERT.nom);
const cabinet = await etape("le cabinet existe", () =>
  organisation("cabinet", CABINET.name, CABINET.legalId),
);
e.verdict("l'expert tient le cabinet", cabinet?.role === "expert", cabinet?.role ?? "");
if (!cabinet) e.conclure();

/* ----------------------------------------------------- les PME, leurs offres */
e.section("2. Les PME, leurs offres, leurs places");
for (const d of DOSSIERS) {
  await e.inscrireOuConnecter(d.dirigeant, d.dirigeant.nom);
  const org = await etape(`${d.nom} existe`, () =>
    organisation("pme", d.nom, d.legalId, SCENARIOS.organisation),
  );
  if (!org) continue;
  d.org = org;
  e.verdict(
    `${d.nom} : le dirigeant la tient`,
    ["dirigeant", "owner"].includes(org.role),
    org.role,
  );

  const forfait = await etape(`${d.nom} : forfait lu`, () =>
    e.rpc("facturation", "monForfait", [org.id]),
  );
  const offreActuelle = forfait?.offre ?? forfait?.offre_code ?? forfait?.code ?? null;
  if (offreActuelle !== d.offre) {
    const r = await etape(`${d.nom} : passage à l'offre ${d.offre}`, () =>
      e.rpc("facturation", "changerForfait", [d.offre, org.id]),
    );
    if (r !== null) e.verdict(`${d.nom} : offre ${d.offre} ouverte`, true);
  } else e.verdict(`${d.nom} : déjà en offre ${d.offre}`, true);

  if (d.secondeSociete) {
    const deux = await etape(`${d.nom} : seconde société de la licence`, () =>
      organisation("pme", d.secondeSociete.name, d.secondeSociete.legalId, SCENARIOS.organisation),
    );
    const orgs = await etape("organisations de la licence", () =>
      e.rpc("facturation", "organisations"),
    );
    e.verdict(
      `${d.nom} : la licence premium porte deux sociétés`,
      Boolean(deux) && (orgs ?? []).length >= 2,
      `${(orgs ?? []).length} organisation(s)`,
    );
  }

  if (d.siege) {
    await etape(`${d.nom} : invitation du siège`, () =>
      e.rpc("facturation", "inviterSiege", [d.siege.email, org.id]),
    );
    await e.inscrireOuConnecter(d.siege, d.siege.nom);
    let siennes = await mesOrganisations();
    if (!siennes.some((o) => o.id === org.id)) {
      const pourMoi = await e.rpc("collab", "invitationsPourMoi");
      const mienne =
        pourMoi.find((i) => (i.tenantId ?? i.cabinetTenantId) === org.id) ?? pourMoi[0];
      if (mienne)
        await etape(`${d.nom} : le siège accepte`, () =>
          e.rpc("collab", "repondreAInvitation", [mienne.id, true]),
        );
      siennes = await mesOrganisations();
    }
    const membre = siennes.find((o) => o.id === org.id);
    e.verdict(`${d.nom} : le siège est membre`, Boolean(membre), membre?.role ?? "absent");
    await e.connecter(d.dirigeant);
    const places = await etape("places de la licence", () => e.rpc("facturation", "sieges"));
    e.verdict(
      `${d.nom} : la place du siège est comptée`,
      (places ?? []).some((p) => p.email === d.siege.email),
      `${(places ?? []).length} place(s)`,
    );
  }
}

/* ------------------------------------------------------------- les mandats */
e.section("3. Les mandats");
for (const d of DOSSIERS.filter((x) => x.org)) {
  await e.connecter(EXPERT);
  await etape(`mandat proposé à ${d.nom}`, () =>
    e.rpc("identite", "proposerMandat", [cabinet.id, d.legalId]),
  );
  await e.connecter(d.dirigeant);
  const proposes = (await e.rpc("identite", "mandatsProposes", [d.org.id])) ?? [];
  for (const m of proposes)
    await etape(`${d.nom} accepte le mandat`, () =>
      e.rpc("identite", "repondreAuMandat", [m.id, true]),
    );
  const mandat = await etape(`${d.nom} : mandat lu`, () =>
    e.rpc("identite", "monMandat", [d.org.id]),
  );
  e.verdict(
    `${d.nom} : mandat actif`,
    /actif/.test(JSON.stringify(mandat ?? "")),
    JSON.stringify(mandat ?? "").slice(0, 80),
  );
}

/* --------------------------------------------------- dépôt, lecture, envoi */
e.section("4. Les pièces : dépôt, lecture réelle, envoi");
for (const d of DOSSIERS.filter((x) => x.org)) {
  journal.dossiers[d.cle] = { nom: d.nom, org: d.org.id, pieces: [] };
  const deposant = d.siege ?? d.dirigeant;
  for (const c of d.cas) {
    await e.connecter(deposant);
    const ext = c.rendu === "pdf" ? "pdf" : "jpg";
    const octets = readFileSync(join(JEU, "rendus", `${c.id}.${ext}`));
    const enregistree = await etape(`${c.id} déposée`, () =>
      e.rpc("capture", "enregistrer", [
        {
          tenantId: d.org.id,
          source: c.rendu === "pdf" ? "pdf" : "photo",
          vis: "entite",
          idempotencyKey: `recette-${d.cle}-${c.id}`,
          contentType: ext === "pdf" ? "application/pdf" : "image/jpeg",
          pageCount: 1,
        },
      ]),
    );
    if (!enregistree) continue;
    const id = enregistree.id;
    const p = {
      cas: c.id,
      id,
      rendu: c.rendu,
      langue: c.langue,
      scenario: c.scenario,
      defaut: c.defaut,
    };
    journal.dossiers[d.cle].pieces.push(p);
    const deja = await e.appel(`/pieces/${id}/contenu`);
    if (deja.status !== 200) {
      const r = await e.appel(`/pieces/${id}/contenu`, {
        method: "POST",
        headers: { "Content-Type": ext === "pdf" ? "application/pdf" : "image/jpeg" },
        body: octets,
      });
      e.verdict(`${c.id} : octets déposés`, r.status === 201, String(r.status));
    }
    const debut = Date.now();
    const lecture = await e.appel(`/malica/lectures/${id}`, { method: "POST" });
    p.lectureMs = Date.now() - debut;
    p.lectureStatut = lecture.status;
    e.verdict(
      `${c.id} (${c.rendu}, ${c.langue}) : lue`,
      lecture.ok,
      `${lecture.status} en ${Math.round(p.lectureMs / 1000)} s`,
    );
    if (!lecture.ok)
      ecart("lecture", {
        cas: c.id,
        statut: lecture.status,
        corps: (await lecture.text()).slice(0, 300),
      });

    // Le siège envoie au propriétaire, qui envoie au cabinet ; sans siège, le dirigeant envoie.
    const envoi = await etape(`${c.id} : envoi`, () => e.rpc("collab", "envoyer", [id]));
    if (d.siege) {
      e.verdict(
        `${c.id} : le siège envoie au propriétaire`,
        envoi?.chez === "proprietaire",
        envoi?.chez ?? "",
      );
      await e.connecter(d.dirigeant);
      const envoi2 = await etape(`${c.id} : envoi du propriétaire`, () =>
        e.rpc("collab", "envoyer", [id]),
      );
      e.verdict(
        `${c.id} : le propriétaire transmet au cabinet`,
        envoi2?.chez === "cabinet",
        envoi2?.chez ?? "",
      );
    } else {
      e.verdict(
        `${c.id} : le dirigeant transmet au cabinet`,
        envoi?.chez === "cabinet",
        envoi?.chez ?? "",
      );
    }
  }
}

/* ------------------------------------------------------------- le cabinet */
e.section("5. Le cabinet : proposition, validation, forçage, retour");
const motifs = await (async () => {
  await e.connecter(EXPERT);
  return e.rpc("supervision", "motifs", ["fr"]);
})();
const motifRetour = motifs.find((m) => !m.requires_note) ?? motifs[0];
const egal = (a, b) => Number(a) === Number(b);
// Le compte, les montants ET le code de taxe : une base sans son code de régime
// manque à la déclaration, même juste en compte et en montant (#155).
const lignesEgales = (proposees, attendues) => {
  const norm = (ls) =>
    ls
      .map((l) => `${l[0]}|${Number(l[1]).toFixed(3)}|${Number(l[2]).toFixed(3)}|${l[3] ?? ""}`)
      .sort()
      .join(";");
  return (
    norm(proposees.map((l) => [l.account_code, l.debit, l.credit, l.tax_code])) === norm(attendues)
  );
};

for (const d of DOSSIERS.filter((x) => x.org)) {
  for (const [rang, p] of journal.dossiers[d.cle].pieces.entries()) {
    const c = cas.find((x) => x.id === p.cas);
    const attendu = c.attendu;
    await e.connecter(EXPERT);
    let prop = await etape(`${p.cas} : proposition`, () =>
      e.rpc("office", "propositionDePiece", [p.id]),
    );
    if (prop && !prop.ok && attendu.champs?.document_kind && /sens/.test(JSON.stringify(prop))) {
      await etape(`${p.cas} : le cabinet tranche le sens`, () =>
        e.rpc("office", "trancherLeSens", [p.id, attendu.champs.document_kind]),
      );
      prop = await etape(`${p.cas} : proposition après le sens`, () =>
        e.rpc("office", "propositionDePiece", [p.id]),
      );
    }
    p.proposee = Boolean(prop?.ok);
    p.raison = prop?.ok ? null : (prop?.raisonCode ?? prop?.raison ?? null);

    if (attendu.issue?.type !== "ecriture") {
      // Un défaut voulu : on attend un refus, jamais une écriture.
      e.verdict(
        `${p.cas} (${c.defaut ?? attendu.issue?.type}) : rien de faux n'est proposé`,
        !prop?.ok,
        String(p.raison ?? "proposée !"),
      );
      if (prop?.ok) ecart("proposition sur un défaut", { cas: p.cas, defaut: c.defaut });
      continue;
    }

    if (prop?.ok) {
      const exacte = lignesEgales(prop.proposition.lignes, attendu.ecriture.lignes);
      // Une question que le Socle ne tranche pas (une immobilisation) : la
      // proposition porte la réserve qui la nomme, et c'est la réponse juste.
      const aTrancher =
        !exacte &&
        attendu.aTrancher &&
        JSON.stringify(prop).includes(attendu.aTrancher.reserve) &&
        lignesEgales(prop.proposition.lignes, attendu.aTrancher.ecriture.lignes);
      p.exacte = exacte;
      p.aTrancher = Boolean(aTrancher);
      if (aTrancher)
        e.verdict(`${p.cas} : proposée avec la réserve « ${attendu.aTrancher.reserve} »`, true);
      else e.verdict(`${p.cas} : proposition exacte`, exacte);
      if (!exacte && !aTrancher)
        ecart("proposition fausse", {
          cas: p.cas,
          proposee: prop.proposition.lignes.map((l) => [
            l.account_code,
            l.debit,
            l.credit,
            l.tax_code ?? null,
          ]),
          attendue: attendu.ecriture.lignes,
        });
    } else {
      // Une écriture était attendue : ne rien proposer est un échec, que le
      // forçage qui suit ne doit pas masquer.
      e.verdict(`${p.cas} : une écriture est proposée`, false, String(p.raison));
      ecart("rien de proposé", { cas: p.cas, raison: p.raison });
    }

    // Une pièce sur quatre est retournée au client avant d'être prise en charge.
    if (rang % SCENARIOS.retourUneSur === 1 && motifRetour) {
      const r = await etape(`${p.cas} : retour au client`, () =>
        e.rpc("supervision", "retourner", [
          { pieceId: p.id, motifId: motifRetour.id, note: SCENARIOS.noteDeRetour },
        ]),
      );
      if (r !== null) {
        await e.connecter(d.dirigeant);
        await etape(`${p.cas} : le client répond`, () =>
          e.rpc("capture", "repondreAuCabinet", [p.id, SCENARIOS.reponseDuClient]),
        );
        await etape(`${p.cas} : le client renvoie`, () => e.rpc("capture", "renvoyer", [p.id]));
        await e.connecter(EXPERT);
        prop = await etape(`${p.cas} : proposition après renvoi`, () =>
          e.rpc("office", "propositionDePiece", [p.id]),
        );
      }
    }

    if (prop?.ok && p.exacte) {
      const v = await etape(`${p.cas} : validée`, () =>
        e.rpc("office", "valider", [p.id, prop.empreinte ?? null]),
      );
      p.prise = v ? "validee" : null;
    } else {
      const lignes = attendu.ecriture.lignes.map(([compte, debit, credit, taxe]) => ({
        account_code: compte,
        libelle: compte,
        debit,
        credit,
        ...(taxe ? { tax_code: taxe } : {}),
      }));
      const f = await etape(`${p.cas} : forcée avec l'écriture attendue`, () =>
        e.rpc("office", "forcer", [
          {
            pieceId: p.id,
            journal: attendu.ecriture.journal,
            date: attendu.champs.document_date,
            libelle: `Recette ${p.cas}`,
            lignes,
            typeDeDocument: attendu.champs.document_kind,
          },
        ]),
      );
      p.prise = f ? "forcee" : null;
    }
  }
}

/* --------------------------------------------- ce que chacun voit ensuite */
e.section("6. Ce que la PME et le cabinet voient");
for (const d of DOSSIERS.filter((x) => x.org)) {
  const pieces = journal.dossiers[d.cle].pieces;
  await e.connecter(d.dirigeant);
  const liste =
    (await etape(`${d.nom} : liste des pièces`, () => e.rpc("capture", "lister", [d.org.id]))) ??
    [];
  for (const p of pieces.filter((x) => x.prise)) {
    const vue = liste.find((x) => x.id === p.id);
    e.verdict(
      `${p.cas} : la PME la voit prise en charge`,
      /supervisee|prise|valid|forc|comptab/i.test(JSON.stringify(vue ?? {})),
      JSON.stringify(vue?.statut ?? vue?.status ?? "absente"),
    );
  }
  await e.connecter(EXPERT);
  const docs =
    (await etape(`${d.nom} : bibliothèque du cabinet`, () =>
      e.rpc("supervision", "documents", [cabinet.id, d.org.id, null]),
    )) ?? [];
  const achats = docs.filter((x) => x.type === "facture_achat").length;
  const ventes = docs.filter((x) => x.type === "facture_vente").length;
  const sansType = docs.filter((x) => !x.type).length;
  e.verdict(
    `${d.nom} : la bibliothèque classe les achats`,
    achats > 0,
    `${achats} achat(s), ${ventes} vente(s), ${sansType} sans type, ${docs.length} au total`,
  );
  journal.dossiers[d.cle].bibliotheque = { total: docs.length, achats, ventes, sansType };
}

writeFileSync(join(ICI, "dernier-passage.json"), JSON.stringify(journal, null, 2));
console.log(`\nJournal : outils/recette/dernier-passage.json (${journal.ecarts.length} écart(s))`);
e.conclure();
