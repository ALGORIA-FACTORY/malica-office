/**
 * Épreuve — les routes de Malica : ce qui fait parler un modèle a quitté le
 * serveur web pour l'API, sous `/malica`.
 *
 *   node outils/epreuves/malica.mjs [http://localhost:8080]
 *
 * Elle n'appelle aucun modèle : ce qu'elle éprouve, c'est la porte — qui
 * entre, ce qui est refusé, ce qui est rendu quand il n'y a rien à lire — et
 * le contrat que l'application et, demain, la file hors ligne du téléphone
 * attendent. Une lecture réelle coûte un appel payant et une pièce ; elle se
 * regarde dans `epreuve-bout-en-bout.mjs`.
 */
import { creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("les routes de Malica", process.argv[2]);

const INCONNUE = "00000000-0000-4000-8000-000000000000";
const json = (corps) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corps),
});

/* ------------------------------------------------------------ sans session */
e.section("Sans session");
{
  const r = await e.appel(`/malica/lectures/${INCONNUE}`, { method: "POST" });
  e.verdict("lire une pièce exige une identité", r.status === 401, `statut ${r.status}`);
  const etat = await e.appel(`/malica/lectures/${INCONNUE}`);
  e.verdict("demander l'état d'une lecture aussi", etat.status === 401, `statut ${etat.status}`);
}

/* ---------------------------------------------------------- la lecture */
e.section("La lecture, sous identité");
await e.connecter();
{
  const etat = await e.appel(`/malica/lectures/${INCONNUE}`);
  const corps = await etat.json();
  e.verdict(
    "aucune lecture n'est en cours pour une pièce qui n'existe pas",
    etat.status === 200 && corps.enCours === false && corps.depuisMs === null,
    JSON.stringify(corps),
  );

  const mal = await e.appel("/malica/lectures/pas-un-identifiant", { method: "POST" });
  e.verdict("un identifiant mal formé est refusé, sans atteindre la base", mal.status === 400);

  /*
   * `?attendre=0` n'accuse PLUS réception sur du vide, et c'est un progrès.
   *
   * Cette épreuve attendait `{enCours:true}` sur une pièce inexistante. Depuis
   * que la file durable tient la lecture, le travail s'inscrit D'ABORD dans
   * `fabrique.travaux`, et `enregistrerLecture` lit le tenant sur `pieces_v`,
   * sous la RLS : une pièce qu'on ne voit pas n'a pas de tenant, donc elle est
   * refusée TOUT DE SUITE.
   *
   * Avant, la route répondait « en cours » sur une promesse en mémoire du
   * processus — un accusé que rien ne portait, et un refus de lecture s'est
   * déjà perdu de cette façon. La route le dit elle-même désormais : « on ne
   * répond pas en cours sur rien ». Le téléphone y gagne : un accusé sur une
   * pièce disparue le faisait rejouer sans fin.
   *
   * La promesse « répond sans attendre » n'est pas perdue pour autant — elle
   * se garde là où il y a une VRAIE pièce, dans `hors-ligne.mjs`, section
   * « Demander la lecture sans attendre ». Ce module-ci n'en crée aucune, et
   * son en-tête le dit : il n'éprouve que la porte.
   */
  const demandee = await e.appel(`/malica/lectures/${INCONNUE}?attendre=0`, { method: "POST" });
  e.verdict(
    "« demander » refuse une pièce inconnue au lieu d'en accuser réception",
    demandee.status >= 400,
    `statut ${demandee.status}`,
  );
  // Et rien ne reste « en cours » : aucun travail n'a été inscrit du tout.
  const apres = await (await e.appel(`/malica/lectures/${INCONNUE}`)).json();
  e.verdict(
    "aucune lecture ne reste en cours après ce refus",
    apres.enCours === false,
    JSON.stringify(apres),
  );

  const attendue = await e.appel(`/malica/lectures/${INCONNUE}`, { method: "POST" });
  const a = await attendue.json().catch(() => ({}));
  e.verdict(
    "lire une pièce inconnue échoue en le disant",
    attendue.status >= 400 && typeof a.erreur === "string" && a.erreur.length > 0,
    `statut ${attendue.status} — ${a.erreur ?? ""}`,
  );
}

/* --------------------------------------------------------- la carte */
e.section("La carte fiscale");
{
  const sans = await e.appel("/malica/carte", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array([1, 2, 3]),
  });
  e.verdict("sans juridiction, rien n'est lu", sans.status === 400, `statut ${sans.status}`);
  const vide = await e.appel("/malica/carte?jurisdiction=TN", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
  });
  const v = await vide.json().catch(() => ({}));
  e.verdict(
    "un corps vide est un refus, pas une panne",
    vide.status === 400,
    `${vide.status} ${v.erreur ?? ""}`,
  );
}

/* ------------------------------------------------------ les rédactions */
e.section("Les rédactions, avant tout modèle");
{
  const question = await e.appel("/malica/demander", json({ tenantId: "x", question: "" }));
  e.verdict("une question mal formée est refusée", question.status === 400);

  const pv = await e.appel("/malica/pv", json({ pvId: INCONNUE, locale: "fr" }));
  const p = await pv.json();
  e.verdict(
    "un PV inconnu se dit introuvable, sans appeler personne",
    pv.status === 200 && p.ok === false && p.raison === "introuvable",
    JSON.stringify(p),
  );

  const briefing = await e.appel(
    "/malica/briefing",
    json({ cabinetId: INCONNUE, clientId: INCONNUE, collaborateur: "x@y.z", langue: "fr" }),
  );
  const b = await briefing.json().catch(() => ({}));
  // La base refuse le cabinet inconnu avant que le briefing ne cherche le
  // dossier : c'est un refus rédigé, lisible, et aucun modèle n'a été appelé.
  e.verdict(
    "un briefing sur un cabinet inconnu est refusé, sans appeler personne",
    briefing.status >= 400 && briefing.status < 500 && typeof b.erreur === "string",
    `${briefing.status} ${b.erreur ?? ""}`,
  );
}

e.conclure();
