/**
 * Épreuve — un cabinet invite, une personne rejoint ; un cabinet propose, une
 * PME répond. Et chacun ne voit que ce qu'il doit voir.
 *
 *   node outils/epreuves/mandats-et-invitations.mjs [http://localhost:8080]
 *
 * Rejouable : les comptes et l'organisation qu'elle crée portent des
 * identités fixes ; ce qui existe déjà est repris tel quel.
 */
import { COMPTE_DEV, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("mandats et invitations", process.argv[2]);

const COLLABORATEUR = {
  email: "epreuve.collaborateur@malica.local",
  motDePasse: "EpreuveMalica2026!",
};
const DIRIGEANT = { email: "epreuve.dirigeant@malica.local", motDePasse: "EpreuveMalica2026!" };
const PME = { name: "ÉPREUVE ATELIER SARL", legalId: "9999999/E/P/000" };

/* ------------------------------------------------ le cabinet et son expert */
e.section("Le cabinet");
await e.connecter(COMPTE_DEV);
const orgs = await e.rpc("identite", "listMyOrganizations");
const cabinet = orgs.find((o) => o.kind === "cabinet");
e.verdict("le compte de développement a un cabinet", Boolean(cabinet), cabinet?.name ?? "");
if (!cabinet) e.conclure();

/* ------------------------------------------------ l'invitation */
e.section("L'invitation d'un collaborateur");
// Rejouée, l'épreuve retrouve la personne déjà membre : la base refuse alors
// de l'inviter une seconde fois, et c'est le comportement attendu.
const membresAvant = await e.rpc("collab", "members", [cabinet.id]);
const dejaDansLeCabinet = membresAvant.some((m) => m.email === COLLABORATEUR.email);
let invitation = null;
if (dejaDansLeCabinet) {
  const refusInvitation = await e.rpcAttenduEnEchec("collab", "inviter", [
    { tenantId: cabinet.id, email: COLLABORATEUR.email, role: "collaborateur" },
  ]);
  e.verdict("une personne déjà membre ne s'invite pas", refusInvitation !== null);
} else {
  invitation = await e.rpc("collab", "inviter", [
    { tenantId: cabinet.id, email: COLLABORATEUR.email, role: "collaborateur" },
  ]);
  e.verdict(
    "le cabinet invite une adresse",
    Boolean(invitation?.id),
    invitation?.deja ? "déjà en attente" : "nouvelle",
  );
  const attente = await e.rpc("collab", "invitations", [cabinet.id]);
  e.verdict(
    "l'invitation est en attente côté cabinet",
    attente.some((i) => i.email === COLLABORATEUR.email && !i.acceptedAt),
  );
}

await e.inscrireOuConnecter(COLLABORATEUR, "Épreuve Collaborateur");
const pourMoi = await e.rpc("collab", "invitationsPourMoi");
const dejaMembre = (await e.rpc("identite", "listMyOrganizations")).some(
  (o) => o.id === cabinet.id,
);
e.verdict(
  "la personne invitée voit l'invitation, ou est déjà membre",
  dejaMembre || pourMoi.some((i) => i.cabinetTenantId === cabinet.id),
  dejaMembre ? "déjà membre" : `${pourMoi.length} invitation(s)`,
);
if (!dejaMembre) {
  const mienne = pourMoi.find((i) => i.cabinetTenantId === cabinet.id);
  const rejoint = await e.rpc("collab", "repondreAInvitation", [mienne.id, true]);
  e.verdict(
    "elle rejoint le cabinet",
    rejoint.rejoint === true && rejoint.role === "collaborateur",
  );
}
const mesOrgs = await e.rpc("identite", "listMyOrganizations");
const monRole = mesOrgs.find((o) => o.id === cabinet.id)?.role;
e.verdict("son rôle est collaborateur", monRole === "collaborateur", monRole ?? "aucun");
const acces = await e.rpc("acces", "monAcces", [cabinet.id]);
e.verdict("la base dit le même rôle", acces.role === "collaborateur" && acces.plateforme === false);
const sesMandats = await e.rpc("supervision", "listClients", [cabinet.id]);
const affectations = await e.rpc("collab", "assignments", [cabinet.id]);
const lesSiens = new Set(affectations.filter((a) => a.active).map((a) => a.clientTenantId));
e.verdict(
  "un collaborateur ne voit que les mandats qui lui sont affectés",
  sesMandats.every((c) => lesSiens.has(c.tenantId)),
  `${sesMandats.length} visible(s)`,
);
if (invitation) {
  const refus = await e.rpcAttenduEnEchec("collab", "repondreAInvitation", [invitation.id, true]);
  e.verdict("une invitation ne se rejoint pas deux fois", refus !== null);
}

/* ------------------------------------------------ le mandat proposé */
e.section("Le mandat proposé à une PME");
await e.inscrireOuConnecter(DIRIGEANT, "Épreuve Dirigeant");
let mesPme = (await e.rpc("identite", "listMyOrganizations")).filter((o) => o.kind === "pme");
let pme = mesPme.find((o) => o.legalId === PME.legalId);
if (!pme) {
  const pack = await e.rpc("referentiel", "activePack", ["TN"]);
  const id = await e.rpc("identite", "createOrganization", [
    {
      kind: "pme",
      name: PME.name,
      legalId: PME.legalId,
      jurisdiction: "TN",
      currency: pack.currency ?? "TND",
    },
  ]);
  mesPme = (await e.rpc("identite", "listMyOrganizations")).filter((o) => o.kind === "pme");
  pme = mesPme.find((o) => o.id === id);
}
e.verdict("la PME de l'épreuve existe", Boolean(pme), pme?.name ?? "");

await e.connecter(COMPTE_DEV);
const proposition = await e.rpc("identite", "proposerMandat", [cabinet.id, PME.legalId]);
e.verdict(
  "l'expert propose le mandat par l'identifiant fiscal",
  proposition.pmeTenantId === pme.id,
  `${proposition.status}${proposition.deja ? " (déjà)" : ""}`,
);

await e.connecter(DIRIGEANT);
const proposes = await e.rpc("identite", "mandatsProposes", [pme.id]);
if (proposition.status === "propose") {
  e.verdict(
    "la PME voit le mandat proposé, avec le nom du cabinet",
    proposes.some((m) => m.id === proposition.id && m.cabinet === cabinet.name),
  );
  const reponse = await e.rpc("identite", "repondreAuMandat", [proposition.id, true]);
  e.verdict("la PME accepte : le mandat devient actif", reponse.status === "actif");
} else {
  e.verdict(
    "le mandat était déjà répondu : rien à proposer",
    proposes.length === 0,
    proposition.status,
  );
}
const monCabinet = await e.rpc("identite", "monCabinet", [pme.id]);
e.verdict(
  "la PME connaît maintenant son cabinet",
  monCabinet?.id === cabinet.id,
  monCabinet?.name ?? "aucun",
);
const deuxieme = await e.rpcAttenduEnEchec("identite", "repondreAuMandat", [proposition.id, false]);
e.verdict("un mandat ne se répond pas deux fois", deuxieme !== null);

await e.connecter(COMPTE_DEV);
const clients = await e.rpc("supervision", "listClients", [cabinet.id]);
e.verdict(
  "l'expert voit la PME parmi ses mandats actifs",
  clients.some((c) => c.tenantId === pme.id && c.engagementStatus === "actif"),
);
const notifs = await e.rpc("collab", "notifications", [[pme.id]]);
e.verdict(
  "le cabinet a été notifié de la réponse",
  notifs.some((n) => n.kind === "mandat.accepte"),
  `${notifs.filter((n) => n.kind.startsWith("mandat.")).length} notification(s) de mandat`,
);

e.conclure();
