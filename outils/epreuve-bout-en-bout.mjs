/**
 * L'épreuve de bout en bout : le parcours applicatif, à travers le relais.
 *
 * ============================================================== POURQUOI
 *
 * Les épreuves unitaires de ce dépôt sont bonnes et elles ont raté, coup sur
 * coup : les en-têtes HTTP/2 à l'aller, puis au retour, puis une collision de
 * route qui rendait l'application inaccessible. Chacune ne se voyait qu'en
 * parlant au vrai serveur, avec la vraie base derrière.
 *
 * Cette épreuve-ci ne simule rien de ce qu'elle parcourt. Elle se connecte,
 * dépose une pièce et en relit les octets, ouvre et referme un fil de
 * conversation, lit l'historique, transmet au cabinet, et vérifie ce que la base
 * en a retenu — par le MÊME chemin que le navigateur, relais compris.
 *
 * ELLE N'APPELLE AUCUN MODÈLE. Elle ne fait lire aucune pièce (les « pièces
 * lues » qu'elle compte l'ont été sans IA, par le jeu de données) et n'interroge
 * pas Malica : aucune route /malica/*. Son en-tête a longtemps dit le contraire ;
 * le journal de la CI du 15 septembre 2026 l'a démenti. La chaîne de lecture —
 * l'œil, la désignation, le corpus — n'est éprouvée par personne tant qu'une
 * étape ne l'appelle pas.
 *
 *   node outils/epreuve-bout-en-bout.mjs                     (http://localhost:8080)
 *   node outils/epreuve-bout-en-bout.mjs https://192.168.1.192:8443
 *
 * ============================================================ CE QU'ELLE NE
 * ============================================================ COUVRE PAS
 *
 * Ce qui n'existe que dans un navigateur : la caméra, le cadrage, le rendu
 * d'un PDF. Aucun script ne peut en juger — il faut un appareil et un œil. Ce
 * qui est ici est tout le reste, c'est-à-dire l'essentiel de ce qui casse.
 */
const BASE = (process.argv[2] ?? "http://localhost:8080").replace(/\/+$/, "");
const EMAIL = "dev@malica.local";
const MOTDEPASSE = "DeveloppeurMalica2026!";

/*
 * Le certificat de développement est signé par lui-même : l'épreuve doit
 * pouvoir parler à l'instance HTTPS comme un téléphone qui a accepté une fois.
 *
 * Cette tolérance ne vaut QUE pour une adresse privée. Sur un hôte public, un
 * certificat invalide est une alerte et non une formalité — l'épreuve refuse
 * plutôt que de prendre l'habitude de passer outre.
 */
if (BASE.startsWith("https:")) {
  const hote = new URL(BASE).hostname;
  const prive = /^(localhost$|127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hote);
  // Un hôte public (le staging, le pilote) porte un vrai certificat : il se
  // vérifie comme dans un téléphone. Seul le certificat du poste est passé.
  if (prive) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
}

let cookie = "";
let reussites = 0;
let echecs = 0;

function verdict(nom, ok, detail = "") {
  if (ok) reussites += 1;
  else echecs += 1;
  console.log(`  ${ok ? "OK  " : "ÉCHEC"} ${nom}${detail ? `  — ${detail}` : ""}`);
}

async function appel(chemin, opts = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const poses = r.headers.getSetCookie?.() ?? [];
  if (poses.length) cookie = poses.map((c) => c.split(";")[0]).join("; ");
  return r;
}

async function rpc(depot, methode, args = []) {
  const r = await appel("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depot, methode, args }),
  });
  if (!r.ok) throw new Error(`${depot}.${methode} : ${r.status} ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).resultat;
}

console.log(`\nÉpreuve de bout en bout — ${BASE}\n`);

/* ------------------------------------------------- 1. les pages de l'app */
console.log("Les pages de l'application");
for (const chemin of ["/", "/auth", "/pme", "/pme/fiche", "/pme/tva", "/office"]) {
  const r = await appel(chemin);
  // `/auth` est la collision qui avait rendu l'application inaccessible : le
  // relais l'envoyait à l'API, qui répondait « Cannot GET /auth ».
  verdict(`page ${chemin}`, r.status === 200, `${r.status}`);
}

/* ------------------------------------------------------- 2. la session */
console.log("\nLa session");
{
  const r = await appel("/auth/session");
  verdict("sans jeton, l'API refuse", r.status === 401, `${r.status}`);
}
{
  const r = await appel("/auth/connexion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, motDePasse: MOTDEPASSE }),
  });
  verdict("connexion", r.status === 200, `${r.status}`);
  if (r.status !== 200) {
    console.log("\n  La suite dépend de la session. Arrêt.\n");
    process.exit(1);
  }
}
{
  const r = await appel("/auth/session");
  verdict("le cookie porte la session", r.status === 200, `${r.status}`);
}
{
  const r = await appel("/auth/connexion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, motDePasse: "mauvais-mot-de-passe" }),
  });
  verdict("un mauvais mot de passe est refusé", r.status === 401, `${r.status}`);
}

/* ----------------------------------------------------- 3. le référentiel */
console.log("\nLe référentiel");
const orgs = await rpc("identite", "listMyOrganizations");
const dossier = orgs.find((o) => o.kind === "pme");
verdict("un dossier PME existe", Boolean(dossier), dossier?.name ?? "aucun");

const regimes = await rpc("identite", "regimesDisponibles", [dossier.jurisdiction]);
verdict(
  "les régimes viennent de la base",
  regimes.some((r) => r.axe === "imposition") && regimes.some((r) => r.axe === "tva"),
  `${regimes.length} régimes`,
);
verdict(
  "chaque régime porte son fondement",
  regimes.every((r) => r.fondement && r.fondement.length > 10),
  "aucune catégorie inventée",
);

/* -------------------------------------------------- 4. la fiche fiscale */
console.log("\nLa fiche fiscale");
const fiche = await rpc("identite", "ficheCourante", [dossier.id]);
verdict(
  "la fiche du dossier se lit",
  fiche !== undefined,
  fiche ? (fiche.regimeImposition ?? "vide") : "aucune",
);

/* ------------------------------------------------------ 5. la capture */
console.log("\nLa capture");
const marque = `bout-en-bout-${Date.now()}`;
const piece = await rpc("capture", "enregistrer", [
  {
    tenantId: dossier.id,
    source: "photo",
    vis: "partage",
    idempotencyKey: marque,
    contentType: "application/pdf",
    pageCount: 1,
  },
]);
verdict("une pièce s'enregistre", Boolean(piece?.id), piece?.id ?? "");

const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);
{
  const r = await appel(`/pieces/${piece.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });
  verdict("les octets se déposent", r.status === 201, `${r.status}`);
}
{
  const r = await appel(`/pieces/${piece.id}/contenu`);
  const octets = r.ok ? (await r.arrayBuffer()).byteLength : 0;
  verdict(
    "les octets se relisent, à l'identique",
    octets === pdf.length,
    `${octets}/${pdf.length}`,
  );
}
{
  // Le même dépôt deux fois ne crée pas deux pièces : c'est ce qui protège
  // d'un double tap sur l'obturateur.
  const encore = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier.id,
      source: "photo",
      vis: "partage",
      idempotencyKey: marque,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  verdict(
    "le même dépôt ne duplique pas",
    encore.id === piece.id,
    encore.id === piece.id ? "" : "DEUX pièces",
  );
}

/* ------------------------------------------------ 6. le corpus juridique */
console.log("\nLe corpus juridique");
const modele = await rpc("corpus", "modeleEmpreinte");
verdict(
  "le modèle d'empreinte vient de la table des tarifs",
  Boolean(modele?.model) && modele.dimensions > 0,
  `${modele?.model} · ${modele?.dimensions}`,
);

/* ----------------------------------------------------- 7. les conversations */
console.log("\nLes conversations");
const filsAvant = await rpc("conversations", "lister", [dossier.id]);
const fil = await rpc("conversations", "ouvrirNouvelle", [dossier.id]);
verdict("un fil s'ouvre", Boolean(fil?.id), fil?.id ?? "");

await rpc("conversations", "ajouter", [
  { conversationId: fil.id, question: "épreuve", reponse: "réponse d'épreuve" },
]);
const messages = await rpc("conversations", "ouvrir", [fil.id]);
verdict("le fil garde les deux tours", messages.length === 2, `${messages.length} messages`);

await rpc("conversations", "renommer", [{ conversationId: fil.id, titre: "Épreuve" }]);
const filsApres = await rpc("conversations", "lister", [dossier.id]);
verdict(
  "le fil se renomme et se retrouve",
  filsApres.some((f) => f.id === fil.id && f.titre === "Épreuve"),
  `${filsApres.length} fils`,
);

await rpc("conversations", "supprimer", [fil.id]);
const filsFinal = await rpc("conversations", "lister", [dossier.id]);
verdict(
  "le fil se supprime",
  filsFinal.length === filsAvant.length && !filsFinal.some((f) => f.id === fil.id),
  `${filsFinal.length} fils`,
);

/* ------------------------------------------------------ 8. les refus */
/* ------------------------------------------ 7 bis. l'historique des documents */
console.log("\nL'historique des documents");
{
  const histoire = await rpc("capture", "listAvecLecture", [dossier.id]);
  verdict("l'historique vient de la base", Array.isArray(histoire), `${histoire.length} pièces`);
  verdict(
    "la pièce déposée plus haut y figure",
    histoire.some((p) => p.id === piece.id),
  );
  // Le `left join lateral` doit ramener la lecture avec la pièce : une pièce
  // lue sans son émetteur signerait un historique recollé à la main.
  const lues = histoire.filter((p) => p.status !== "capturee");
  verdict(
    "une pièce lue porte ce qui en a été lu",
    lues.length === 0 || lues.some((p) => p.emetteur || p.total),
    `${lues.length} pièces lues`,
  );
  verdict(
    "chaque pièce dit si elle est partie au cabinet",
    histoire.every((p) => p.vis === "personnel" || p.vis === "partage"),
  );
}

/* ------------------------------------- 7 ter. transmettre, puis supprimer */
console.log("\nLa transmission et la suppression");
{
  // Une pièce fraîche, à nous, sur laquelle rien ne s'appuie.
  const brouillon = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier.id,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `brouillon-${Date.now()}`,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  await appel(`/pieces/${brouillon.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });

  let refusAvant = false;
  try {
    await rpc("capture", "supprimer", [brouillon.id]);
  } catch {
    refusAvant = true;
  }
  verdict("un brouillon personnel se supprime", !refusAvant);

  // Le même geste, mais après transmission : la base doit refuser.
  const transmise = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier.id,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `transmise-${Date.now()}`,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  await appel(`/pieces/${transmise.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf,
  });
  await rpc("collab", "setPieceVis", [transmise.id, "partage"]);

  const apres = await rpc("capture", "listAvecLecture", [dossier.id]);
  verdict(
    "la transmission se voit dans l'historique",
    apres.find((p) => p.id === transmise.id)?.vis === "partage",
  );

  // L'étape centrale : le cabinet la voit dans SA file — le chemin réel,
  // sous RLS, celui que l'écran du cabinet emprunte.
  const cabinet = orgs.find((o) => o.kind === "cabinet");
  verdict("un cabinet mandaté existe", Boolean(cabinet), cabinet?.name ?? "aucun");
  const file = cabinet ? await rpc("supervision", "queue", [cabinet.id]) : [];
  verdict(
    "la pièce transmise paraît dans la file du cabinet",
    file.some((p) => p.pieceId === transmise.id || p.piece_id === transmise.id),
    `${file.length} pièce(s) dans la file`,
  );

  let refuse = false;
  let message = "";
  try {
    await rpc("capture", "supprimer", [transmise.id]);
  } catch (e) {
    refuse = true;
    message = String(e.message).slice(0, 80);
  }
  // Le refus vient de la BASE, pas de l'écran : un écran se contourne.
  verdict("une pièce transmise ne se supprime plus", refuse, message);

  /* ------------------------------------------------- 8. rien ne reste */
  // Une épreuve qui laisse des pièces fictives dans le dossier d'un client
  // n'est pas une épreuve : quelqu'un les verra, « Pas encore lue », et
  // tentera de les lire. Tout ce qui a été créé ici est repris, puis effacé.
  console.log("\nRien ne reste");
  await rpc("collab", "setPieceVis", [transmise.id, "personnel"]);
  const fileApres = cabinet ? await rpc("supervision", "queue", [cabinet.id]) : [];
  verdict(
    "une pièce reprise quitte la file du cabinet",
    !fileApres.some((p) => p.pieceId === transmise.id || p.piece_id === transmise.id),
  );
  for (const id of [transmise.id, piece.id]) {
    await rpc("collab", "setPieceVis", [id, "personnel"]);
    await rpc("capture", "supprimer", [id]);
  }
  const restant = await rpc("capture", "listAvecLecture", [dossier.id]);
  const traces = restant.filter((p) => p.id === transmise.id || p.id === piece.id);
  verdict(
    "l'épreuve efface ce qu'elle a créé",
    traces.length === 0,
    `${traces.length} restante(s)`,
  );
}

console.log("\nCe que la base refuse");
{
  let refuse = false;
  try {
    await rpc("identite", "etablirFiche", [
      {
        tenantId: dossier.id,
        regimeImposition: "inexistant",
        source: "saisie",
        validFrom: "2026-01-01",
      },
    ]);
  } catch {
    refuse = true;
  }
  verdict("un régime inconnu est refusé", refuse);
}
{
  let refuse = false;
  try {
    // Un fil qui n'est pas le sien rend une liste vide, pas une erreur : la
    // RLS ne dit pas « interdit », elle dit « rien ».
    const vide = await rpc("conversations", "ouvrir", ["00000000-0000-0000-0000-000000000000"]);
    refuse = Array.isArray(vide) && vide.length === 0;
  } catch {
    refuse = true;
  }
  verdict("un fil étranger ne rend rien", refuse);
}

console.log(`\n${reussites} réussites · ${echecs} échecs\n`);
process.exit(echecs === 0 ? 0 : 1);
