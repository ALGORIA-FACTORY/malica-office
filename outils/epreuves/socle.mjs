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

/*
 * Les identités d'épreuve vivent ICI, et nulle part ailleurs.
 *
 * Elles étaient recopiées dans cinq fichiers : le même mot de passe écrit cinq
 * fois, la même adresse deux fois. Un secret recopié ne se change jamais —
 * on en oublie toujours une copie — et `outils/comptes-de-parcours.test.mjs`
 * interdit déjà cette recopie pour les comptes de parcours. Même règle ici.
 *
 * Elles restent FICTIVES et jetables : des comptes `@malica.local` sur des
 * bases de travail. Le jour où une épreuve a besoin d'une identité du monde
 * réel, c'est l'épreuve qu'il faut corriger — un matricule réel dans une
 * épreuve est une collision qui attend son tour (4 octobre 2026).
 *
 * Le mot de passe se remplace par `MALICA_MDP_EPREUVE` : sur un environnement
 * joignable depuis Internet, on ne laisse pas un mot de passe que le dépôt
 * publie.
 */
const MDP_PAR_DEFAUT = "EpreuveMalica2026!";
export const MDP_EPREUVE = process.env["MALICA_MDP_EPREUVE"] ?? MDP_PAR_DEFAUT;

export const COMPTE_DEV = {
  email: "dev@malica.local",
  motDePasse: process.env["MALICA_MDP_DEV"] ?? "DeveloppeurMalica2026!",
};

/** Le dirigeant d'épreuve, partagé par les épreuves qui en ont besoin. */
export const DIRIGEANT_EPREUVE = {
  email: "epreuve.dirigeant@malica.local",
  motDePasse: MDP_EPREUVE,
};

/** Sa PME. Matricule volontairement impossible : sept neuf, puis E/P. */
export const PME_EPREUVE = { name: "ÉPREUVE ATELIER SARL", legalId: "9999999E/E/P/000" };

/** Les adresses qui ne quittent pas la machine ou le réseau local. */
const PRIVEE = /^(localhost$|127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Cesser de vérifier le certificat — pour une adresse privée, et elle seule.
 *
 * En HTTPS sur une adresse privée, le certificat est celui du poste, signé par
 * lui-même : le refuser empêcherait d'éprouver l'instance qui sert le
 * téléphone. Sur un hôte public — le staging, le pilote — le certificat est
 * vrai et se vérifie comme dans un téléphone : une épreuve qui l'accepterait
 * les yeux fermés ne prouverait plus rien de ce qu'elle traverse.
 *
 * Ce choix était recopié dans trois fichiers. Une tolérance au certificat qui
 * existe en trois exemplaires finit par être élargie dans un seul.
 */
export function tolererLeCertificatLocal(base) {
  if (!base.startsWith("https:")) return false;
  if (!PRIVEE.test(new URL(base).hostname)) return false;
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  return true;
}

export function creerEpreuve(nom, base = process.env["MALICA_BASE"] ?? "http://localhost:8080") {
  const BASE = base.replace(/\/+$/, "");
  tolererLeCertificatLocal(BASE);

  let cookie = "";
  let reussites = 0;
  let echecs = 0;
  let sansObjets = 0;
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

  /**
   * Le verrou R2 : une personne confirme le type d'une pièce avant toute
   * écriture. L'épreuve joue la personne — une fois : une pièce déjà
   * confirmée, ou déjà engagée par une écriture, ne se précise plus.
   */
  async function confirmerLeType(pieceId, kind) {
    const { piece } = await rpc("capture", "dossier", [pieceId]);
    if (piece.documentKindStatut === "confirme") return;
    await rpc("capture", "preciser", [pieceId, "document_kind", kind]);
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

  /**
   * Ce qui ne peut pas se jouer ici — et le dit. Une épreuve qui a besoin
   * d'une donnée absente de cette instance (le corpus réglementaire, par
   * exemple) ne réussit pas en silence et n'échoue pas à tort : elle nomme ce
   * qui manque, et le bilan le compte à part.
   */
  function sansObjet(libelle, raison) {
    sansObjets += 1;
    console.log(`  —     ${libelle}  — sans objet : ${raison}`);
  }

  function conclure() {
    const aPart = sansObjets > 0 ? ` · ${sansObjets} sans objet` : "";
    console.log(`\n${reussites} réussites · ${echecs} échecs${aPart}\n`);
    if (echecs > 0) process.exit(1);
  }

  return {
    BASE,
    appel,
    rpc,
    rpcAttenduEnEchec,
    connecter,
    inscrireOuConnecter,
    confirmerLeType,
    verdict,
    sansObjet,
    section,
    conclure,
  };
}
