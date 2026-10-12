/**
 * La porte SSH du déploiement ne laisse passer que deux phrases.
 *
 * ================================================================= POURQUOI
 *
 * La clé de la CI est posée dans `authorized_keys` derrière un
 * `command="…/porte-ssh.sh"` : sshd lance ce script À LA PLACE de ce que le
 * client demande. C'est tout ce qui empêche une clé volée d'ouvrir un shell
 * sur le serveur de production.
 *
 * Ce garde-fou ne tient que par un `case` de quatre lignes, et rien ne le
 * vérifiait. Le 12 octobre 2026, en ajoutant la commande `deposer`, il a
 * fallu rouvrir ce `case` — et une porte qu'on modifie sans épreuve est une
 * porte qu'on finit par laisser ouverte.
 *
 * Ces épreuves lancent le vrai script, avec un faux déployeur, et vérifient ce
 * qui passe et ce qui est refusé. Elles tournent dans `npm test`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Le chemin passe par `fileURLToPath` : le dossier du dépôt contient des
// espaces, et une URL les porte encodés — « %20 » n'a jamais lancé un script.
const PORTE = fileURLToPath(new URL("./porte-ssh.sh", import.meta.url));

/** Un faux déployeur : il écrit ses arguments dans un fichier, et rend 0. */
function fauxDeployeur() {
  const dossier = mkdtempSync(join(tmpdir(), "porte-"));
  const trace = join(dossier, "appel.txt");
  const script = join(dossier, "deployeur.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${trace}"\nexit 0\n`);
  chmodSync(script, 0o755);
  return { script, trace };
}

/** Joue la porte avec une demande, et rend le code de sortie et la trace. */
function demander(demande) {
  const { script, trace } = fauxDeployeur();
  let code = 0;
  let erreur = "";
  try {
    execFileSync("bash", [PORTE], {
      env: { ...process.env, SSH_ORIGINAL_COMMAND: demande, DEPLOYEUR: script },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    code = e.status ?? 1;
    erreur = String(e.stderr ?? "");
  }
  let args = null;
  try {
    args = readFileSync(trace, "utf8").trim().split("\n");
  } catch {
    args = null;
  }
  return { code, erreur, args };
}

describe("la porte SSH du déploiement", () => {
  it("laisse passer « deployer <version> », et transmet la version", () => {
    const r = demander("deployer main");
    assert.equal(r.code, 0);
    assert.deepEqual(r.args, ["main"]);
  });

  it("laisse passer « deposer <version> », en le marquant comme tel", () => {
    // Le dépôt du code et le déploiement sont deux gestes : le premier écrit
    // dans le dépôt git, le second démarre des conteneurs. Les confondre
    // ferait d'un envoi de code un redémarrage de production.
    const r = demander("deposer main");
    assert.equal(r.code, 0);
    assert.deepEqual(r.args, ["--deposer", "main"]);
  });

  it("refuse un shell", () => {
    const r = demander("bash -i");
    assert.equal(r.code, 1);
    assert.match(r.erreur, /refusé/);
    assert.equal(r.args, null, "le déployeur ne doit pas même être appelé");
  });

  it("refuse une demande vide — c'est ce que fait « ssh serveur » tout court", () => {
    const r = demander("");
    assert.equal(r.code, 1);
    assert.equal(r.args, null);
  });

  it("refuse une copie de fichier", () => {
    // `scp` et `rsync` passent par SSH comme le reste : sans ce refus, la clé
    // de la CI pourrait lire ou écrire n'importe quel fichier du serveur.
    for (const demande of ["scp -t /srv/malica/.env", "rsync --server -vlogDtpre.iLsfxC . /srv"]) {
      const r = demander(demande);
      assert.equal(r.code, 1, demande);
      assert.equal(r.args, null, demande);
    }
  });

  it("refuse un mot qui COMMENCE comme une commande permise", () => {
    /*
     * « deployeur » et « deposerai » ne sont pas « deployer » et « deposer ».
     * Le motif du `case` exige l'espace qui suit : sans lui, un verbe plus
     * long passerait, et son reste serait pris pour une version.
     */
    for (const demande of ["deployeur main", "deposerait main", "deployer", "deposer"]) {
      const r = demander(demande);
      assert.equal(r.code, 1, demande);
      assert.equal(r.args, null, demande);
    }
  });
});

/**
 * Le dépôt du code se vérifie DANS le dépôt git.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Premier essai réel du nouveau chemin, 12 octobre 2026 : la CI a envoyé le
 * paquet, et le serveur a répondu « le paquet reçu n'est pas un bundle git
 * lisible ». Le paquet était parfait. `git bundle verify` exige seulement
 * d'être DANS un dépôt — « need a repository to verify a bundle » — et sshd
 * démarre dans le dossier personnel de l'utilisateur, qui n'en est pas un.
 *
 * Six épreuves tenaient la porte, aucune ne tenait ce qui se passe derrière.
 * Celle-ci lit le script : la vérification doit nommer le dépôt.
 */
describe("le déposeur", () => {
  const DEPLOYEUR = fileURLToPath(new URL("./deployer.sh", import.meta.url));
  const source = readFileSync(DEPLOYEUR, "utf8");

  it("vérifie le paquet en nommant le dépôt, et non le dossier courant", () => {
    assert.match(
      source,
      /git -C "\$DEPOT" bundle verify/,
      'sans `-C "$DEPOT"`, la vérification échoue depuis le dossier personnel où sshd démarre',
    );
    assert.doesNotMatch(
      source,
      /^\s*git bundle verify/m,
      "aucune commande git du déposeur ne doit dépendre du dossier courant",
    );
  });

  it("refuse un paquet vide, et le dit", () => {
    // Une entrée standard vide est le cas d'un `ssh` lancé à la main sans
    // redirection : il faut le dire, pas déployer la version d'avant.
    assert.match(source, /aucun paquet reçu sur l'entrée standard/);
  });

  it("efface le paquet dans tous les cas", () => {
    // Un bundle de sept mégaoctets par déploiement, laissé derrière, remplit
    // un disque de serveur en quelques semaines.
    // Confié au ménage unique, et non à un trap local qui aurait remplacé le
    // sien — sept mégaoctets par déploiement laissés derrière remplissent un
    // disque de serveur en quelques semaines.
    assert.match(source, /PAQUET_RECU="\$paquet"/);
  });
});

/**
 * Le jeton du registre ne survit pas au déploiement, même raté.
 *
 * ================================================= LE DÉFAUT QU'ELLES TIENNENT
 *
 * Première écriture du mécanisme : `trap … RETURN`. Elle ne se déclenche que
 * si la fonction rend la main — or ce script meurt par `exit 1` dès qu'une
 * étape échoue, et un `trap RETURN` ne court pas sur un `exit`. Le jeton
 * restait donc dans `~/.docker/config.json` exactement dans le cas où cela
 * compte : le déploiement raté, celui qu'on laisse en l'état pour aller voir.
 *
 * Tout le mécanisme existe pour qu'il n'y ait rien à voler sur cette machine
 * entre deux déploiements. Un `trap` posé sur le mauvais signal l'annulait.
 */
describe("le jeton prêté par la CI", () => {
  const source = readFileSync(fileURLToPath(new URL("./deployer.sh", import.meta.url)), "utf8");

  it("se retire sur EXIT, donc aussi quand le déploiement échoue", () => {
    // La déconnexion vit dans le ménage unique, lui-même posé sur EXIT : c'est
    // la suite voisine qui tient l'unicité du trap.
    assert.match(source, /docker logout "\$REGISTRE_CONNECTE"/);
    assert.doesNotMatch(
      source,
      /trap .*docker logout.* RETURN/,
      "un trap RETURN ne court pas sur un `exit` : le jeton survivrait au déploiement raté",
    );
  });

  it("vient avec le nom de son porteur, en deux lignes", () => {
    /*
     * Premiere ecriture : seul le jeton arrivait, et le nom valait
     * « x-access-token » — la convention de git sur HTTPS, qui n est pas celle
     * d un registre. GHCR a accepte la connexion et delivre une autorisation
     * VIDE : le login reussissait, le pull repondait « unauthorized », et
     * aucun des deux ne disait pourquoi. Une heure perdue a chercher une
     * permission d organisation qui n y etait pour rien.
     */
    assert.match(source, /read -r utilisateur/);
    assert.match(source, /read -r jeton/);
    assert.match(source, /docker login "\$registre" -u "\$utilisateur"/);
    // Le motif vise le CODE, pas le commentaire : la phrase qui raconte
    // l'erreur doit rester, c'est elle qui empêche de la refaire.
    assert.doesNotMatch(
      source,
      /-u +"?\$?\{?[A-Za-z_]*:-x-access-token/,
      "le nom du porteur ne se devine pas : il voyage avec le jeton",
    );
  });

  it("refuse un jeton arrive sans son nom", () => {
    // Sinon on retombe sur le defaut precedent : une connexion qui reussit et
    // une autorisation vide, ce qui est la pire des deux issues.
    assert.match(source, /un jeton de registre est arrivé sans son nom de porteur/);
  });
  it("arrive par l'entrée standard, jamais par un argument", () => {
    // Un argument se lit dans la liste des processus, par n'importe qui sur la
    // machine, pendant tout le déploiement.
    assert.match(source, /--password-stdin/);
    assert.doesNotMatch(source, /docker login[^|\n]*--password [^-]/);
  });

  it("ne touche pas le disque, et la variable est vidée après l'usage", () => {
    assert.match(source, /printf '%s' "\$jeton" \|/, "le jeton passe par un tuyau");
    assert.match(source, /\n\s*jeton=""\n/, "la variable est vidée dès que le login est fait");
  });

  it("et son absence n'est pas une erreur", () => {
    /*
     * Un déploiement local, sur des images déjà présentes, n'a personne à qui
     * demander un jeton. Exiger le jeton rendrait le déploiement manuel
     * impossible — c'est-à-dire le dernier recours quand la CI est en panne.
     */
    assert.match(source, /if \[ -n "\$jeton" \]; then/);
  });
});

/**
 * Le script se protège de lui-même.
 *
 * ============================================= DEUX DÉFAUTS QUE RIEN NE RÉVÈLE
 *
 * 1. `deployer` fait un `git checkout` du dépôt — et ce script EST dans le
 *    dépôt. Bash lit un script par morceaux, au fil de l'exécution : réécrire
 *    le fichier sous ses pieds lui fait reprendre la lecture à un décalage
 *    devenu faux, et il exécute une ligne coupée en deux. Le symptôme serait
 *    une erreur de syntaxe surgie au milieu d'un déploiement qui marchait la
 *    veille, sur une machine où le fichier est juste. Rien ne l'a déclenché
 *    les deux fois d'aujourd'hui, parce que l'amorçage à la main avait mis le
 *    script à jour AVANT que la CI ne le lance : le hasard, pas la rigueur.
 *
 * 2. Deux `trap … EXIT` dans un même script ne cohabitent pas : le second
 *    remplace le premier, sans un mot. Il y en a eu trois dans la journée —
 *    la déconnexion du registre, l'effacement du paquet reçu, l'effacement de
 *    la copie du script — et deux se seraient annulées, dont celle qui retire
 *    le jeton.
 */
describe("le script de déploiement", () => {
  const source = readFileSync(fileURLToPath(new URL("./deployer.sh", import.meta.url)), "utf8");

  it("se recopie hors du dépôt avant de le réécrire", () => {
    assert.match(source, /MALICA_DEPLOYEUR_FIGE/, "la garde contre la récursion doit exister");
    assert.match(source, /exec "\$copie" "\$@"/, "le script doit se relancer depuis sa copie");
  });

  it("ne pose QU'UN SEUL trap, et sur EXIT", () => {
    const traps = source.match(/^\s*trap\s/gm) ?? [];
    assert.equal(
      traps.length,
      1,
      `${traps.length} traps : le dernier posé remplace les autres, et celui qui tombe est perdu`,
    );
    assert.match(source, /^trap menage EXIT$/m);
  });

  it("et ce ménage retire les trois choses qui ne doivent pas rester", () => {
    const menage = source.slice(source.indexOf("menage() {"), source.indexOf("trap menage EXIT"));
    assert.match(menage, /docker logout/, "le jeton du registre");
    assert.match(menage, /PAQUET_RECU/, "le paquet git reçu, sept mégaoctets par déploiement");
    assert.match(menage, /MALICA_DEPLOYEUR_COPIE/, "la copie du script");
  });
});

/**
 * Une référence déposée ne vit pas dans l'espace d'un dépôt distant.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Première écriture : le paquet se rangeait sous `refs/remotes/origin/<version>`.
 * Cet espace APPARTIENT à un dépôt distant nommé `origin` — et en retirant de
 * ce serveur le dépôt distant devenu inutile (il n'a plus de clé pour le
 * joindre), `git remote remove origin` a effacé la référence déposée avec lui.
 *
 * Le déploiement suivant aurait dit « cette version n'a pas été déposée » sur
 * un serveur qui l'avait reçue dix minutes plus tôt. Le nettoyage d'une chose
 * morte emportait une chose vivante, parce qu'elles partageaient un nom.
 */
describe("l'espace des références déposées", () => {
  const source = readFileSync(fileURLToPath(new URL("./deployer.sh", import.meta.url)), "utf8");
  /** Le code, sans les commentaires : eux doivent garder la trace de l'erreur. */
  const code = source
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("dépose sous `refs/depose`, et nulle part ailleurs", () => {
    assert.match(code, /fetch --quiet "\$paquet" "HEAD:refs\/depose\/\$version"/);
    assert.doesNotMatch(
      code,
      /refs\/remotes\//,
      "`git remote remove` emporterait la référence déposée avec le dépôt distant",
    );
  });

  it("et relit au même endroit — le dépôt et la lecture ne peuvent pas diverger", () => {
    assert.match(code, /rev-parse --verify --quiet "refs\/depose\/\$version"/);
    assert.match(code, /checkout --quiet --detach "refs\/depose\/\$version"/);
  });
});
