/**
 * Épreuve — l'entrée en relation, de bout en bout, à travers le relais.
 *
 * Le Cabinet d'Expertises CADG ouvre le dossier d'une PME qui n'existe pas
 * encore ; il invite son contact par un lien ; le contact crée son accès, lit
 * ce qu'il rejoint, accepte, et arrive dans un espace vide — le sien, et
 * seulement le sien.
 *
 *   node outils/epreuves/entree-en-relation.mjs [http://localhost:8080]
 *
 * Rejouable : les comptes portent des identités d'essai fixes ; un cabinet, un
 * dossier ou une appartenance qui existent déjà sont repris tels quels, et
 * l'épreuve dit lesquels.
 *
 * L'IDENTITÉ DU DOSSIER EST FICTIVE, et doit le rester. Elle a d'abord été
 * celle d'ALGORIA FACTORY, la société du commanditaire, parce que le chantier
 * 3A s'écrivait sur cet exemple. Le jour où ce dossier a été ouvert pour de
 * vrai (4 octobre 2026), l'épreuve est tombée sur « ce matricule fiscal a déjà
 * un dossier » — et sur un environnement partagé elle aurait fait pire que
 * tomber : son compte de contact serait devenu dirigeant de la vraie société.
 * Un matricule réel dans une épreuve est une collision qui attend son tour.
 */
import { MDP_EPREUVE as MDP, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("entrée en relation", process.argv[2]);

const EXPERT = { email: "epreuve.expert.cadg@malica.local", motDePasse: MDP };
const CONTACT = { email: "epreuve.contact.algoria@malica.local", motDePasse: MDP };
const INTRUS = { email: "epreuve.intrus@malica.local", motDePasse: MDP };
const CABINET = "Cabinet d'Expertises CADG";
const DOSSIER = {
  name: "ÉPREUVE ENTRÉE EN RELATION SARL",
  legalId: "9000002/A/M/000",
  adresse: "Immeuble d'épreuve, Rue de l'Essai — 1053 Tunis",
};

/* ------------------------------------------------ le cabinet */
e.section("Le cabinet");
await e.inscrireOuConnecter(EXPERT, "Expert CADG (épreuve)");
let cabinet = (await e.rpc("identite", "listMyOrganizations")).find(
  (o) => o.kind === "cabinet" && o.name === CABINET,
);
if (!cabinet) {
  const id = await e.rpc("identite", "createOrganization", [
    { kind: "cabinet", name: CABINET, validationMode: "mandate", jurisdiction: "TN" },
  ]);
  cabinet = { id, name: CABINET };
}
e.verdict("le cabinet existe, l'expert en est membre", Boolean(cabinet.id), cabinet.name);

/* ------------------------------------------------ le dossier */
e.section("Le dossier d'une PME qui n'existe pas encore");
let clients = await e.rpc("supervision", "listClients", [cabinet.id]);
let dossier = clients.find((c) => c.legalId === DOSSIER.legalId);
if (dossier) {
  e.sansObjet("ouvrir le dossier", "déjà ouvert par une exécution précédente");
} else {
  const ouvert = await e.rpc("identite", "ouvrirDossier", [
    { cabinetTenantId: cabinet.id, ...DOSSIER },
  ]);
  e.verdict(
    "le cabinet ouvre le dossier : raison sociale, matricule, adresse",
    ouvert.name === DOSSIER.name &&
      ouvert.legalId === DOSSIER.legalId &&
      ouvert.adresse === DOSSIER.adresse,
    ouvert.id,
  );
  clients = await e.rpc("supervision", "listClients", [cabinet.id]);
  dossier = clients.find((c) => c.legalId === DOSSIER.legalId);
}
e.verdict(
  "le dossier figure parmi les clients, mandat actif",
  dossier?.engagementStatus === "actif",
  dossier?.tenantId ?? "",
);
const doublon = await e.rpcAttenduEnEchec("identite", "ouvrirDossier", [
  { cabinetTenantId: cabinet.id, ...DOSSIER },
]);
e.verdict("le même matricule n'ouvre pas un second dossier", doublon !== null, doublon ?? "");

/* ------------------------------------------------ l'invitation */
e.section("L'invitation du contact, par un lien");
await e.inscrireOuConnecter(CONTACT, "Contact du dossier (épreuve)");
const dejaMembre = (await e.rpc("identite", "listMyOrganizations")).some(
  (o) => o.id === dossier.tenantId,
);
if (dejaMembre) {
  e.sansObjet(
    "inviter et accepter",
    "le contact a rejoint le dossier lors d'une exécution précédente",
  );
} else {
  await e.connecter(EXPERT);
  const inv = await e.rpc("identite", "inviterContact", [dossier.tenantId, CONTACT.email]);
  e.verdict(
    "le cabinet reçoit le jeton, une fois — 64 caractères hexadécimaux",
    /^[0-9a-f]{64}$/.test(inv.jeton),
    `courriel : ${inv.courriel ?? "—"}`,
  );
  const etats = await e.rpc("identite", "invitationsDuDossier", [dossier.tenantId]);
  const etat = etats.find((i) => i.id === inv.id);
  e.verdict(
    "l'état se lit côté cabinet : en attente, sans jeton",
    etat?.statut === "en_attente" && !("jeton" in etat),
  );

  // Un autre compte, muni du lien, n'entre pas.
  await e.inscrireOuConnecter(INTRUS, "Intrus (épreuve)");
  const refus = await e.rpcAttenduEnEchec("identite", "accepterInvitationParLien", [inv.jeton]);
  e.verdict("un autre compte, muni du lien, est refusé", refus !== null, refus ?? "");

  /* ---------------------------------------------- l'acceptation */
  e.section("Le contact accepte");
  await e.connecter(CONTACT);
  const lue = await e.rpc("identite", "lireInvitationParLien", [inv.jeton]);
  e.verdict(
    "le contact lit ce qu'il rejoint, et pour qui",
    lue?.pme === DOSSIER.name && lue?.cabinet === CABINET && lue?.statut === "en_attente",
    `${lue?.cabinet} → ${lue?.pme}`,
  );
  const accepte = await e.rpc("identite", "accepterInvitationParLien", [inv.jeton]);
  e.verdict(
    "il devient dirigeant du dossier",
    accepte.tenantId === dossier.tenantId && accepte.role === "dirigeant",
  );
  const rejoue = await e.rpcAttenduEnEchec("identite", "accepterInvitationParLien", [inv.jeton]);
  e.verdict("le lien ne sert pas deux fois", rejoue !== null, rejoue ?? "");
}

/* ------------------------------------------------ l'espace vide */
e.section("Un espace vide, le sien seulement");
await e.connecter(CONTACT);
const siens = await e.rpc("identite", "listMyOrganizations");
e.verdict(
  "le contact n'est membre que du dossier qu'il a rejoint",
  siens.length === 1 && siens[0].id === dossier.tenantId,
  siens.map((o) => o.name).join(", "),
);
const pieces = await e.rpc("capture", "lister", [dossier.tenantId]);
e.verdict("son espace est vide : aucune pièce", pieces.length === 0);
const chezLeCabinet = await e.rpc("capture", "lister", [cabinet.id]);
e.verdict(
  "il ne lit rien du cabinet qui l'a invité : liste VIDE, pas une erreur",
  chezLeCabinet.length === 0,
);

/* ------------------------------------------------ l'isolation */
e.section("L'isolation — la pièce d'un autre tenant");
// Une pièce qui existe VRAIMENT ailleurs : l'intrus la dépose dans sa propre
// PME d'essai (clé d'idempotence fixe : rejouée, l'épreuve reprend la même).
// Sans pièce réelle, une liste vide ne prouverait rien.
await e.connecter(INTRUS);
let autre = (await e.rpc("identite", "listMyOrganizations")).find((o) => o.kind === "pme");
if (!autre) {
  const id = await e.rpc("identite", "createOrganization", [
    { kind: "pme", name: "ÉPREUVE AUTRE TENANT", validationMode: "autonome", jurisdiction: "TN" },
  ]);
  autre = { id };
}
const etrangere = await e.rpc("capture", "enregistrer", [
  {
    tenantId: autre.id,
    source: "photo",
    vis: "partage",
    idempotencyKey: "epreuve-entree-en-relation-piece-etrangere",
    contentType: "application/pdf",
    pageCount: 1,
  },
]);
const aLui = await e.rpc("capture", "lister", [autre.id]);
e.verdict("l'autre tenant a bien une pièce", aLui.length > 0, `${aLui.length} pièce(s)`);

await e.connecter(CONTACT);
const vuParLeContact = await e.rpc("capture", "lister", [autre.id]);
e.verdict(
  "le contact lit les pièces de l'autre tenant : VIDE, pas une erreur",
  Array.isArray(vuParLeContact) && vuParLeContact.length === 0,
  `l'autre tenant en compte ${aLui.length}, le contact en voit ${vuParLeContact.length}`,
);
const octets = await e.appel(`/pieces/${etrangere.id}/contenu`);
e.verdict(
  "ses octets ne se lisent pas non plus",
  octets.status === 404,
  `${octets.status} — comme une pièce qui n'existe pas`,
);

e.conclure();
