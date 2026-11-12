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
 * SANS `--modeles`, ELLE N'APPELLE AUCUN MODÈLE : les « pièces lues » qu'elle
 * compte l'ont été sans IA, par le jeu de données. Son en-tête a longtemps dit
 * le contraire ; le journal de la CI du 15 septembre 2026 l'a démenti.
 *
 * AVEC `--modeles` (l'épreuve de nuit), elle fait lire une image par l'œil et
 * la désignation, et pose une question à Malica — et pour chaque appel, le
 * journal écrit la route, le modèle et les jetons. Un appel sans jetons est un
 * échec.
 *
 *   node outils/epreuve-bout-en-bout.mjs http://localhost:8080 --modeles
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
// L'identité du compte de développement vient du socle des épreuves : une
// seule déclaration pour tout le dépôt, qu'une variable d'environnement
// remplace sur un environnement joignable depuis Internet.
import { COMPTE_DEV, SECOND_EXPERT_DEV, tolererLeCertificatLocal } from "./epreuves/socle.mjs";

const BASE = (process.argv[2] ?? "http://localhost:8080").replace(/\/+$/, "");

/*
 * Le certificat de développement est signé par lui-même : l'épreuve doit
 * pouvoir parler à l'instance HTTPS comme un téléphone qui a accepté une fois.
 * La règle — et sa limite au réseau local — vit dans le socle.
 */
tolererLeCertificatLocal(BASE);

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

/** Ouvre une session : le cookie posé par la réponse remplace le précédent. */
function connecter(compte) {
  return appel("/auth/connexion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: compte.email, motDePasse: compte.motDePasse }),
  });
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
  const r = await connecter(COMPTE_DEV);
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
  const r = await connecter({ email: COMPTE_DEV.email, motDePasse: "mauvais-mot-de-passe" });
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
// Elle naît dans la société, pas chez le cabinet : une pièce non lue n'y part
// pas (3 novembre 2026), et aucune capture de l'application ne l'y fait naître.
const piece = await rpc("capture", "enregistrer", [
  {
    tenantId: dossier.id,
    source: "photo",
    vis: "entite",
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
      vis: "entite",
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

// Le client pose sa question ; la réponse de Malica n'est écrite que par le
// serveur (`conversations.ajouter` est réservée depuis la 0.2.45).
await rpc("conversations", "poser", [{ conversationId: fil.id, question: "épreuve" }]);
const messages = await rpc("conversations", "ouvrir", [fil.id]);
verdict("le fil garde la question", messages.length === 1, `${messages.length} messages`);

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
  // Trois lieux depuis le 19 octobre : l'espace privé, la société, le cabinet.
  verdict(
    "chaque pièce dit où elle est, et si elle est partie au cabinet",
    histoire.every((p) => ["personnel", "entite", "partage"].includes(p.vis)),
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
  // Non lue, elle ne part pas au cabinet (3 novembre 2026) : la base le refuse,
  // quelle que soit la porte (`une_piece_transmise_lue_d_abord`). La pièce lue
  // qui part, paraît dans la file du cabinet et ne se supprime plus est éprouvée
  // avec la chaîne de lecture (`--modeles`) : sans modèle, rien ne se lit.
  let nonLueRefusee = false;
  let motifNonLue = "";
  try {
    await rpc("collab", "setPieceVis", [transmise.id, "partage"]);
  } catch (e) {
    nonLueRefusee = true;
    motifNonLue = String(e.message).slice(0, 80);
  }
  verdict(
    "une pièce non lue ne part pas au cabinet",
    nonLueRefusee && motifNonLue.includes("refus.envoi.pas_lue"),
    motifNonLue || "elle est partie",
  );

  /* ------------------------------------------------- 8. rien ne reste */
  // Une épreuve qui laisse des pièces fictives dans le dossier d'un client
  // n'est pas une épreuve : quelqu'un les verra, « Pas encore lue », et
  // tentera de les lire. Tout ce qui a été créé ici est effacé.
  console.log("\nRien ne reste");
  // Partie malgré tout (une régression de la règle ci-dessus), elle ne revient
  // que par accord du cabinet : la PME demande le rappel, un autre expert
  // l'accorde (nul ne tranche sa propre demande, #146), puis elle s'efface.
  if (!nonLueRefusee) {
    await rpc("collab", "demanderSurPiece", [transmise.id, "rappel"]);
    const r = await connecter(SECOND_EXPERT_DEV);
    if (r.status !== 200) {
      throw new Error(
        `connexion du second expert refusée (${r.status}) : lancez db/dev/jeu_dessai.mjs`,
      );
    }
    await rpc("collab", "repondreSurPiece", [transmise.id, "rappel", true, null]);
    await connecter(COMPTE_DEV);
  }
  for (const id of [transmise.id, piece.id]) await rpc("capture", "supprimer", [id]);
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

/* ------------------------------------- la chaîne de lecture (--modeles) */
/*
 * Seulement avec `--modeles` : ces deux appels sont payants (quelques
 * centimes par nuit) et exigent les clés. L'épreuve de nuit les passe ; un
 * poste sans clés s'en tient au parcours applicatif.
 *
 * Le journal doit PROUVER l'appel, pas le laisser supposer : pour chacun, la
 * route, le modèle que l'API dit avoir interrogé, et les jetons consommés. Un
 * appel sans jetons n'a pas eu lieu — c'est un échec, pas un succès silencieux.
 *
 * La pièce est une image dessinée ici, sans aucune donnée réelle : une image
 * force l'œil (Qwen-VL) et la désignation (DeepSeek). Un PDF à texte natif
 * serait lu sans modèle, et ne prouverait rien.
 */
if (process.argv.includes("--modeles")) {
  console.log("\nLa chaîne de lecture (modèles)");
  const { createCanvas } = await import("@napi-rs/canvas");
  const toile = createCanvas(1240, 1754);
  const c = toile.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 1240, 1754);
  c.fillStyle = "#000000";
  const lignes = [
    ["ÉPREUVE FOURNITURES SARL", 44, 140],
    ["Matricule fiscal 0000000A/A/M/000", 30, 200],
    // Un numéro par exécution : rejouée sur la même base, l'épreuve ne doit pas
    // se reconnaître elle-même comme un doublon à rapprocher.
    [`FACTURE N° EP-${Date.now().toString(36).toUpperCase()}`, 40, 320],
    ["Date : 15/09/2026", 30, 380],
    // Le matricule du client : celui du dossier, lu dans la base — le contrôle
    // du destinataire (3B) doit pouvoir le reconnaître.
    [`Client : ${dossier.name} — MF ${dossier.legalId ?? dossier.legal_id ?? ""}`, 30, 440],
    ["Papier A4, 10 ramettes", 30, 600],
    ["Total HT : 100,000 DT", 34, 900],
    ["TVA 19 % : 19,000 DT", 34, 960],
    // Un droit de timbre imprimé : un montant d'échelle connue, qui tranche la
    // convention d'écriture (dinars ou millimes) que 100 × 1,19 laisse ouverte.
    ["Droit de timbre : 1,000 DT", 30, 1000],
    ["Total TTC : 120,000 DT", 38, 1070],
  ];
  for (const [texte, taille, y] of lignes) {
    c.font = `${taille}px sans-serif`;
    c.fillText(texte, 110, y);
  }
  const image = toile.toBuffer("image/png");

  const lue = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier.id,
      source: "photo",
      vis: "entite",
      idempotencyKey: `bout-en-bout-modeles-${Date.now()}`,
      contentType: "image/png",
      pageCount: 1,
    },
  ]);
  const depot = await appel(`/pieces/${lue.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: image,
  });
  verdict("l'image se dépose", depot.status === 201, `${depot.status}`);

  {
    const route = `/malica/lectures/${lue.id}`;
    const r = await appel(route, { method: "POST" });
    const corps = r.ok ? await r.json() : { erreur: (await r.text()).slice(0, 200) };
    const lecture = corps.resultat ?? corps;
    const preuve = `POST ${route} · modèle ${lecture.model ?? "?"} · jetons ${lecture.tokensIn ?? "?"} → ${lecture.tokensOut ?? "?"}`;
    verdict(
      "une pièce est lue par les modèles",
      r.ok && Boolean(lecture.model) && (lecture.tokensIn ?? 0) > 0,
      r.ok ? preuve : `${r.status} ${corps.erreur ?? ""}`,
    );
    // 3B : la pièce lue est jugée, et chaque organe de la lecture dit s'il est
    // journalisé — ou pourquoi il ne l'est pas (un organe sans tarif relevé).
    const VERDICTS = [
      "à comptabiliser",
      "à comptabiliser avec réserve",
      "à rapprocher",
      "à rejeter",
      "anomalie à signaler",
    ];
    verdict(
      "la pièce lue est jugée, d'un verdict connu",
      r.ok && VERDICTS.includes(lecture.verdict),
      lecture.verdict ?? "aucun verdict",
    );
    // Lue, elle part au cabinet (la règle du 3 novembre 2026), paraît dans sa
    // file — le chemin réel, sous RLS, celui que l'écran du cabinet emprunte —
    // et ne se supprime plus : le refus vient de la BASE, pas de l'écran.
    if (r.ok) {
      await rpc("collab", "setPieceVis", [lue.id, "partage"]);
      const cabinet = orgs.find((o) => o.kind === "cabinet");
      const file = cabinet ? await rpc("supervision", "queue", [cabinet.id]) : [];
      verdict(
        "la pièce lue part au cabinet et paraît dans sa file",
        file.some((p) => p.pieceId === lue.id || p.piece_id === lue.id),
        `${file.length} pièce(s) dans la file`,
      );
      let refuse = false;
      let message = "";
      try {
        await rpc("capture", "supprimer", [lue.id]);
      } catch (e) {
        refuse = true;
        message = String(e.message).slice(0, 80);
      }
      verdict("une pièce transmise ne se supprime plus", refuse, message);
    }
    // 3B-6 : la proposition d'écriture vient du SERVEUR, depuis les montants
    // imprimés et normalisés — le client n'envoie aucune ligne.
    if (["à comptabiliser", "à comptabiliser avec réserve"].includes(lecture.verdict)) {
      const p = await rpc("office", "propositionDePiece", [lue.id]);
      const lignes = p.ok ? p.proposition.lignes : [];
      const debit = lignes.reduce((t, l) => t + Math.round(Number(l.debit) * 1000), 0);
      const credit = lignes.reduce((t, l) => t + Math.round(Number(l.credit) * 1000), 0);
      verdict(
        "le serveur propose une écriture équilibrée, depuis les montants imprimés",
        p.ok && lignes.length > 0 && debit === credit,
        p.ok
          ? `${lignes.length} lignes, ${(debit / 1000).toFixed(3)} au débit comme au crédit`
          : p.raison,
      );
      const ecriture = p.ok ? await rpc("office", "proposerDepuisPiece", [lue.id]) : null;
      verdict("le serveur l'enregistre lui-même", typeof ecriture === "string", ecriture ?? "");
    } else {
      console.log(`  —    la proposition d'écriture — sans objet : verdict « ${lecture.verdict} »`);
    }
    // Le journal d'une lecture : une ligne par organe (le relevé, la
    // désignation), plus, quand Claude a désigné avec son prompt système en
    // cache, une ligne par usage du cache (agent `….cache`, rôles `cache` et
    // `cache_ecriture`, `read-flow.ts`) — facturées à part, donc journalisées à
    // part. Elles n'apparaissent que quand le cache sert : l'épreuve en exigeait
    // exactement deux et a rougi le 10 novembre 2026 sur une ligne de cache
    // légitime. Deux organes, ni plus ni moins ; et CHAQUE ligne journalisée —
    // une dépense non journalisée est une dépense sans plafond.
    const journal = Array.isArray(lecture.journal) ? lecture.journal : [];
    const organes = journal.filter((j) => !String(j.agent ?? "").endsWith(".cache"));
    verdict(
      "les deux organes de la lecture rendent compte au journal",
      organes.length === 2 && journal.every((j) => j.journalise),
      journal
        .map(
          (j) =>
            `${j.agent ?? "?"} · ${j.model} : ${
              j.journalise ? "journalisé" : `non journalisé (${j.raison ?? "?"})`
            }`,
        )
        .join(" ; ") || "rien",
    );
  }
  {
    const route = "/malica/demander";
    const r = await appel(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: dossier.id,
        question: "Combien de pièces ai-je déposées ce mois-ci ?",
        locale: "fr",
        mode: "chat",
      }),
    });
    const corps = r.ok ? await r.json() : { erreur: (await r.text()).slice(0, 200) };
    const reponse = corps.resultat ?? corps;
    // Le navigateur ne reçoit jamais la mécanique (modèle, jetons, durée) : elle
    // reste au journal des agents (lot C, 10 novembre 2026). L'épreuve exige donc
    // une vraie réponse, et que rien de la mécanique ne sorte.
    const texte = typeof reponse.answer === "string" ? reponse.answer.trim() : "";
    const muette =
      !reponse.model && reponse.tokensIn == null && reponse.tokensOut == null && !reponse.runId;
    verdict(
      "Malica répond à une question, sans livrer sa mécanique",
      r.ok && texte.length > 0 && muette,
      r.ok
        ? `POST ${route} · ${texte.length} caractère(s) · mécanique ${muette ? "absente" : "PRÉSENTE"}`
        : `${r.status} ${corps.erreur ?? ""}`,
    );
  }
}

console.log(`\n${reussites} réussites · ${echecs} échecs\n`);
process.exit(echecs === 0 ? 0 : 1);
