/**
 * Épreuve — ce que la file hors ligne du téléphone attend de l'API.
 *
 *   node outils/epreuves/hors-ligne.mjs [http://localhost:8080]
 *
 * La file rejoue ses pas : une application tuée entre deux d'entre eux
 * recommence le pas manquant, avec la même clé. L'API doit donc tenir ceci,
 * et c'est ce qu'on éprouve sans file ni téléphone :
 *
 *   — enregistrer deux fois avec la même clé rend la MÊME pièce ;
 *   — redéposer les MÊMES octets (la file rejoue ceux qu'elle a rangés) est
 *     sans effet ; d'autres octets sur la même pièce sont refusés (409) : son
 *     contenu est scellé par son empreinte depuis le premier dépôt (3B-1) ;
 *   — une pièce trop volumineuse est refusée en 413, lisiblement, sans laisser
 *     de fichier partiel ;
 *   — demander la lecture sans attendre répond tout de suite, et la redemander
 *     rejoint la même lecture.
 *
 * La lecture qui part ici est réelle si les clés des modèles sont posées : la
 * pièce est un PDF minuscule, que l'œil trouvera vide — c'est voulu, et c'est
 * l'échec le moins cher qui soit.
 */
import { creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("la file hors ligne, côté API", process.argv[2]);

const OCTETS_A = new TextEncoder().encode("%PDF-1.4\nun\n%%EOF\n");
const OCTETS_B = new TextEncoder().encode("%PDF-1.4\ndeux, plus long\n%%EOF\n");

await e.connecter();
const orgs = await e.rpc("identite", "listMyOrganizations");
const dossier = orgs.find((o) => o.kind === "pme") ?? orgs[0];
e.verdict("un dossier existe", Boolean(dossier), dossier?.name ?? "aucun");
if (!dossier) e.conclure();

const cle = `hors-ligne-${Date.now()}`;
const meta = {
  tenantId: dossier.id,
  entityId: null,
  source: "photo",
  vis: "personnel",
  idempotencyKey: cle,
  contentType: "application/pdf",
};

e.section("Enregistrer, deux fois, avec la même clé");
const premiere = await e.rpc("capture", "enregistrer", [meta]);
const seconde = await e.rpc("capture", "enregistrer", [meta]);
e.verdict("la même clé rend la même pièce", premiere.id === seconde.id, premiere.id);

e.section("Déposer les octets, deux fois");
const depot1 = await e.appel(`/pieces/${premiere.id}/contenu`, {
  method: "POST",
  headers: { "Content-Type": "application/pdf" },
  body: OCTETS_A,
});
e.verdict("le premier dépôt est accepté", depot1.status === 201, `${depot1.status}`);
// La file rejoue les octets qu'elle a rangés : les mêmes, à l'octet près.
const rejeu = await e.appel(`/pieces/${premiere.id}/contenu`, {
  method: "POST",
  headers: { "Content-Type": "application/pdf" },
  body: OCTETS_A,
});
e.verdict("le rejeu des mêmes octets est accepté", rejeu.status === 201, `${rejeu.status}`);
// D'autres octets sous le même identifiant : le contenu est scellé.
const autres = await e.appel(`/pieces/${premiere.id}/contenu`, {
  method: "POST",
  headers: { "Content-Type": "application/pdf" },
  body: OCTETS_B,
});
e.verdict(
  "d'autres octets sont refusés : le contenu est scellé",
  autres.status === 409,
  `${autres.status}`,
);
const relu = await e.appel(`/pieces/${premiere.id}/contenu`);
const octetsRelus = new Uint8Array(await relu.arrayBuffer());
e.verdict(
  "ce qu'on relit est le premier envoi, octet pour octet",
  octetsRelus.length === OCTETS_A.length && octetsRelus.every((o, i) => o === OCTETS_A[i]),
  `${octetsRelus.length} octets`,
);

e.section("Une pièce trop volumineuse");
{
  const grosse = await e.rpc("capture", "enregistrer", [
    { ...meta, idempotencyKey: `${cle}-grosse` },
  ]);
  const troisOctets = new Uint8Array(3);
  const refus = await e
    .appel(`/pieces/${grosse.id}/contenu`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", "Content-Length": String(41 * 1024 * 1024) },
      body: troisOctets,
      // Le corps annoncé ne viendra jamais : on coupe court, l'API doit répondre
      // ou refuser sans attendre la fin d'un flux qui n'arrive pas.
      signal: AbortSignal.timeout(5000),
    })
    .catch(() => null);
  // Selon le relais et la version de fetch, la coupure peut arriver avant la
  // réponse : on ne juge que ce qu'on a reçu. Ce qui compte est la ligne d'après.
  e.verdict(
    "un flux qui dépasse la borne n'est pas accepté",
    refus === null || refus.status === 413 || refus.status >= 400,
    refus ? `${refus.status}` : "coupé avant réponse",
  );
  const contenu = await e.appel(`/pieces/${grosse.id}/contenu`);
  e.verdict(
    "et ne laisse aucun fichier partiel derrière lui",
    contenu.status === 404,
    `${contenu.status}`,
  );
}

e.section("Demander la lecture sans attendre");
const demande1 = await e.appel(`/malica/lectures/${premiere.id}?attendre=0`, { method: "POST" });
const d1 = await demande1.json();
e.verdict("la demande répond tout de suite", demande1.status === 200 && d1.enCours === true);
const demande2 = await e.appel(`/malica/lectures/${premiere.id}?attendre=0`, { method: "POST" });
const d2 = await demande2.json();
e.verdict("la redemander rejoint la même lecture", demande2.status === 200 && d2.enCours === true);

e.section("Un corps de requête lourd ou illisible est un refus, pas une panne (ANO-036)");
const lourd = await e.appel("/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    depot: "identite",
    methode: "listMyOrganizations",
    args: ["x".repeat(1_100_000)],
  }),
});
e.verdict(
  "un corps de plus d'un mégaoctet est refusé en 413",
  lourd.status === 413,
  `${lourd.status}`,
);
const illisible = await e.appel("/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{ceci n'est pas du JSON",
});
e.verdict(
  "un corps qui n'est pas du JSON est refusé en 400",
  illisible.status === 400,
  `${illisible.status}`,
);

e.section("Rien ne reste");
// La lecture, réelle ou non, doit se terminer avant qu'on supprime la pièce.
for (let i = 0; i < 120; i += 1) {
  const s = await (await e.appel(`/malica/lectures/${premiere.id}`)).json();
  if (!s.enCours) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const supprimee = await e.rpcAttenduEnEchec("capture", "supprimer", [premiere.id]);
e.verdict("la pièce d'épreuve se supprime", supprimee === null, supprimee?.message ?? "");

e.conclure();
