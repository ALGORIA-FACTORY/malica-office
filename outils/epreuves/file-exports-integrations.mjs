/**
 * Épreuve — la file du cabinet, de la pièce transmise à l'export, puis la
 * clé d'API qui sort les écritures.
 *
 *   node outils/epreuves/file-exports-integrations.mjs [http://localhost:8080]
 *
 * Elle exerce, par `/rpc`, chaque geste que les écrans proposent, dans
 * l'ordre d'un usage réel : la file du jour et ses filtres, l'ouverture d'une
 * pièce (« Vue ») avec ses citations, la validation de l'écriture que le
 * Socle propose, le forçage, le retour motivé d'une pièce prise en charge
 * (contre-passée), la réponse du client puis la réimputation, la validation
 * d'un lot, l'affectation
 * d'un dossier, les notifications lues, les statistiques de pilotage, les
 * exercices, l'estimation et la génération d'un export avec son historique,
 * enfin la création, l'usage et la révocation d'une clé d'API.
 *
 * Rejouable : chaque passe dépose ses propres pièces (leur clé d'idempotence
 * porte l'heure de la passe) — le client ne confirme rien, le cabinet prend
 * en charge (« Malica sans blocage », 28 octobre 2026). Les clés d'API se
 * révoquent en fin de passe — une clé ne s'efface pas, la liste garde la trace.
 */
import { createHash } from "node:crypto";

import { COMPTE_DEV, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("la file, les exports et les intégrations", process.argv[2]);

const NEANT = "00000000-0000-0000-0000-000000000000";
const DEBUT = new Date().toISOString();
const AUJOURDHUI = DEBUT.slice(0, 10);

/**
 * Un PDF d'une page, sans texte : la lecture citée porte ses propres jetons.
 * Chaque pièce a ses octets (un commentaire la nomme, avec l'heure de la
 * passe) : deux fichiers identiques à l'octet sont un doublon strict, que le
 * Socle refuse — à raison — de comptabiliser.
 */
const pdf = (marque, passe = DEBUT) =>
  Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n" +
      `%${marque} ${passe}\n%%EOF\n`,
    "latin1",
  );

/** Un appel `/rpc` porté par une clé, sans session : ce qu'un outil tiers envoie. */
async function sousCle(cle, depot, methode, args = []) {
  const r = await fetch(`${e.BASE}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
    body: JSON.stringify({ depot, methode, args }),
  });
  const corps = await r.json().catch(() => null);
  return { status: r.status, resultat: corps?.resultat, erreur: corps?.erreur ?? null };
}

const sha256 = (texte) => createHash("sha256").update(texte, "utf8").digest("hex");
const somme = (valeurs) => valeurs.reduce((s, v) => s + Number(v), 0);

/* ------------------------------------------------ le cabinet et son dossier */
e.section("Le cabinet et le dossier de l'épreuve");
const moi = await e.connecter(COMPTE_DEV);
const orgs = await e.rpc("identite", "listMyOrganizations");
const cabinet =
  orgs.find((o) => o.kind === "cabinet" && o.name === "CABINET MALICA") ??
  orgs.find((o) => o.kind === "cabinet");
e.verdict("le compte de développement a un cabinet", Boolean(cabinet), cabinet?.name ?? "");
if (!cabinet) e.conclure();

const clients = await e.rpc("supervision", "listClients", [cabinet.id]);
const mesPme = new Set(orgs.filter((o) => o.kind === "pme").map((o) => o.id));
const dossier = clients
  .filter((c) => c.engagementStatus === "actif" && mesPme.has(c.tenantId))
  .sort((a, b) => a.name.localeCompare(b.name))[0];
e.verdict(
  "un mandat actif dont le compte est aussi membre — il servira de dossier",
  Boolean(dossier),
  dossier?.name ?? `${clients.length} mandat(s), aucun partagé`,
);
if (!dossier) e.conclure();

const pack = await e.rpc("referentiel", "activePack", [dossier.jurisdiction]);
e.verdict("un pack en vigueur pour la juridiction du dossier", Boolean(pack?.id), pack?.version);
if (!pack) e.conclure();
const params = await e.rpc("referentiel", "socleParams", [pack.id]);
const decimales = params.moneyDecimals;
const montant = (n) => Number(n).toFixed(decimales);

const plan = new Map(
  (await e.rpc("parametrage", "plan", [cabinet.id, null])).map((c) => [c.code, c]),
);
const liaisons = await e.rpc("referentiel", "accountMappings", [pack.id]);
const achat =
  liaisons.find((m) => m.documentKind === "facture_achat" && m.taxCode) ??
  liaisons.find((m) => m.documentKind === "facture_achat");
e.verdict(
  "le pack lie une facture d'achat à ses trois comptes, tous présents au plan",
  Boolean(achat) &&
    [achat.mainAccount, achat.vatAccount, achat.counterpartyAccount].every((c) => plan.has(c)),
  achat ? `${achat.mainAccount} · ${achat.vatAccount} · ${achat.counterpartyAccount}` : "aucune",
);
if (!achat) e.conclure();
const autreCharge =
  [...plan.values()].find(
    (c) =>
      c.classe === plan.get(achat.mainAccount)?.classe &&
      c.code !== achat.mainAccount &&
      c.code.length === achat.mainAccount.length,
  )?.code ?? achat.mainAccount;

/* ------------------------------------------------ deux pièces transmises */
e.section("Deux pièces transmises au cabinet");

const HT = 1200;
const TVA = 228;
const TTC = HT + TVA;

function extrait(reference) {
  return {
    contract: "extract.v1",
    issuer: "VERRES DE TUNISIE",
    document_date: AUJOURDHUI,
    currency: pack.currency,
    document_kind: "facture_achat",
    lines: [
      {
        label: "Achats",
        tax_code: achat.taxCode,
        base_ht: montant(HT),
        vat_amount: montant(TVA),
        ttc: montant(TTC),
      },
    ],
    articles: [],
    other_charges: [],
    totals: { base_ht: montant(HT), vat: montant(TVA), ttc: montant(TTC) },
    references: { invoice_no: reference },
    field_confidence: { issuer: 0.98, document_date: 0.97, total: 0.99, overall: 0.93 },
  };
}

/** Un montant tel qu'une facture l'imprime : groupes de milliers, virgule décimale. */
function imprime(n) {
  const [entier, decimal] = montant(n).split(".");
  const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, " ").split(" ");
  groupes[groupes.length - 1] += decimal ? `,${decimal}` : "";
  return groupes;
}

/** Les lignes de l'écriture d'achat, le libellé importé du plan — jamais tapé. */
function lignesDAchat(compteDeCharge) {
  return [
    {
      account_code: compteDeCharge,
      libelle: plan.get(compteDeCharge).libelle,
      debit: montant(HT),
      credit: montant(0),
      tax_code: null,
    },
    {
      account_code: achat.vatAccount,
      libelle: plan.get(achat.vatAccount).libelle,
      debit: montant(TVA),
      credit: montant(0),
      tax_code: achat.taxCode,
    },
    {
      account_code: achat.counterpartyAccount,
      libelle: plan.get(achat.counterpartyAccount).libelle,
      debit: montant(0),
      credit: montant(TTC),
      tax_code: null,
    },
  ];
}

/** Ce qui attend le cabinet : le même ensemble que `A_TRAITER` du Socle. */
const A_TRAITER = new Set(["recue", "vue", "corrigee"]);

/**
 * Une pièce transmise au cabinet, lue — et rien de plus : depuis « Malica
 * sans blocage » (28 octobre 2026), le client ne propose ni n'inscrit
 * d'écriture, c'est le cabinet qui valide ou force. Chaque passe dépose ses
 * propres pièces (la clé d'idempotence porte l'heure de la passe) : une passe
 * rejouée ne retrouve pas une pièce déjà prise en charge par la précédente.
 */
async function assurerPiece(marque, source, reference) {
  const piece = await e.rpc("capture", "enregistrer", [
    {
      tenantId: dossier.tenantId,
      source,
      vis: "partage",
      idempotencyKey: `epreuve-file:${marque}:${DEBUT}`,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  e.verdict(`la pièce « ${marque} » est enregistrée, transmise au cabinet`, Boolean(piece?.id));

  const depot = await e.appel(`/pieces/${piece.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf(marque),
  });
  e.verdict(`ses octets se déposent`, depot.status === 201, `${depot.status}`);

  // Les montants IMPRIMÉS, cités : le Socle ne propose une écriture que sur
  // des montants qu'il retrouve sur la page (« 1 200,000 », coupé par
  // groupes comme un relevé réel), jamais sur ceux de l'extraction seule.
  const textes = [["FACTURE No " + reference], ["VERRES DE TUNISIE"]];
  const champs = [["document_date"], ["issuer"]];
  for (const [n, cites] of [
    [HT, ["lines[0].base_ht", "totals.base_ht"]],
    [TVA, ["lines[0].vat_amount", "totals.vat"]],
    [TTC, ["lines[0].ttc", "totals.ttc"]],
  ]) {
    textes.push(imprime(n));
    champs.push(cites);
  }
  const jetons = [];
  const citations = [];
  textes.forEach((morceaux, i) => {
    const ordinaux = morceaux.map((text) => {
      const ordinal = jetons.length + 1;
      jetons.push({
        page: 1,
        ordinal,
        text,
        confidence: 0.98,
        x0: 0.1,
        x1: 0.6,
        y0: 0.08 + i * 0.03,
        y1: 0.1 + i * 0.03,
      });
      return ordinal;
    });
    for (const field of champs[i])
      for (const ordinal of ordinaux) citations.push({ field, page: 1, ordinal, zone: "p.1" });
  });
  await e.rpc("capture", "persisterLecture", [
    {
      pieceId: piece.id,
      packId: pack.id,
      tokens: jetons,
      contract: "extract.v1",
      extract: extrait(reference),
      citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: AUJOURDHUI,
    },
  ]);
  const d = await e.rpc("capture", "dossier", [piece.id]);
  e.verdict(
    `elle porte une lecture citée`,
    Boolean(d.extraction) &&
      d.citations.length === citations.length &&
      d.tokens.length === jetons.length,
    `${d.citations.length} citation(s)`,
  );
  return { id: piece.id, ecritureId: null, empreinte: null };
}

const pieceA = await assurerPiece("a-valider", "photo", "E-2026-001");
const pieceB = await assurerPiece("a-retourner", "pdf", "E-2026-002");

/* ------------------------------------------------ la file du jour */
e.section("Aujourd'hui — la file et ses filtres");
const file = await e.rpc("supervision", "queue", [cabinet.id]);
const ligneA = file.find((r) => r.pieceId === pieceA.id);
const ligneB = file.find((r) => r.pieceId === pieceB.id);
e.verdict(
  "les deux pièces sont dans la file, « Reçues », sans écriture : rien n'attend le client",
  ligneA?.statut === "recue" &&
    ligneB?.statut === "recue" &&
    ligneA.ecritureId === null &&
    ligneB.ecritureId === null,
  `${ligneA?.statut} · ${ligneB?.statut}`,
);
e.verdict(
  "chaque ligne nomme le client et son heure d'envoi",
  [ligneA, ligneB].every(
    (r) => r?.clientName === dossier.name && r.envoyeeLe?.startsWith(AUJOURDHUI),
  ),
);
e.verdict(
  "la confiance de lecture accompagne la pièce",
  ligneA?.confiance === 0.93 && ligneB?.confiance === 0.93,
  `${ligneA?.confiance}`,
);
{
  const premierNonPrioritaire = file.findIndex((r) => !A_TRAITER.has(r.statut));
  const dernierPrioritaire = file.map((r) => A_TRAITER.has(r.statut)).lastIndexOf(true);
  e.verdict(
    "ce qui attend le cabinet passe en tête de file",
    premierNonPrioritaire === -1 || dernierPrioritaire < premierNonPrioritaire,
    `${file.length} pièce(s)`,
  );
}
{
  const parDossier = await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId]);
  e.verdict(
    "la file se filtre par dossier, sans rien montrer d'un autre",
    parDossier.length > 0 && parDossier.every((r) => r.tenantId === dossier.tenantId),
    `${parDossier.length} pièce(s)`,
  );
  const client = (await e.rpc("supervision", "listClients", [cabinet.id])).find(
    (c) => c.tenantId === dossier.tenantId,
  );
  const aTraiterDansLaFile = parDossier.filter((r) => A_TRAITER.has(r.statut)).length;
  e.verdict(
    "le compteur « À traiter » du client compte ces deux pièces, comme la file",
    (client?.aTraiter ?? 0) >= 2 && client.aTraiter === aTraiterDansLaFile,
    `${client?.aTraiter ?? 0} à traiter · ${aTraiterDansLaFile} dans la file`,
  );
  const membres = await e.rpc("collab", "members", [cabinet.id]);
  e.verdict(
    "le filtre par collaborateur a de quoi s'alimenter : le compte est membre du cabinet",
    membres.some((m) => m.email === COMPTE_DEV.email),
    `${membres.length} membre(s)`,
  );
  const echeances = await e.rpc("collab", "echeances", [clients.map((c) => c.tenantId)]);
  e.verdict(
    "les échéances proches se lisent, chacune datée et nommée",
    echeances.every((x) => typeof x.dueDate === "string" && x.label),
    `${echeances.length} échéance(s)`,
  );
}

/* ------------------------------------------------ la revue */
e.section("La revue d'une pièce");
{
  const vue = await e.rpc("supervision", "voir", [pieceA.id]);
  const d = await e.rpc("capture", "dossier", [pieceA.id]);
  e.verdict(
    "la pièce s'ouvre : « Vue », lecture, citations situées sur la page",
    vue.deja === false &&
      Boolean(d.suivi?.vueLe) &&
      d.extraction?.contract === "extract.v1" &&
      d.citations.every((c) => c.page === 1 && c.bbox && typeof c.bbox.x0 === "number"),
  );
  const ligne = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).find(
    (r) => r.pieceId === pieceA.id,
  );
  e.verdict("la file la dit « Vue »", ligne?.statut === "vue", ligne?.statut ?? "absente");
  const octets = await e.appel(`/pieces/${pieceA.id}/contenu`);
  e.verdict("la visionneuse reçoit les octets", octets.ok, `${octets.status}`);
  const p = await e.rpc("office", "propositionDePiece", [pieceA.id]);
  pieceA.empreinte = p.ok ? p.empreinte : null;
  e.verdict(
    "le Socle propose une écriture équilibrée, sous le pack en vigueur",
    p.ok === true &&
      p.packVersionId === pack.id &&
      somme(p.proposition.lignes.map((l) => l.debit)) ===
        somme(p.proposition.lignes.map((l) => l.credit)),
    p.ok ? `${p.proposition.lignes.length} ligne(s)` : p.raison,
  );
}
const motifs = await e.rpc("supervision", "motifs", ["fr"]);
e.verdict(
  "les motifs de retour viennent du référentiel, dans la langue demandée",
  motifs.length > 0 && motifs.every((m) => m.label && m.label !== m.code),
  `${motifs.length} motif(s)`,
);

/* ---- valider */
{
  const changee = await e.rpcAttenduEnEchec("office", "valider", [pieceA.id, "0".repeat(64)]);
  e.verdict(
    "valider une proposition autre que celle affichée est refusé",
    /refus\.proposition\.changee/.test(changee?.message ?? ""),
    changee?.message ?? "acceptée",
  );
  // Le cabinet valide ce que l'écran lui a montré : l'empreinte l'accompagne.
  pieceA.ecritureId = await e.rpc("office", "valider", [pieceA.id, pieceA.empreinte]);
  const d = await e.rpc("capture", "dossier", [pieceA.id]);
  e.verdict(
    "valider prend la pièce en charge, sans le client",
    Boolean(pieceA.ecritureId) && d.piece.status === "supervisee",
    d.piece.status,
  );
  const ligne = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).find(
    (r) => r.pieceId === pieceA.id,
  );
  e.verdict(
    "la file la dit « Validée », avec son écriture et le montant posé par le Socle",
    ligne?.statut === "validee" &&
      ligne.ecritureId === pieceA.ecritureId &&
      ligne.dateEcriture?.startsWith(AUJOURDHUI) &&
      Number(ligne.montant) === TTC,
    `${ligne?.statut} · ${ligne?.montant} ${pack.currency}`,
  );
  const ecritures = await e.rpc("office", "ecrituresForPiece", [pieceA.id]);
  e.verdict(
    "son écriture est inscrite, sous le pack en vigueur",
    ecritures.some(
      (x) => x.id === pieceA.ecritureId && x.status === "booked" && x.packVersionId === pack.id,
    ),
  );
  const audit = await e.rpc("supervision", "auditForPiece", [pieceA.id]);
  e.verdict(
    "le journal garde l'inscription, avec son auteur",
    audit.some((x) => x.action === "ecriture.booked" && x.actor === moi.id),
    audit.map((x) => x.action).join(", "),
  );
  const encore = await e.rpcAttenduEnEchec("office", "valider", [pieceA.id, pieceA.empreinte]);
  e.verdict(
    "une pièce prise en charge ne se valide pas deux fois",
    encore !== null,
    encore?.message ?? "",
  );
}

/* ---- forcer, puis retourner avec motif : la prise en charge se défait */
const motif = motifs.find((m) => m.requiresNote) ?? motifs[0];
{
  pieceB.ecritureId = await e.rpc("office", "forcer", [
    {
      pieceId: pieceB.id,
      journal: "ACH",
      date: AUJOURDHUI,
      libelle: "Facture VERRES DE TUNISIE E-2026-002",
      lignes: lignesDAchat(achat.mainAccount),
    },
  ]);
  const ligne = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).find(
    (r) => r.pieceId === pieceB.id,
  );
  e.verdict(
    "forcer saisit l'écriture du comptable : la pièce est « Forcée »",
    ligne?.statut === "forcee" && ligne.ecritureId === pieceB.ecritureId,
    ligne?.statut ?? "absente",
  );

  const sansMotif = await e.rpcAttenduEnEchec("supervision", "retourner", [
    { pieceId: pieceB.id, motifId: null, note: null },
  ]);
  e.verdict("un retour sans motif est refusé", sansMotif !== null, sansMotif?.message ?? "");
  if (motif.requiresNote) {
    const sansNote = await e.rpcAttenduEnEchec("supervision", "retourner", [
      { pieceId: pieceB.id, motifId: motif.id, note: "" },
    ]);
    e.verdict(
      `le motif « ${motif.label} » exige une note : sans elle, refus`,
      sansNote !== null,
      sansNote?.message ?? "",
    );
  }
  await e.rpc("supervision", "retourner", [
    { pieceId: pieceB.id, motifId: motif.id, note: "Épreuve — imputation à revoir" },
  ]);
  const ecritures = await e.rpc("office", "ecrituresForPiece", [pieceB.id]);
  const reversal = ecritures.find((x) => x.libelle.startsWith("Contre-passation"));
  e.verdict(
    "retourner une pièce prise en charge contre-passe : une écriture inverse, inscrite, nommée",
    reversal?.status === "booked" && reversal.libelle.startsWith("Contre-passation"),
    reversal?.libelle ?? "aucune",
  );
  const d = await e.rpc("capture", "dossier", [pieceB.id]);
  e.verdict("la pièce est retournée au client", d.piece.status === "retournee", d.piece.status);
  const audit = await e.rpc("supervision", "auditForPiece", [pieceB.id]);
  e.verdict(
    "le journal garde le retour et son motif",
    audit.some((x) => x.action === "ecriture.retournee" && x.motifId === motif.id),
    audit.map((x) => x.action).join(", "),
  );
}

/* ---- le client répond et renvoie ; le comptable réimpute, jamais ne modifie */
{
  // Tant que la pièce est retournée, l'alerte du retour attend un geste : non lue.
  const pendante = (await e.rpc("collab", "notifications", [clients.map((c) => c.tenantId)])).find(
    (n) => n.kind === "piece.retournee" && n.payload?.piece_id === pieceB.id,
  );
  e.verdict(
    "une alerte de retour encore pendante reste non lue",
    Boolean(pendante) && !pendante.readAt,
  );
  await e.rpc("capture", "repondreAuCabinet", [pieceB.id, "Une charge de verrerie."]);
  await e.rpc("capture", "renvoyer", [pieceB.id]);
  const avant = (await e.rpc("office", "ecrituresForPiece", [pieceB.id])).length;
  const id = await e.rpc("office", "forcer", [
    {
      pieceId: pieceB.id,
      journal: "ACH",
      date: AUJOURDHUI,
      libelle: "Facture VERRES DE TUNISIE E-2026-002 — réimputée",
      lignes: lignesDAchat(autreCharge),
    },
  ]);
  pieceB.ecritureId = id;
  const apres = await e.rpc("office", "ecrituresForPiece", [pieceB.id]);
  const d = await e.rpc("capture", "dossier", [pieceB.id]);
  e.verdict(
    "la réimputation ajoute une écriture : l'erreur, son annulation et la correction subsistent",
    apres.length === avant + 1 && apres.length >= 3 && d.piece.status === "supervisee",
    `${apres.length} écriture(s) · ${d.piece.status}`,
  );
  e.verdict(
    "la correction porte le compte choisi, avec le libellé du plan",
    apres
      .find((x) => x.id === id)
      ?.lines.some(
        (l) => l.accountCode === autreCharge && l.libelle === plan.get(autreCharge).libelle,
      ),
    autreCharge,
  );
}

/* ------------------------------------------------ propositions en masse */
e.section("Propositions — la validation en masse");
const pieceC = await assurerPiece("en-lot", "pdf", "E-2026-003");
{
  const reglages = await e.rpc("parametrage", "reglagesCabinet", [cabinet.id]);
  e.verdict(
    "les seuils de confiance du cabinet se lisent, ordonnés entre 0 et 1",
    reglages.seuilConfianceRevue >= 0 &&
      reglages.seuilConfianceRevue <= reglages.seuilConfianceLot &&
      reglages.seuilConfianceLot <= 1,
    `revue ${reglages.seuilConfianceRevue} · lot ${reglages.seuilConfianceLot}${reglages.regle ? "" : " (défauts)"}`,
  );
  const aValider = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).filter(
    (r) => A_TRAITER.has(r.statut),
  );
  e.verdict(
    "la pièce reçue figure au lot, prête à valider",
    aValider.some((r) => r.pieceId === pieceC.id),
    `${aValider.length} à traiter`,
  );
  const p = await e.rpc("office", "propositionDePiece", [pieceC.id]);
  e.verdict(
    "chaque pièce du lot a sa proposition, lignes comprises",
    p.ok === true && p.proposition.lignes.length >= 2,
    p.ok ? `${p.proposition.lignes.length} ligne(s)` : p.raison,
  );
  pieceC.ecritureId = await e.rpc("office", "valider", [pieceC.id, p.ok ? p.empreinte : null]);
  const ligne = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).find(
    (r) => r.pieceId === pieceC.id,
  );
  e.verdict("validée, elle quitte le lot", ligne?.statut === "validee", ligne?.statut ?? "");
  const planDeCharge = await e.rpc("parametrage", "plan", [dossier.tenantId, [6]]);
  e.verdict(
    "le plan de charge du dossier se lit pour la réimputation d'un lot",
    planDeCharge.length > 0 && planDeCharge.every((c) => c.classe === "6"),
    `${planDeCharge.length} compte(s)`,
  );
}

/* ------------------------------------------------ pilotage : affecter */
e.section("Pilotage — l'affectation et les statistiques");
const membres = await e.rpc("collab", "members", [cabinet.id]);
const collaborateur = membres.find((m) => m.email === COMPTE_DEV.email);
{
  const id = await e.rpc("collab", "assign", [
    {
      cabinetTenantId: cabinet.id,
      clientTenantId: dossier.tenantId,
      collaboratorId: collaborateur.userId,
      briefing: "Épreuve — dossier affecté",
    },
  ]);
  const affectations = await e.rpc("collab", "assignments", [cabinet.id]);
  const duDossier = affectations.filter((a) => a.clientTenantId === dossier.tenantId);
  e.verdict(
    "le dossier est affecté ; une seule affectation reste active, les anciennes au journal",
    duDossier.filter((a) => a.active).length === 1 &&
      duDossier.find((a) => a.id === id)?.active === true,
    `${duDossier.length} au journal`,
  );
  const ligne = (await e.rpc("supervision", "queue", [cabinet.id, dossier.tenantId])).find(
    (r) => r.pieceId === pieceB.id,
  );
  e.verdict(
    "la file porte maintenant le collaborateur du dossier",
    ligne?.collaborateur === COMPTE_DEV.email,
    ligne?.collaborateur ?? "aucun",
  );
  const horsCabinet = await e.rpcAttenduEnEchec("collab", "assign", [
    { cabinetTenantId: cabinet.id, clientTenantId: dossier.tenantId, collaboratorId: NEANT },
  ]);
  e.verdict("affecter à qui n'est pas membre est refusé", horsCabinet !== null);
  const sansMandat = await e.rpcAttenduEnEchec("collab", "assign", [
    {
      cabinetTenantId: cabinet.id,
      clientTenantId: cabinet.id,
      collaboratorId: collaborateur.userId,
    },
  ]);
  e.verdict("affecter un dossier sans mandat est refusé", sansMandat !== null);
}
{
  const stats = await e.rpc("collab", "stats", [[dossier.tenantId]]);
  const s = stats.find((x) => x.tenantId === dossier.tenantId);
  e.verdict(
    "les comptages du dossier suivent ce qui vient d'être fait",
    s && s.pieces >= 3 && s.supervisees >= 3,
    s ? `${s.pieces} pièces · ${s.supervisees} supervisée(s)` : "aucun",
  );
  const st = await e.rpc("supervision", "statistiques", [cabinet.id, "fr"]);
  e.verdict(
    "les statistiques du cabinet sont agrégées en base : mois, motifs, production du Socle",
    Array.isArray(st.parMois) &&
      st.parMois.every((m) => /^\d{4}-\d{2}$/.test(m.mois) && m.supervisees >= 0) &&
      st.socle.comptabilisees >= 1 &&
      (st.socle.delaiMedianHeures === null || st.socle.delaiMedianHeures >= 0),
    `${st.socle.comptabilisees} comptabilisée(s) sur trente jours`,
  );
  e.verdict(
    "le motif du retour compte parmi les motifs de retour du cabinet",
    st.motifsDeRetour.some((m) => m.label === motif.label && m.retours >= 1),
    st.motifsDeRetour.map((m) => `${m.label} ×${m.retours}`).join(", "),
  );
  e.verdict(
    "la prise en charge du jour paraît dans les supervisées du mois, au nom du compte",
    st.parMois.some(
      (m) => m.mois === AUJOURDHUI.slice(0, 7) && m.collaborateur === COMPTE_DEV.email,
    ),
  );
}

/* ------------------------------------------------ notifications */
e.section("Notifications");
{
  const ids = clients.map((c) => c.tenantId);
  const notifs = await e.rpc("collab", "notifications", [ids]);
  const deLaPasse = (piece) =>
    notifs.filter((n) => n.payload?.piece_id === piece && n.createdAt >= DEBUT);
  const retournee = deLaPasse(pieceB.id).find((n) => n.kind === "piece.retournee");
  // Renvoyée par le client, la pièce n'est plus retournée : l'alerte est
  // tranchée, donc lue (recette du 11 novembre 2026, point 2.3).
  e.verdict(
    "le retour a posé une notification qui mène à la pièce, lue une fois la pièce renvoyée",
    Boolean(retournee) && retournee.payload?.piece_id === pieceB.id && Boolean(retournee.readAt),
  );
  // La prise en charge ne dérange pas le client : il lit « Prise en charge »
  // sur sa pièce, aucune notification ne l'appelle.
  e.verdict(
    "valider ne notifie pas le client",
    deLaPasse(pieceA.id).length === 0 && deLaPasse(pieceC.id).length === 0,
  );
  await e.rpc("collab", "markRead", [retournee.id]);
  const relues = await e.rpc("collab", "notifications", [ids]);
  e.verdict(
    "marquer lu date la lecture, sans rien effacer",
    relues.find((n) => n.id === retournee.id)?.readAt != null,
  );
  const nonLues = relues.filter((n) => !n.readAt && n.createdAt >= DEBUT);
  for (const n of nonLues) await e.rpc("collab", "markRead", [n.id]);
  const apres = await e.rpc("collab", "notifications", [ids]);
  e.verdict(
    "« tout marquer lu » vide l'attente de cette passe",
    apres.filter((n) => !n.readAt && n.createdAt >= DEBUT).length === 0,
    `${nonLues.length} marquée(s)`,
  );
}

/* ------------------------------------------------ exports */
e.section("Export FEC et CSV");
const exercices = await e.rpc("exports", "exercices", [cabinet.id, dossier.tenantId]);
const exercice = exercices.find((x) => !x.clos) ?? exercices[0];
e.verdict(
  "les exercices exportables du dossier se lisent, bornés, celui en cours compris",
  exercices.length > 0 &&
    exercices.every((x) => x.du < x.au && typeof x.clos === "boolean") &&
    exercice?.exercice === Number(AUJOURDHUI.slice(0, 4)),
  exercices.map((x) => `${x.exercice}${x.clos ? " clos" : ""} (${x.ecritures})`).join(", "),
);
const du = exercice.du;
const au = exercice.clos ? exercice.au : AUJOURDHUI;
{
  const tous = await e.rpc("exports", "exercices", [cabinet.id, null]);
  e.verdict("tous mandats confondus, il y a aussi un exercice", tous.length > 0);
}
{
  const csv = await e.rpc("exports", "estimer", [
    cabinet.id,
    dossier.tenantId,
    du,
    au,
    "csv_ecritures",
  ]);
  const fec = await e.rpc("exports", "estimer", [cabinet.id, dossier.tenantId, du, au, "fec"]);
  const planCsv = await e.rpc("exports", "estimer", [cabinet.id, null, du, au, "csv_plan"]);
  e.verdict(
    "l'estimation mesure le fichier réel : lignes et octets, pour les trois formats",
    csv.lignes >= 3 && csv.taille > 0 && fec.lignes === csv.lignes && planCsv.lignes > 0,
    `${csv.lignes} ligne(s) · ${csv.taille} octets · plan ${planCsv.lignes}`,
  );
  // Un refus se lit : la route le rend en 400 avec sa phrase, jamais en « erreur interne ».
  const refuse = (erreur) => erreur !== null && erreur.message.includes(" : 400 ");
  const fecSansDossier = await e.rpcAttenduEnEchec("exports", "estimer", [
    cabinet.id,
    null,
    du,
    au,
    "fec",
  ]);
  e.verdict(
    "un FEC sans dossier est refusé, en clair",
    refuse(fecSansDossier) && fecSansDossier.message.includes("dossier"),
    fecSansDossier?.message ?? "",
  );
  const inconnu = await e.rpcAttenduEnEchec("exports", "estimer", [
    cabinet.id,
    null,
    du,
    au,
    "xml",
  ]);
  e.verdict("un format inconnu est refusé, en clair", refuse(inconnu), inconnu?.message ?? "");
  const aLEnvers = await e.rpcAttenduEnEchec("exports", "generer", [
    cabinet.id,
    null,
    au,
    du,
    "csv_ecritures",
  ]);
  e.verdict(
    "une période à l'envers est refusée, en clair",
    refuse(aLEnvers),
    aLEnvers?.message ?? "",
  );
}
const produits = [];
{
  const x = await e.rpc("exports", "generer", [
    cabinet.id,
    dossier.tenantId,
    du,
    au,
    "csv_ecritures",
  ]);
  produits.push(x);
  const lignes = x.contenu.split("\r\n");
  e.verdict(
    "le CSV des écritures s'ouvre en UTF-8 : marque d'ordre d'octets, en-tête, une ligne par ligne",
    x.contenu.startsWith("﻿dossier;journal;") &&
      lignes.length === x.lignes + 2 &&
      lignes.slice(1, -1).every((l) => l.startsWith(`${dossier.name};`)),
    x.nomDeFichier,
  );
  e.verdict(
    "les lignes comptabilisées de la passe y figurent, sur le journal des achats",
    lignes.some((l) => l.includes(";ACH;") && l.includes("Facture VERRES DE TUNISIE")),
    `${x.lignes} ligne(s)`,
  );
  e.verdict(
    "taille et empreinte sont celles du contenu rendu",
    x.taille === Buffer.byteLength(x.contenu, "utf8") && x.empreinte === sha256(x.contenu),
    x.empreinte.slice(0, 12),
  );
}
{
  const x = await e.rpc("exports", "generer", [cabinet.id, dossier.tenantId, du, au, "fec"]);
  produits.push(x);
  const lignes = x.contenu.split("\r\n").filter((l) => l !== "");
  const colonnes = lignes.map((l) => l.split("|").length);
  e.verdict(
    "le FEC aligne dix-huit colonnes sur chaque ligne, dates en AAAAMMJJ",
    lignes[0].startsWith("JournalCode|JournalLib|EcritureNum|") &&
      colonnes.every((n) => n === 18) &&
      lignes.slice(1).every((l) => /^\d{8}$/.test(l.split("|")[3])),
    `${lignes.length - 1} ligne(s)`,
  );
  e.verdict(
    "le fichier FEC porte l'identifiant du dossier et la date de fin",
    x.nomDeFichier.endsWith(`FEC${au.replaceAll("-", "")}.txt`) &&
      x.typeMime.startsWith("text/plain"),
    x.nomDeFichier,
  );
}
{
  const x = await e.rpc("exports", "generer", [cabinet.id, null, du, au, "csv_plan"]);
  produits.push(x);
  e.verdict(
    "le CSV du plan sort le pack puis les comptes du cabinet",
    x.contenu.startsWith("﻿compte;libelle;parent;classe;origine") && x.lignes === plan.size,
    `${x.lignes} compte(s)`,
  );
}
{
  const historique = await e.rpc("exports", "historique", [cabinet.id]);
  const miens = produits.map((p) => historique.find((h) => h.id === p.id));
  e.verdict(
    "l'historique garde les trois exports : dossier, période, lignes, taille, empreinte, auteur",
    miens.every(
      (h, i) =>
        h &&
        h.lignes === produits[i].lignes &&
        h.taille === produits[i].taille &&
        h.empreinte === produits[i].empreinte &&
        h.auteur === COMPTE_DEV.email &&
        h.du.startsWith(du) &&
        h.au.startsWith(au),
    ) &&
      miens[0].clientNom === dossier.name &&
      miens[2].clientNom === null,
    `${historique.length} export(s) récents`,
  );
  e.verdict(
    "les exports récents sont rendus du plus récent au plus ancien",
    historique.every((h, i) => i === 0 || historique[i - 1].createdAt >= h.createdAt),
  );
}

/* ------------------------------------------------ intégrations et clé d'API */
e.section("Intégrations et clé d'API");
const etatAvant = await e.rpc("integrations", "etat", [cabinet.id]);
e.verdict(
  "l'état des intégrations est lu dans les tables : pièces de l'application, exports",
  etatAvant.piecesApp30j >= 1 && etatAvant.exports30j >= 3 && etatAvant.dernierExport >= DEBUT,
  `${etatAvant.piecesApp30j} pièce(s) · ${etatAvant.exports30j} export(s)`,
);
const clesAvant = await e.rpc("integrations", "cles", [cabinet.id]);
const activesAvant = clesAvant.filter((k) => !k.revokedAt).length;

const lecture = await e.rpc("integrations", "creerCle", [
  cabinet.id,
  "Épreuve — clé de lecture",
  ["ecritures.lire"],
]);
e.verdict(
  "une clé de lecture se crée et n'est rendue en clair qu'une fois, préfixe et suffixe reconnaissables",
  lecture.cle.startsWith("rgo_live_") &&
    lecture.cle.slice(9, 17) === lecture.prefixe &&
    lecture.cle.endsWith(lecture.suffixe),
  `rgo_live_${lecture.prefixe}…${lecture.suffixe}`,
);
{
  const cles = await e.rpc("integrations", "cles", [cabinet.id]);
  const k = cles.find((x) => x.id === lecture.id);
  e.verdict(
    "la liste la montre masquée, active, jamais employée, avec sa portée",
    k &&
      !k.cle &&
      k.revokedAt === null &&
      k.lastUsedAt === null &&
      k.portees.join() === "ecritures.lire",
  );
  e.verdict(
    "les clés actives passent en tête, avant les révoquées",
    cles.findIndex((x) => x.revokedAt) === -1 ||
      cles.findIndex((x) => x.revokedAt) > cles.map((x) => Boolean(x.revokedAt)).lastIndexOf(false),
  );
  const sansNom = await e.rpcAttenduEnEchec("integrations", "creerCle", [
    cabinet.id,
    "  ",
    ["ecritures.lire"],
  ]);
  e.verdict("une clé sans nom est refusée", sansNom !== null, sansNom?.message ?? "");
  const sansPortee = await e.rpcAttenduEnEchec("integrations", "creerCle", [
    cabinet.id,
    "Épreuve",
    [],
  ]);
  e.verdict("une clé sans portée est refusée", sansPortee !== null, sansPortee?.message ?? "");
  const pourPme = await e.rpcAttenduEnEchec("integrations", "creerCle", [
    dossier.tenantId,
    "Épreuve",
    ["ecritures.lire"],
  ]);
  e.verdict("une PME ne porte pas de clé", pourPme !== null, pourPme?.message ?? "");
}
{
  const ouverte = await sousCle(lecture.cle, "office", "periodeLignes", [dossier.tenantId, du, au]);
  e.verdict(
    "sous la clé, un outil tiers lit les lignes comptabilisées du mandat",
    ouverte.status === 200 && ouverte.resultat.length >= 3,
    `${ouverte.status} · ${ouverte.resultat?.length ?? 0} ligne(s)`,
  );
  const parIds = await sousCle(lecture.cle, "office", "ecrituresByIds", [[pieceB.ecritureId]]);
  e.verdict(
    "et les écritures par identifiant",
    parIds.status === 200 && parIds.resultat.length === 1,
    `${parIds.status}`,
  );
  const fermee = await sousCle(lecture.cle, "supervision", "queue", [cabinet.id]);
  e.verdict(
    "hors portée, la file est refusée, sans détail",
    fermee.status === 403 && fermee.erreur === "cette clé ne couvre pas cette opération",
    `${fermee.status} ${fermee.erreur}`,
  );
  const depot = await sousCle(lecture.cle, "capture", "enregistrer", [
    { tenantId: cabinet.id, source: "pdf", vis: "personnel", idempotencyKey: "epreuve-file:cle" },
  ]);
  e.verdict("une clé de lecture ne dépose pas de pièce", depot.status === 403);
  const reflexive = await sousCle(lecture.cle, "integrations", "creerCle", [
    cabinet.id,
    "x",
    ["ecritures.lire"],
  ]);
  e.verdict("une clé ne crée pas de clé", reflexive.status === 403);
  const inconnue = await sousCle(`rgo_live_${"0".repeat(40)}`, "office", "periodeLignes", [
    dossier.tenantId,
    du,
    au,
  ]);
  e.verdict(
    "une clé inconnue est refusée, indistincte d'une clé révoquée",
    inconnue.status === 401 && inconnue.erreur === "clé d'API inconnue ou révoquée",
    `${inconnue.status}`,
  );
  const cles = await e.rpc("integrations", "cles", [cabinet.id]);
  const etat = await e.rpc("integrations", "etat", [cabinet.id]);
  e.verdict(
    "l'usage est daté sur la clé et dans l'état des intégrations",
    cles.find((x) => x.id === lecture.id)?.lastUsedAt >= DEBUT && etat.dernierUsage >= DEBUT,
  );
}
const depotCle = await e.rpc("integrations", "creerCle", [
  cabinet.id,
  "Épreuve — clé de dépôt",
  ["pieces.deposer"],
]);
{
  const enregistree = await sousCle(depotCle.cle, "capture", "enregistrer", [
    {
      tenantId: cabinet.id,
      source: "pdf",
      vis: "personnel",
      idempotencyKey: "epreuve-file:cle-de-depot",
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  e.verdict(
    "une clé de dépôt enregistre une pièce chez le cabinet",
    enregistree.status === 200 && Boolean(enregistree.resultat?.id),
    `${enregistree.status}`,
  );
  if (enregistree.resultat?.id) {
    const octets = await fetch(`${e.BASE}/pieces/${enregistree.resultat.id}/contenu`, {
      method: "POST",
      headers: { Authorization: `Bearer ${depotCle.cle}`, "Content-Type": "application/pdf" },
      // Sa clé d'idempotence est fixe : ses octets aussi, d'une passe à l'autre.
      body: pdf("par-cle", "fixe"),
    });
    e.verdict(
      "et y dépose les octets par la route des pièces",
      octets.status === 201,
      `${octets.status}`,
    );
  }
  const lectureFermee = await sousCle(depotCle.cle, "office", "periodeLignes", [
    dossier.tenantId,
    du,
    au,
  ]);
  e.verdict("une clé de dépôt ne lit pas les écritures", lectureFermee.status === 403);
}
{
  for (const k of [lecture, depotCle]) await e.rpc("integrations", "revoquerCle", [k.id]);
  const cles = await e.rpc("integrations", "cles", [cabinet.id]);
  e.verdict(
    "révoquer date la révocation ; la clé reste listée",
    [lecture, depotCle].every((k) => cles.find((x) => x.id === k.id)?.revokedAt >= DEBUT),
  );
  const revoquee = await sousCle(lecture.cle, "office", "periodeLignes", [
    dossier.tenantId,
    du,
    au,
  ]);
  e.verdict("une clé révoquée ne résout plus", revoquee.status === 401, `${revoquee.status}`);
  const deuxFois = await e.rpcAttenduEnEchec("integrations", "revoquerCle", [lecture.id]);
  e.verdict("une clé ne se révoque pas deux fois", deuxFois !== null, deuxFois?.message ?? "");
  const etat = await e.rpc("integrations", "etat", [cabinet.id]);
  e.verdict(
    "le compte des clés actives est revenu à son point de départ",
    etat.clesActives === activesAvant,
    `${etat.clesActives}`,
  );
}

e.conclure();
