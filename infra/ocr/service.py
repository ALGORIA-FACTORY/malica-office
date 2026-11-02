"""
Le second lecteur : PaddleOCR derrière une porte HTTP, sur le réseau interne.

================================================================== POURQUOI

13 octobre 2026. Sur une facture réelle, « 4 135,183 » imprimé en blanc sur
bande noire est reconnu « + 135,183 » : le 4 devient un +. Le total recollé
ne se lit plus, la pièce finit « anomalie à signaler », et aucune écriture ne
se propose.

Mesuré le même jour sur les treize pièces du staging : PaddleOCR trouve 20
montants que la chaîne actuelle rate, et en rate 4 qu'elle trouve — dont deux
vraies pertes. Cinq contre un. Assez pour en faire un RENFORT, jamais un
remplacement (voir docs/mesure-paddleocr-2026-10-13.md).

=========================================================== CE QU'IL NE FAIT PAS

Il ne comprend rien. Il rend du texte et des positions ; décider lequel de ces
nombres est le total reste le travail de la désignation, et R2 ne bouge pas :
le modèle qui désigne ne voit toujours pas la pièce.

Il ne décide pas non plus quand on l'appelle. C'est l'API qui le fait, et
seulement quand la première lecture a échoué.

=================================================== LE CONTRAT, EN UNE PHRASE

POST /lire, une image en corps brut, et il rend des lignes avec leur boîte
en coordonnées NORMALISÉES — de 0 à 1 dans la page. C'est ce que le plan de
jetons attend ; convertir des pixels côté Node demanderait de lui faire
connaître la taille de l'image, qu'il n'a pas.
"""

import io
import os
import re
import threading
import time

import numpy
from PIL import Image, ImageOps

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import cv2  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from paddleocr import PaddleOCR, TextRecognition  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

# Les modèles MOBILE, pas « server » : mesurés à 1,8 Go de pointe, quand les
# modèles medium font tomber le conteneur sur la machine de recette, partagée
# avec une base de données.
#
# Ce commentaire annonçait « une machine à 8 Go ». Mesuré le 18 octobre 2026
# sur la recette : elle en annonce 3,7 Gio, le conteneur OCR est borné à 2 Gio
# et reposait à 232 Mio. La marge existe, mais elle est bien plus mince que ce
# chiffre ne le laissait croire — et un commentaire qui double la mémoire
# disponible est celui au vu duquel on choisirait les modèles « server ».
#
# Épinglés par leur nom, jamais « le dernier » — une mise à jour silencieuse
# changerait le relevé sans qu'une ligne de code bouge (R8).
DETECTION = os.environ.get("OCR_MODELE_DETECTION", "PP-OCRv5_mobile_det")
RECONNAISSANCE = os.environ.get("OCR_MODELE_RECONNAISSANCE", "latin_PP-OCRv5_mobile_rec")

# L'appareil : « cpu ». Mesure du 24 octobre 2026 sur une RTX 5070 (Paddle
# 3.2.1 cu129) : 0,2 s par page au lieu de 9 s, au meme taux de champs
# trouves. MAIS l'image de ce depot installe paddlepaddle POUR PROCESSEUR :
# « gpu:0 » n'y demarre pas. Le reglage n'a de sens qu'avec une image
# construite sur paddlepaddle-gpu et un compose qui reserve la carte — ni
# l'une ni l'autre n'existent encore (dit dans docs/exploitation.md).
APPAREIL = os.environ.get("OCR_APPAREIL", "cpu")

# Le redressement de page reste COUPE, et c'est mesure le 24 octobre 2026
# (banc de 48 pieces fictives) : avec orientation et redressement actives,
# les factures arabes MANUSCRITES tombent de 77 % a 48 % de champs trouves
# (PP-OCRv6 medium), sans gain ailleurs, pour un temps triple. La photo est
# deja redressee par l'ecran de capture ; son orientation EXIF est appliquee
# ci-dessous.
#
# `enable_mkldnn=False` n'est pas un réglage de confort : avec l'accélérateur
# activé, paddle 3.3.1 échoue sur « ConvertPirAttribute2RuntimeAttribute not
# support ». Vérifié identique sur Linux et sur Windows, le 13 octobre 2026.
_ocr = PaddleOCR(
    lang=os.environ.get("OCR_LANGUE", "fr"),
    device=APPAREIL,
    text_detection_model_name=DETECTION,
    text_recognition_model_name=RECONNAISSANCE,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
)

# ======================================================== LE SECOND ALPHABET
#
# Mesure du 24 octobre 2026 (banc de 48 pieces fictives, scan et photo) : le
# modele latin lit les montants a 100 %, y compris sur les factures arabes,
# mais ne lit JAMAIS un mot arabe (raison sociale : 0 % de ressemblance). Le
# modele arabe lit la raison sociale (100 % imprimee, 85 % manuscrite), et lit
# moins bien les chiffres. Aucun des deux ne suffit seul. Combines ligne par
# ligne : 90 % des champs trouves au lieu de 88 %, raison sociale arabe lue a
# 100 % (imprimee) et 88 % (manuscrite) — pour un temps double (1,1 s au lieu
# de 0,56 s par page a travers ce service sur carte graphique, redimension
# comprise ; 0,2 s pour le modele latin seul hors service).
#
# Quand `OCR_MODELE_RECONNAISSANCE_ARABE` est posee, chaque ligne detectee est
# relue par le modele arabe, et la ligne garde la lecture qui contient de
# l'arabe ET dont la confiance tient : un chiffre reste latin, un mot arabe
# devient arabe. Une seule detection, deux reconnaissances : le cout est celui
# de la seconde reconnaissance, pas d'une seconde lecture.
RECONNAISSANCE_ARABE = os.environ.get("OCR_MODELE_RECONNAISSANCE_ARABE", "")
# Seul le modele mesure, precharge dans l'image et tarife (migration
# 20261025100000) est accepte : un autre nom se telechargerait au demarrage et
# chaque releve serait refuse au journal, faute de tarif.
MODELES_ARABES_CONNUS = {"arabic_PP-OCRv5_mobile_rec"}
if RECONNAISSANCE_ARABE and RECONNAISSANCE_ARABE not in MODELES_ARABES_CONNUS:
    raise SystemExit(f"OCR_MODELE_RECONNAISSANCE_ARABE inconnu : {RECONNAISSANCE_ARABE}")
_arabe = (
    TextRecognition(model_name=RECONNAISSANCE_ARABE, device=APPAREIL, enable_mkldnn=False)
    if RECONNAISSANCE_ARABE
    else None
)


def _a_de_l_arabe(texte: str) -> bool:
    return any("\u0600" <= c <= "\u06ff" or "\ufb50" <= c <= "\ufeff" for c in texte)


def _garder_l_arabe(latin: str, arabe: str, score_latin: float, score_arabe: float) -> bool:
    """Une ligne de CHIFFRES reste au modele latin, qui les lit mieux ; une
    ligne de mots arabes passe au modele arabe, si sa confiance tient."""
    if not _a_de_l_arabe(arabe):
        return False
    visibles = [c for c in latin if not c.isspace()]
    chiffres = sum(1 for c in visibles if c.isdigit() or c in ",./:-")
    if visibles and chiffres / len(visibles) >= 0.6:
        return False
    # Une ligne MIXTE (« المجموع 4 135,183 ») ne bascule que si les deux
    # lectures portent les memes nombres : le modele latin lit mieux les
    # chiffres, et un montant ne se troque pas contre un libelle mieux lu.
    if re.findall(r"\d+", latin) != re.findall(r"\d+", arabe):
        return False
    return score_arabe >= score_latin * 0.8


def _decouper(tableau: numpy.ndarray, polygone) -> numpy.ndarray:
    """La ligne, redressee : la meme decoupe que celle du pipeline PaddleOCR."""
    pts = numpy.array(polygone, dtype=numpy.float32).reshape(-1, 2)
    if len(pts) != 4:
        # Un polygone a plus de quatre points : son rectangle minimal, coins
        # dans l'ordre haut-gauche, haut-droite, bas-droite, bas-gauche.
        boite = cv2.boxPoints(cv2.minAreaRect(pts))
        somme, diff = boite.sum(axis=1), numpy.diff(boite, axis=1).ravel()
        pts = numpy.float32([boite[somme.argmin()], boite[diff.argmin()],
                             boite[somme.argmax()], boite[diff.argmax()]])
    largeur = max(1, int(max(numpy.linalg.norm(pts[0] - pts[1]), numpy.linalg.norm(pts[2] - pts[3]))))
    hauteur = max(1, int(max(numpy.linalg.norm(pts[0] - pts[3]), numpy.linalg.norm(pts[1] - pts[2]))))
    cible = numpy.float32([[0, 0], [largeur, 0], [largeur, hauteur], [0, hauteur]])
    m = cv2.getPerspectiveTransform(pts, cible)
    ligne = cv2.warpPerspective(tableau, m, (largeur, hauteur), borderMode=cv2.BORDER_REPLICATE)
    # Comme le pipeline : une boite bien plus haute que large est une ligne
    # verticale, on la couche.
    return numpy.rot90(ligne) if hauteur / largeur >= 1.5 else ligne


def _relire_en_arabe(tableau, polygones, textes, scores):
    """Relire chaque ligne en arabe ; garder l'arabe la ou il en a.

    Seulement sur `rec_polys` — les polygones des lignes RECONNUES, alignes
    index par index sur `rec_texts` et `rec_scores`. Jamais sur `dt_polys`,
    qui ne leur correspond pas.
    """
    n = min(len(polygones), len(textes), len(scores))
    if _arabe is None or n == 0:
        return textes, scores
    decoupes = [_decouper(tableau, polygones[i]) for i in range(n)]
    relus = [r.json["res"] for r in _arabe.predict(decoupes)]
    sortie_t, sortie_s = list(textes), list(scores)
    for i, r in enumerate(relus[:n]):
        texte_ar, score_ar = r.get("rec_text", ""), float(r.get("rec_score", 0.0))
        if _garder_l_arabe(textes[i], texte_ar, float(scores[i]), score_ar):
            sortie_t[i], sortie_s[i] = texte_ar, score_ar
    return sortie_t, sortie_s


# Le predicteur n'est pas sur a plusieurs fils : une seule lecture a la fois,
# mais HORS de la boucle d'evenements. Avant, `predict` tournait dans la
# boucle elle-meme : pendant une lecture de trente secondes, le controle de
# sante ne repondait plus et le conteneur passait « unhealthy » (audit du
# 24 octobre 2026).
_un_a_la_fois = threading.Lock()

# Et l'attente du verrou est BORNEE (revue du 24 octobre 2026). L'API renonce
# a 120 s ; une requete qui attendrait plus longtemps serait lue pour rien, et
# pousserait les suivantes en delai. Au-dela, 503 : l'API bascule tout de
# suite sur le modele de vision. Une lecture deja commencee, elle, ne
# s'interrompt pas — Paddle ne sait pas annuler — d'ou une borne bien sous
# le delai de l'API.
ATTENTE_MAX_S = float(os.environ.get("OCR_ATTENTE_MAX_S", "45"))

app = FastAPI()


# `async` : le controle de sante ne doit pas passer par le pool de fils que
# les lectures en attente occupent.
@app.get("/sante")
async def sante() -> dict:
    return {
        "ok": True,
        # L'API le relaie dans `/sante/profonde` (`ocr`) : sans lui, elle dit
        # « inconnu » alors que la lecture passe (constaté le 2 novembre 2026,
        # après le retour à Paddle seul de #188). Cette image n'a qu'un moteur.
        "moteur": "paddle",
        "detection": DETECTION,
        "reconnaissance": RECONNAISSANCE,
        "reconnaissance_arabe": RECONNAISSANCE_ARABE or None,
        "appareil": APPAREIL,
    }


@app.post("/lire")
async def lire(requete: Request) -> dict:
    """Une image en corps brut ; des lignes et leurs boîtes normalisées."""
    octets = await requete.body()
    return await run_in_threadpool(_lire, octets)


def _lire(octets: bytes) -> dict:
    if not _un_a_la_fois.acquire(timeout=ATTENTE_MAX_S):
        raise HTTPException(status_code=503, detail="lecteur occupe")
    try:
        return _lire_seul(octets)
    finally:
        _un_a_la_fois.release()


def _lire_seul(octets: bytes) -> dict:
    debut = time.time()

    # L'orientation que le telephone a notee dans la photo : sans elle, une
    # photo prise en portrait par un appareil qui enregistre en paysage arrive
    # couchee, et chaque ligne se lit de travers.
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(octets))).convert("RGB")

    # ============================= ON BORNE CE QU'ON REGARDE, ET ON MESURE POURQUOI
    #
    # 14 octobre 2026, sur la facture reelle, machine de staging, deux fils :
    #
    #     300 dpi (1913x2700)  46 s   tous les montants
    #     200 dpi (1275x1800)  34 s   tous les montants
    #     150 dpi ( 957x1350)  28 s   tous les montants
    #     120 dpi ( 765x1080)  27 s   tous les montants
    #     100 dpi ( 638x 900)  26 s   tous les montants
    #
    # Huit secondes gagnees sans perdre un seul chiffre — y compris le
    # « 4 135,183 » de la bande noire, qui est le cas difficile.
    #
    # En dessous de 150 dpi le gain s'eteint : le temps ne vient plus des
    # pixels mais du NOMBRE de lignes a reconnaitre, quatre-vingt-six ici, et
    # celui-la ne depend pas de la taille. On borne donc a 1600 pixels sur le
    # grand cote — environ 140 dpi pour une A4 — et on s'arrete la.
    #
    # Mesure aussi, et consignee pour qu'on ne la refasse pas : ni le nombre de
    # fils (1 : 37 s, 2 : 28 s, 4 : 30 s) ni le modele (PP-OCRv6 tiny : 31 s,
    # small : 30 s) ne font mieux. Le plancher de cette machine est la.
    COTE_MAX = int(os.environ.get("OCR_COTE_MAX", "1600"))
    if max(image.size) > COTE_MAX:
        facteur = COTE_MAX / max(image.size)
        image = image.resize(
            (max(1, round(image.width * facteur)), max(1, round(image.height * facteur))),
            Image.LANCZOS,
        )

    largeur, hauteur = image.size

    # On passe l'image EN MÉMOIRE, jamais par un fichier.
    #
    # La première écriture enregistrait dans « /tmp/page.png » : un chemin
    # absolu qui n'existe pas sous Windows — le service y rendait une erreur
    # 500 muette — et, partout ailleurs, un chemin FIXE que deux requêtes
    # simultanées écraseraient l'une l'autre.
    tableau = numpy.asarray(image)[:, :, ::-1]  # PIL rend du RVB, Paddle attend du BVR

    lignes = []
    for resultat in _ocr.predict(tableau):
        donnees = resultat.json["res"] if hasattr(resultat, "json") else resultat
        textes = donnees.get("rec_texts", [])
        polygones = donnees.get("rec_polys", []) or donnees.get("dt_polys", [])
        scores = donnees.get("rec_scores", [])
        textes, scores = _relire_en_arabe(tableau, donnees.get("rec_polys", []), textes, scores)
        for i, texte in enumerate(textes):
            if not texte or not texte.strip():
                continue
            # Le polygone a quatre points et peut être incliné : on rend la
            # boîte alignée sur les axes qui l'englobe. C'est ce dont la
            # désignation a besoin pour raisonner en lignes et en colonnes.
            boite = [0.0, 0.0, 1.0, 1.0]
            if i < len(polygones) and polygones[i] is not None:
                xs = [float(p[0]) for p in polygones[i]]
                ys = [float(p[1]) for p in polygones[i]]
                boite = [
                    max(0.0, min(1.0, min(xs) / largeur)),
                    max(0.0, min(1.0, min(ys) / hauteur)),
                    max(0.0, min(1.0, max(xs) / largeur)),
                    max(0.0, min(1.0, max(ys) / hauteur)),
                ]
            lignes.append(
                {
                    "texte": texte,
                    "boite": boite,
                    "confiance": float(scores[i]) if i < len(scores) else None,
                }
            )

    return {
        "lignes": lignes,
        "millisecondes": int((time.time() - debut) * 1000),
        "modele": "+".join(m for m in (DETECTION, RECONNAISSANCE, RECONNAISSANCE_ARABE) if m),
    }
