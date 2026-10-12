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
