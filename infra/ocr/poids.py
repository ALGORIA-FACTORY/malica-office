"""
Les poids du lecteur : d'où ils viennent, ce qu'ils doivent peser, et la preuve
qu'ils n'ont pas bougé.

================================================================== POURQUOI

Avant le 1er novembre 2026, l'image téléchargeait ses poids par PaddleOCR, au
nom du modèle, depuis la branche principale de Hugging Face : épinglés par le
NOM, pas par le CONTENU. Une republication sous le même nom aurait changé le
relevé sans qu'une ligne de ce dépôt bouge — exactement ce que R8 interdit.

Désormais `poids.json` porte, pour chaque fichier, son empreinte SHA-256. La
construction télécharge, VÉRIFIE, et refuse l'image au moindre écart ; le
service revérifie au démarrage ce qu'il va charger. Un écart n'est jamais
« corrigé » en recopiant la nouvelle empreinte : il se constate, se compare
(banc), puis se décide.

=================================================================== D'OÙ ILS VIENNENT

Les dépôts officiels `PaddlePaddle/<modèle>` de Hugging Face (Apache-2.0), la
source par défaut de PaddleOCR 3.7. Les empreintes ont été relevées le
1er novembre 2026 sur des copies, faute d'accès direct à Hugging Face depuis
le poste de mesure, et recoupées par deux sources indépendantes :

  - détection et arabe : identiques, fichier par fichier, au registre publié
    dans la roue `rapidocr==3.10.0` (PyPI, `default_models.yaml`) ;
  - latin : identique à une conversion tierce qui cite le dépôt officiel,
    révision ab2cd5cc5fa6309be2e5acdfe66eca2c2c127d57 (836 caractères). Le
    registre RapidOCR porte, lui, une AUTRE version de ce modèle (502
    caractères) : deux fichiers circulent sous ce nom, et seul le contenu les
    distingue.

Si Hugging Face sert autre chose que ces octets, la construction ÉCHOUE, et
c'est voulu.

==================================================================== L'ONNX

Les fichiers `inference.onnx` sont CONVERTIS ici, à la construction, depuis
ces mêmes poids vérifiés (paddle2onnx 2.1.0, opset 14, sans optimiseur) : les
deux moteurs du service lisent donc les MÊMES poids. La conversion est
déterministe — deux passes, mêmes octets —, son résultat a donc aussi son
empreinte. Fidélité mesurée le 1er novembre 2026 sur une page fictive : écart
maximal 4,4e-4 sur la carte de détection, 2e-5 sur les sorties de
reconnaissance, caractère retenu identique en tout point.

  python poids.py telecharger DOSSIER   # paddle/<modèle>/…, vérifiés
  python poids.py convertir DOSSIER     # onnx/<modèle>/inference.onnx, vérifiés
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

MANIFESTE = json.loads((Path(__file__).with_name("poids.json")).read_text(encoding="utf-8"))

# Le gabarit d'URL peut être remplacé à la construction (`--build-arg
# POIDS_SOURCE=…`), pour un miroir interne : les empreintes, elles, ne se
# remplacent pas.
SOURCE = os.environ.get("POIDS_SOURCE") or MANIFESTE["source"]


def empreinte(chemin: Path) -> str:
    h = hashlib.sha256()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def attendus(moteur: str, modele: str) -> dict:
    """Les fichiers qu'un moteur charge pour ce modèle, et leur empreinte."""
    if modele not in MANIFESTE["modeles"]:
        raise SystemExit(f"modèle absent de poids.json : {modele}")
    m = MANIFESTE["modeles"][modele]
    if moteur == "onnx":
        # `inference.yml` porte le dictionnaire et le prétraitement : même
        # fichier, même empreinte, pour les deux moteurs.
        return {"inference.onnx": m["inference.onnx"], "inference.yml": m["fichiers"]["inference.yml"]}
    return dict(m["fichiers"])


def verifier(dossier: Path, moteur: str, modele: str) -> dict:
    """Refuser tout fichier absent ou altéré ; rendre les empreintes vérifiées."""
    ecarts, vus = [], {}
    for fichier, attendu in attendus(moteur, modele).items():
        chemin = dossier / moteur / modele / fichier
        lu = empreinte(chemin) if chemin.exists() else "absent"
        vus[fichier] = lu
        if lu != attendu:
            ecarts.append(f"{moteur}/{modele}/{fichier} : attendu {attendu}, lu {lu}")
    if ecarts:
        raise SystemExit("poids refusés :\n  " + "\n  ".join(ecarts))
    return vus


def telecharger(dossier: Path) -> None:
    for modele, m in MANIFESTE["modeles"].items():
        cible = dossier / "paddle" / modele
        cible.mkdir(parents=True, exist_ok=True)
        for fichier in m["fichiers"]:
            url = SOURCE.format(modele=modele, revision=m["revision"], fichier=fichier)
            with urllib.request.urlopen(url, timeout=300) as r, open(cible / fichier, "wb") as f:
                shutil.copyfileobj(r, f)
        verifier(dossier, "paddle", modele)
        print(f"vérifié : {modele}", flush=True)


def convertir(dossier: Path) -> None:
    for modele in MANIFESTE["modeles"]:
        verifier(dossier, "paddle", modele)
        source, cible = dossier / "paddle" / modele, dossier / "onnx" / modele
        cible.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["paddle2onnx", "--model_dir", str(source),
             "--model_filename", "inference.json", "--params_filename", "inference.pdiparams",
             "--save_file", str(cible / "inference.onnx"),
             "--opset_version", "14", "--enable_onnx_checker", "True",
             # Sans optimiseur : le repli de constantes de Polygraphy installe
             # ses dépendances À LA VOLÉE quand le réseau le permet — l'octet
             # produit dépendrait alors du réseau de la construction. Le banc
             # du 1er novembre 2026 a tourné sur ces fichiers non optimisés.
             "--optimize_tool", "None"],
            check=True,
        )
        shutil.copyfile(source / "inference.yml", cible / "inference.yml")
        verifier(dossier, "onnx", modele)
        print(f"converti et vérifié : {modele}", flush=True)


if __name__ == "__main__":
    action, dossier = sys.argv[1], Path(sys.argv[2])
    {"telecharger": telecharger, "convertir": convertir}[action](dossier)
