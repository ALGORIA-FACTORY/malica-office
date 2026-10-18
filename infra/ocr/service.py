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
import time

import numpy
from PIL import Image

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from fastapi import FastAPI, Request  # noqa: E402
from paddleocr import PaddleOCR  # noqa: E402

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

# `enable_mkldnn=False` n'est pas un réglage de confort : avec l'accélérateur
# activé, paddle 3.3.1 échoue sur « ConvertPirAttribute2RuntimeAttribute not
# support ». Vérifié identique sur Linux et sur Windows, le 13 octobre 2026.
_ocr = PaddleOCR(
    lang=os.environ.get("OCR_LANGUE", "fr"),
    text_detection_model_name=DETECTION,
    text_recognition_model_name=RECONNAISSANCE,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
)

app = FastAPI()


@app.get("/sante")
def sante() -> dict:
    return {"ok": True, "detection": DETECTION, "reconnaissance": RECONNAISSANCE}


@app.post("/lire")
async def lire(requete: Request) -> dict:
    """Une image en corps brut ; des lignes et leurs boîtes normalisées."""
    octets = await requete.body()
    debut = time.time()

    image = Image.open(io.BytesIO(octets)).convert("RGB")

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
        "modele": f"{DETECTION}+{RECONNAISSANCE}",
    }
