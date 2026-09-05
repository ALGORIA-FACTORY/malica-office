/**
 * Épreuve — la mise en route d'un cabinet, la file d'arbitrage du conseil,
 * et le procès-verbal de restitution : de bout en bout, par `/rpc`.
 *
 *   node outils/epreuves/conseil-pv-mise-en-route.mjs [http://localhost:8080]
 *
 * Trois registres, dans l'ordre où un cabinet les rencontre :
 *
 *   1. la mise en route — lire l'état, se décrire, inviter une adresse,
 *      proposer un mandat par identifiant fiscal, terminer, relire ;
 *   2. le conseil — un arbitrage en attente, lu dans la file, approuvé ; un
 *      autre corrigé avec réponse et article, dont le message arrive dans le
 *      fil du client ; un troisième écarté ; les statistiques et le seuil ;
 *   3. le PV — un brouillon aux sections écrites ici, sans aucun chiffre,
 *      ouvert, modifié, envoyé, puis figé : la base refuse la retouche, et la
 *      PME reçoit sa notification.
 *
 * Aucun modèle de langage n'est appelé : les textes sont écrits ici, et la
 * seule source citée est un article que le corpus a confirmé exister.
 *
 * Rejouable : la PME d'épreuve, l'adresse invitée et le titre du PV portent
 * des identités fixes ; ce qui existe déjà est repris tel quel. Un PV envoyé
 * ne s'efface pas (R7) : chaque passage en laisse un de plus, daté du jour.
 */
import { COMPTE_DEV, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("conseil, PV et mise en route", process.argv[2]);

const PME = { name: "ÉPREUVE CONSEIL SARL", legalId: "9999997/E/P/000" };
const INVITEE = { email: "epreuve.assistant@regalica.local", role: "assistant" };
const TITRE_PV = "Épreuve — procès-verbal de restitution";
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------ le cabinet, d'abord */
e.section("Le cabinet");
const moi = await e.connecter(COMPTE_DEV);
const orgs = await e.rpc("identite", "listMyOrganizations");
const cabinet = orgs.find((o) => o.kind === "cabinet");
e.verdict("le compte de développement a un cabinet", Boolean(cabinet), cabinet?.name ?? "");
if (!cabinet) e.conclure();
const acces = await e.rpc("acces", "monAcces", [cabinet.id]);
e.verdict(
  "il y est expert : il peut proposer un mandat",
  acces.role === "expert",
  acces.role ?? "aucun",
);

/* ============================================================ MISE EN ROUTE */
e.section("La mise en route — lire l'état");
const avant = await e.rpc("parametrage", "miseEnRoute", [cabinet.id]);
e.verdict(
  "l'état de la mise en route se lit",
  avant !== null && typeof avant === "object" && "termineeLe" in avant,
  avant?.termineeLe ? `terminée le ${avant.termineeLe}` : "jamais terminée",
);

e.section("La mise en route — le cabinet se décrit");
const decrit = await e.rpc("identite", "definirOrganisation", [
  {
    tenantId: cabinet.id,
    name: cabinet.name,
    legalId: cabinet.legalId ?? null,
    jurisdiction: cabinet.jurisdiction,
  },
]);
e.verdict(
  "le cabinet garde son nom et sa juridiction",
  decrit.name === cabinet.name && decrit.jurisdiction === cabinet.jurisdiction,
);
const pack = await e.rpc("referentiel", "activePack", [cabinet.jurisdiction]);
e.verdict(
  "sa devise est celle du pack, jamais saisie",
  Boolean(pack) && decrit.currency === pack.currency,
  decrit.currency,
);
const refusSansNom = await e.rpcAttenduEnEchec("identite", "definirOrganisation", [
  { tenantId: cabinet.id, name: "   ", legalId: null, jurisdiction: cabinet.jurisdiction },
]);
e.verdict("un nom vide est refusé", refusSansNom !== null);

e.section("La mise en route — inviter une adresse");
const invitation = await e.rpc("collab", "inviter", [{ tenantId: cabinet.id, ...INVITEE }]);
e.verdict(
  "l'invitation est consignée",
  Boolean(invitation?.id) && invitation.email === INVITEE.email,
  invitation.deja ? "déjà en attente" : "nouvelle",
);
const invitations = await e.rpc("collab", "invitations", [cabinet.id]);
e.verdict(
  "elle attend, avec le rôle réservé",
  invitations.some((i) => i.id === invitation.id && i.role === INVITEE.role && !i.acceptedAt),
);
const refusAdresse = await e.rpcAttenduEnEchec("collab", "inviter", [
  { tenantId: cabinet.id, email: "pas une adresse", role: INVITEE.role },
]);
e.verdict("une adresse mal formée est refusée", refusAdresse !== null);

e.section("La mise en route — proposer un mandat par identifiant fiscal");
let mesPme = orgs.filter((o) => o.kind === "pme");
let pme = mesPme.find((o) => o.legalId === PME.legalId);
if (!pme) {
  const id = await e.rpc("identite", "createOrganization", [
    {
      kind: "pme",
      name: PME.name,
      legalId: PME.legalId,
      jurisdiction: cabinet.jurisdiction,
      currency: pack.currency,
    },
  ]);
  mesPme = (await e.rpc("identite", "listMyOrganizations")).filter((o) => o.kind === "pme");
  pme = mesPme.find((o) => o.id === id);
}
e.verdict("la PME d'épreuve existe, et le compte en est membre", Boolean(pme), pme?.name ?? "");
if (!pme) e.conclure();

const proposition = await e.rpc("identite", "proposerMandat", [cabinet.id, PME.legalId]);
e.verdict(
  "le mandat se propose par l'identifiant fiscal, et nomme la PME",
  proposition.pmeTenantId === pme.id && proposition.pmeName === PME.name,
  `${proposition.status}${proposition.deja ? " (déjà)" : ""}`,
);
if (proposition.status === "propose") {
  const proposes = await e.rpc("identite", "mandatsProposes", [pme.id]);
  e.verdict(
    "la PME le voit proposé",
    proposes.some((m) => m.id === proposition.id && m.cabinetTenantId === cabinet.id),
  );
  const reponse = await e.rpc("identite", "repondreAuMandat", [proposition.id, true]);
  e.verdict("la PME accepte : le mandat devient actif", reponse.status === "actif");
} else {
  e.verdict("le mandat était déjà actif", proposition.status === "actif", proposition.status);
}
const inconnu = await e.rpcAttenduEnEchec("identite", "proposerMandat", [
  cabinet.id,
  "0000000/Z/Z/000",
]);
e.verdict("un identifiant que personne ne porte est refusé", inconnu !== null);
const clients = await e.rpc("supervision", "listClients", [cabinet.id]);
e.verdict(
  "la PME figure parmi les mandats actifs du cabinet",
  clients.some((c) => c.tenantId === pme.id && c.engagementStatus === "actif"),
);

e.section("La mise en route — terminer, relire");
const fin = await e.rpc("parametrage", "terminerMiseEnRoute", [cabinet.id]);
e.verdict(
  "la mise en route se termine, datée",
  typeof fin?.termineeLe === "string" && !Number.isNaN(Date.parse(fin.termineeLe)),
);
const apres = await e.rpc("parametrage", "miseEnRoute", [cabinet.id]);
e.verdict(
  "relue, elle porte la même date",
  apres.termineeLe === fin.termineeLe,
  apres.termineeLe ?? "aucune",
);
const reglages = await e.rpc("parametrage", "reglagesCabinet", [cabinet.id]);
e.verdict(
  "les réglages se lisent, avec le seuil de certitude du conseil entre 0 et 1",
  typeof reglages.seuilCertitudeConseil === "number" &&
    reglages.seuilCertitudeConseil >= 0 &&
    reglages.seuilCertitudeConseil <= 1,
  `seuil ${reglages.seuilCertitudeConseil} · ton ${reglages.ton}`,
);

/* ================================================================= CONSEIL */
e.section("Le conseil — un article réel, lu dans le corpus");
const veille = await e.rpc("conseil", "veille", [cabinet.jurisdiction]);
e.verdict(
  "la veille rend des éditions du corpus",
  Array.isArray(veille) && veille.length > 0,
  `${veille.length} édition(s)`,
);
const editionTva =
  veille.find((v) => v.corpus === "CTVA") ?? veille.find((v) => v.famille === "code") ?? veille[0];
const noms = await e.rpc("conseil", "nomsDesCorpus", [[editionTva.corpus]]);
const nomDuCorpus = noms[editionTva.corpus] ?? editionTva.corpus;
e.verdict("le corpus a un nom lisible", Boolean(noms[editionTva.corpus]), nomDuCorpus);

// Un paramètre du référentiel cite son article : c'est un article que le
// corpus porte, pas un numéro écrit ici. On le confirme par ses éditions —
// de préférence dans le code que la veille vient de montrer.
const parametres = await e.rpc("corpus", "parametresPour", [
  { jurisdiction: cabinet.jurisdiction, mots: ["taux", "valeur", "ajoutee"], nb: 40 },
]);
const dAbordLaVeille = (a, b) =>
  Number(b.corpus === editionTva.corpus) - Number(a.corpus === editionTva.corpus);
let article = null;
for (const p of [...parametres].sort(dAbordLaVeille)) {
  const m =
    /article\s+(\d+(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?)/i.exec(
      p.article ?? "",
    );
  if (!m || p.confiance !== "confirme") continue;
  const editions = await e.rpc("corpus", "editionsPlusRecentes", [
    [{ corpus: p.corpus, numero: m[1], validFrom: "1900-01-01" }],
  ]);
  const edition = editions[0];
  if (!edition) continue;
  article = {
    corpus: p.corpus,
    numero: edition.numero,
    validFrom: edition.validFrom,
    validTo: null,
    langue: edition.langue,
  };
  break;
}
e.verdict(
  "un article cité par le référentiel existe dans le corpus, avec son édition",
  article !== null,
  article
    ? `${article.corpus} art. ${article.numero} · depuis ${article.validFrom} (${article.langue})`
    : "aucun",
);
if (!article) e.conclure();
const nomsCites = await e.rpc("conseil", "nomsDesCorpus", [[article.corpus]]);
const nomDeLaSource = `${nomsCites[article.corpus] ?? article.corpus} art. ${article.numero}`;

e.section("Le conseil — le contexte du dossier");
const contexte = await e.rpc("conseil", "contexte", [pme.id]);
e.verdict(
  "le dossier connaît son cabinet mandaté",
  contexte.cabinetId === cabinet.id,
  contexte.cabinetNom ?? "aucun",
);
e.verdict(
  "le seuil lu pour le dossier est celui du cabinet",
  contexte.seuil === reglages.seuilCertitudeConseil,
);
e.verdict(
  "l'appelant est membre du dossier : c'est un client qui parle",
  contexte.appelantMembre === true,
);

/** Un fil du client, avec sa question rangée, puis l'arbitrage qui s'y rattache. */
async function poserUnArbitrage({ question, reponse, theme, doute, certitude, statut }) {
  const { id: conversationId } = await e.rpc("conversations", "ouvrirNouvelle", [pme.id]);
  await e.rpc("conversations", "ajouter", [
    {
      conversationId,
      question,
      reponse: "Votre comptable relit ma réponse avant qu'elle ne vous parvienne.",
      model: null,
    },
  ]);
  const cree = await e.rpc("conseil", "creer", [
    {
      tenantId: pme.id,
      conversationId,
      question,
      reponse,
      sources: [article],
      certitude,
      doute,
      canal: "conversation",
      theme,
      langue: "fr",
      statut,
    },
  ]);
  return { conversationId, ...cree };
}

// En dessous du seuil du cabinet, la réponse se retient : la moitié du seuil
// l'est à coup sûr, quel que soit le réglage.
const certitudeRetenue = Math.round((reglages.seuilCertitudeConseil / 2) * 100) / 100;

e.section("Le conseil — un arbitrage en attente, lu dans la file, approuvé");
const premier = await poserUnArbitrage({
  question:
    "Nous avons acheté une voiture de tourisme pour le gérant : peut-on récupérer la TVA sur cette facture ?",
  reponse:
    "Non. La TVA qui grève l'acquisition d'une voiture de tourisme n'ouvre pas droit à déduction lorsque le véhicule ne constitue pas l'objet principal de l'exploitation : la facture se comptabilise toutes taxes comprises.",
  theme: "Déduction de TVA sur véhicule de tourisme",
  doute:
    "L'usage du véhicule n'est pas renseigné dans la fiche : un véhicule utilitaire changerait la réponse.",
  certitude: certitudeRetenue,
  statut: "en_attente",
});
e.verdict(
  "l'arbitrage est créé pour le cabinet mandaté",
  Boolean(premier.id) && premier.cabinetId === cabinet.id,
);
const enAttente = await e.rpc("conseil", "file", [cabinet.id, "en_attente"]);
e.verdict(
  "il attend dans la file du cabinet",
  enAttente.some((a) => a.id === premier.id),
);
const lu = await e.rpc("conseil", "lire", [premier.id]);
e.verdict(
  "lu, il porte la question, la source et le demandeur",
  lu?.statut === "en_attente" &&
    lu.sources[0]?.numero === article.numero &&
    lu.demandeur === moi.email,
  lu?.demandeur ?? "",
);
e.verdict(
  "il retrouve le message de la question dans le fil",
  lu?.conversationId === premier.conversationId && lu.messageId !== null,
);
e.verdict(
  "sa certitude est sous le seuil : c'est pourquoi il attend",
  lu !== null && lu.certitude < reglages.seuilCertitudeConseil,
  `${lu?.certitude} < ${reglages.seuilCertitudeConseil}`,
);

const messageApprouve = [
  lu.reponseProposee,
  `Sources : ${nomDeLaSource}`,
  "Relu et validé par votre comptable.",
].join("\n\n");
const approuve = await e.rpc("conseil", "decider", [
  premier.id,
  "approuvee",
  null,
  null,
  messageApprouve,
]);
e.verdict(
  "le pouce levé change le statut, daté",
  approuve.statut === "approuvee" && approuve.decideLe !== null,
);
const filApprouve = await e.rpc("conversations", "ouvrir", [premier.conversationId]);
const dernierApprouve = filApprouve[filApprouve.length - 1];
e.verdict(
  "la réponse relue arrive dans le fil du client, signée Regalica",
  dernierApprouve?.role === "assistant" && dernierApprouve.contenu === messageApprouve,
  `${filApprouve.length} message(s)`,
);
const deuxFois = await e.rpcAttenduEnEchec("conseil", "decider", [
  premier.id,
  "ecartee",
  null,
  null,
  null,
]);
e.verdict("un arbitrage ne se décide pas deux fois", deuxFois !== null);

e.section("Le conseil — un arbitrage corrigé, avec réponse et article");
const deuxieme = await poserUnArbitrage({
  question:
    "Un fournisseur français nous facture une prestation de conseil : devons-nous retenir quelque chose sur le paiement ?",
  reponse:
    "Une retenue à la source s'applique aux rémunérations versées à un prestataire non résident, sous réserve de la convention entre la Tunisie et la France, qui peut en limiter le taux.",
  theme: "Retenue à la source sur prestataire non résident",
  doute:
    "Le certificat de résidence fiscale du prestataire n'est pas au dossier ; sans lui, le droit commun s'applique.",
  certitude: certitudeRetenue,
  statut: "en_attente",
});
const reponseDuCabinet =
  "Oui : sans certificat de résidence fiscale du prestataire, la retenue de droit commun s'applique sur le montant hors TVA. Envoyez-nous la facture avant tout paiement, nous établissons la retenue et la déclaration qui va avec.";
const articleDuCabinet = `${nomsCites[article.corpus] ?? article.corpus}, art. ${article.numero}`;
const messageCorrige = [
  "Votre comptable a relu ma réponse et la corrige :",
  reponseDuCabinet,
  `Fondement : ${articleDuCabinet}`,
].join("\n\n");
const corrige = await e.rpc("conseil", "decider", [
  deuxieme.id,
  "corrigee",
  reponseDuCabinet,
  articleDuCabinet,
  messageCorrige,
]);
e.verdict(
  "la correction garde la réponse et l'article du cabinet",
  corrige.statut === "corrigee" &&
    corrige.reponseCabinet === reponseDuCabinet &&
    corrige.articleCabinet === articleDuCabinet,
);
const filCorrige = await e.rpc("conversations", "ouvrir", [deuxieme.conversationId]);
const dernierCorrige = filCorrige[filCorrige.length - 1];
e.verdict(
  "la correction arrive dans le fil du client",
  dernierCorrige?.role === "assistant" && dernierCorrige.contenu === messageCorrige,
);
const sansReponse = await e.rpcAttenduEnEchec("conseil", "decider", [
  premier.id,
  "corrigee",
  "   ",
  null,
  null,
]);
e.verdict("une correction sans réponse est refusée", sansReponse !== null);

e.section("Le conseil — un arbitrage écarté");
const troisieme = await poserUnArbitrage({
  question: "Peut-on passer le mariage de ma fille en frais de réception de la société ?",
  reponse:
    "Non : une dépense sans lien avec l'exploitation n'est pas déductible, et elle serait regardée comme un avantage accordé au dirigeant.",
  theme: "Dépense personnelle du dirigeant",
  doute:
    "La question touche à la situation personnelle du dirigeant : elle se traite de vive voix.",
  certitude: certitudeRetenue,
  statut: "en_attente",
});
const messageEcarte = "Votre comptable préfère en parler avec vous de vive voix.";
const ecarte = await e.rpc("conseil", "decider", [
  troisieme.id,
  "ecartee",
  null,
  null,
  messageEcarte,
]);
e.verdict(
  "l'arbitrage est écarté, sans réponse du cabinet",
  ecarte.statut === "ecartee" && ecarte.reponseCabinet === null,
);
const filEcarte = await e.rpc("conversations", "ouvrir", [troisieme.conversationId]);
e.verdict(
  "le client lit qu'on lui en parlera",
  filEcarte[filEcarte.length - 1]?.contenu === messageEcarte,
);

e.section("Le conseil — les statistiques et le seuil");
const stats = await e.rpc("conseil", "statistiques", [cabinet.id]);
e.verdict(
  "les totaux comptent l'approuvé, le corrigé et l'écarté",
  stats.totaux.approuvees >= 1 && stats.totaux.corrigees >= 1 && stats.totaux.ecartees >= 1,
  `${stats.totaux.approuvees} / ${stats.totaux.corrigees} / ${stats.totaux.ecartees} · ${stats.totaux.enAttente} en attente`,
);
const ligne = stats.parClient.find((c) => c.tenantId === pme.id);
e.verdict(
  "la PME a sa ligne, avec au moins trois questions et son dernier sujet",
  Boolean(ligne) &&
    ligne.questions >= 3 &&
    ligne.client === PME.name &&
    ligne.dernierSujet === "Dépense personnelle du dirigeant",
  ligne ? `${ligne.questions} question(s)` : "aucune ligne",
);
e.verdict(
  "les sujets qui reviennent comptent ceux posés",
  stats.sujets.some(
    (s) => s.theme === "Déduction de TVA sur véhicule de tourisme" && s.questions >= 1,
  ),
);
const toute = await e.rpc("conseil", "file", [cabinet.id]);
e.verdict(
  "la file complète rend ce qui attend d'abord",
  toute.length >= 3 &&
    toute.findIndex((a) => a.statut !== "en_attente") >=
      toute.filter((a) => a.statut === "en_attente").length,
  `${toute.length} arbitrage(s)`,
);
const notifsConseil = await e.rpc("collab", "notifications", [[pme.id]]);
e.verdict(
  "le dossier a été notifié de la remise, puis de la décision",
  notifsConseil.some(
    (n) => n.kind === "conseil.arbitrage" && n.payload?.arbitrage_id === premier.id,
  ) &&
    notifsConseil.some(
      (n) =>
        n.kind === "conseil.decide" &&
        n.payload?.arbitrage_id === premier.id &&
        n.payload?.decision === "approuvee",
    ),
);

/* ================================================================= LE PV */
e.section("Le PV — un brouillon, ses sections, aucun chiffre");
const pvId = await e.rpc("collab", "addPv", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: pme.id,
    at: AUJOURDHUI,
    titre: TITRE_PV,
    participants: "Le gérant · l'expert-comptable",
  },
]);
e.verdict("le PV est créé", typeof pvId === "string" && pvId.length > 0);
const brouillon = await e.rpc("collab", "pvOuvrir", [pvId]);
e.verdict(
  "ouvert, c'est un brouillon vide rattaché au client",
  brouillon?.statut === "brouillon" &&
    brouillon.sections.length === 0 &&
    brouillon.clientTenantId === pme.id &&
    brouillon.titre === TITRE_PV,
);
const envoiPrematuré = await e.rpcAttenduEnEchec("collab", "pvEnvoyer", [pvId]);
e.verdict("sans texte, il ne s'envoie pas", envoiPrematuré !== null);

const sections = [
  {
    kicker: "Situation du dossier",
    corps:
      "Le dossier vient d'entrer au cabinet : aucune pièce n'a encore été comptabilisée sur la période, et rien n'est donc à restituer en chiffres. La réunion a servi à poser le cadre de travail et le rythme des échanges.",
  },
  {
    kicker: "Pièces et transmission",
    corps:
      "Le gérant transmettra ses factures d'achat et de vente au fil du mois, depuis l'application. Le cabinet les lit, les propose à la comptabilisation et retourne celles qui manquent d'une mention.",
  },
  {
    kicker: "Suite",
    corps:
      "Un point d'étape est prévu à la fin du mois prochain, avec les premiers chiffres produits par le Socle. Aucune décision engageante n'a été prise lors de cette première rencontre.",
  },
];
const enregistre = await e.rpc("collab", "pvEnregistrer", [
  { id: pvId, sections, chiffres: [], ton: reglages.ton, redigeParRegalica: false },
]);
e.verdict(
  "les sections s'enregistrent, sans chiffre et sans Regalica",
  enregistre.sections.length === sections.length &&
    enregistre.chiffres.length === 0 &&
    enregistre.redigeParRegalica === false &&
    enregistre.ton === reglages.ton,
);
e.verdict(
  "aucun nombre n'apparaît dans le texte",
  !/\d/.test(sections.map((s) => `${s.kicker} ${s.corps}`).join(" ")),
);

e.section("Le PV — modifié, puis envoyé");
const decisions =
  "Transmettre les factures du mois depuis l'application.\nFixer le prochain point d'étape à la fin du mois prochain.";
const modifie = await e.rpc("collab", "pvEnregistrer", [{ id: pvId, decisions }]);
e.verdict(
  "les décisions se consignent sans toucher au texte",
  modifie.decisions === decisions && modifie.sections.length === sections.length,
);
const envoye = await e.rpc("collab", "pvEnvoyer", [pvId]);
e.verdict(
  "l'envoi le date et le passe à envoyé",
  envoye.id === pvId && envoye.statut === "envoye" && envoye.envoyeLe !== null,
);

e.section("Le PV — figé");
const retouche = await e.rpcAttenduEnEchec("collab", "pvEnregistrer", [
  { id: pvId, decisions: "Une autre décision." },
]);
e.verdict(
  "envoyé, il ne se modifie plus",
  retouche !== null,
  retouche ? retouche.message.slice(0, 90) : "",
);
const relu = await e.rpc("collab", "pvOuvrir", [pvId]);
e.verdict(
  "relu, il porte toujours ses décisions et son statut",
  relu?.statut === "envoye" && relu.decisions === decisions && relu.envoyeLe !== null,
);
const encore = await e.rpc("collab", "pvEnvoyer", [pvId]);
e.verdict("un second envoi ne change rien", encore.statut === "envoye" && encore.envoyeLe !== null);
const liste = await e.rpc("collab", "pvList", [cabinet.id]);
e.verdict(
  "il figure dans la liste du cabinet, envoyé",
  liste.some((p) => p.id === pvId && p.statut === "envoye"),
);
const notifsPv = await e.rpc("collab", "notifications", [[pme.id]]);
const notifPv = notifsPv.find((n) => n.kind === "pv.envoye" && n.payload?.pv_id === pvId);
e.verdict(
  "la PME a une notification « pv.envoye », avec le titre et le cabinet",
  Boolean(notifPv) &&
    notifPv.payload?.titre === TITRE_PV &&
    notifPv.payload?.cabinet === cabinet.name,
);

e.conclure();
