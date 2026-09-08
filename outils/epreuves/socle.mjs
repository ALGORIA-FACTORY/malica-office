/**
 * Le socle des épreuves de bout en bout — ce que chaque épreuve partage.
 *
 * Une épreuve parle à l'application comme un navigateur : la session par
 * cookie, les dépôts par `/rpc`. Elle rend des verdicts lisibles, et sort en
 * échec dès qu'un verdict est faux. Le certificat de développement n'est
 * toléré que sur une adresse privée.
 *
 *   import { creerEpreuve } from "./socle.mjs";
 *   const e = creerEpreuve("les honoraires");
 *   await e.connecter();            // le compte de développement
 *   const orgs = await e.rpc("identite", "listMyOrganizations");
 *   e.verdict("un cabinet existe", orgs.some((o) => o.kind === "cabinet"));
 *   e.conclure();
 */

export const COMPTE_DEV = { email: "dev@malica.local", motDePasse: "DeveloppeurMalica2026!" };

export function creerEpreuve(nom, base = process.env["MALICA_BASE"] ?? "http://localhost:8080") {
  const BASE = base.replace(/\/+$/, "");
  /*
   * En HTTPS sur une adresse privée, le certificat est celui du poste, signé
   * par lui-même : on cesse de le vérifier, pour ce cas seulement. Sur un
   * hôte public (le staging, le pilote), le certificat est vrai et se vérifie
   * comme dans un téléphone.
   */
  if (BASE.startsWith("https:")) {
    const hote = new URL(BASE).hostname;
    const prive = /^(localhost$|127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hote);
    if (prive) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  }

  let cookie = "";
  let reussites = 0;
  let echecs = 0;
  console.log(`\nÉpreuve — ${nom} — ${BASE}\n`);

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
    if (!r.ok) {
      const corps = (await r.text()).slice(0, 200);
      throw new Error(`${depot}.${methode} : ${r.status} ${corps}`);
    }
    return (await r.json()).resultat;
  }

  /** Comme `rpc`, mais rend l'erreur au lieu de la lancer — pour éprouver un refus. */
  async function rpcAttenduEnEchec(depot, methode, args = []) {
    try {
      await rpc(depot, methode, args);
      return null;
    } catch (erreur) {
      return erreur;
    }
  }

  async function connecter(compte = COMPTE_DEV) {
    cookie = "";
    const r = await appel("/auth/connexion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(compte),
    });
    if (r.status !== 200) throw new Error(`connexion refusée pour ${compte.email} : ${r.status}`);
    return (await r.json()).utilisateur;
  }

  /** Crée le compte s'il n'existe pas, puis s'y connecte. */
  async function inscrireOuConnecter(compte, nom) {
    cookie = "";
    const r = await appel("/auth/inscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...compte, nom }),
    });
    if (r.status === 201) return (await r.json()).utilisateur;
    return connecter(compte);
  }

  function verdict(libelle, ok, detail = "") {
    if (ok) reussites += 1;
    else echecs += 1;
    console.log(`  ${ok ? "OK   " : "ÉCHEC"} ${libelle}${detail ? `  — ${detail}` : ""}`);
    return ok;
  }

  function section(titre) {
    console.log(`\n${titre}`);
  }

  function conclure() {
    console.log(`\n${reussites} réussites · ${echecs} échecs\n`);
    if (echecs > 0) process.exit(1);
  }

  return {
    BASE,
    appel,
    rpc,
    rpcAttenduEnEchec,
    connecter,
    inscrireOuConnecter,
    verdict,
    section,
    conclure,
  };
}
