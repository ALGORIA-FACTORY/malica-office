"""
Le lecteur OCR : PP-OCRv5 derrière une porte HTTP, sur le réseau interne.

========================================= ONNX D'ABORD, PADDLE LA NUIT (1er nov. 2026)

Décision du dirigeant, sur mesure. Banc du 1er novembre 2026 : 150 pièces
fictives (152 pages, jeux « 100 » et « 50 »), même redimension que ce service,
jetons passés par le code de production (`lireAvecPaddle`, `recollerLesMilliers`)
puis par le moteur Sudoku natif ; poste à 2 cœurs Xeon 2,1 GHz :

    moteur (mêmes poids)        centre prouvé  lignes prouvées  médiane  p95    pointe
    paddle (Paddle 3.3.1)            111             91          11,1 s  15,7 s  1,45 Gio
    onnx (onnxruntime 1.31.1)        111             91           3,1 s   4,6 s  0,87 Gio

Mêmes textes sur 149 pages sur 152 (3 lignes diffèrent), mêmes preuves, une
seule « fausse » au sens du banc, la même pour les deux : 100/D-08, imprimée à
deux décimales, dont le Sudoku prouve les montants IMPRIMÉS (3,28 pour
3,276). Le multilingue de RapidOCR, essayé aussi, prouve moins (110 / 81).
D'où `OCR_MOTEUR=onnx` par défaut ; `paddle` reste pour la relecture de nuit.
Chiffres complets et réserves : docs/exploitation.md, section OCR.

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

Il ne décide pas non plus quand on l'appelle. C'est l'API qui le fait
(`apps/api/src/malica/lecture/vision.ts`, `relever`) : pour une photo, et pour
un PDF dont la couche de texte ne se croit pas, il passe AVANT le modèle de
vision ; un PDF qui porte son texte ne lui arrive jamais.

=================================================== LE CONTRAT, EN UNE PHRASE

POST /lire, une image en corps brut, et il rend des lignes avec leur boîte
en coordonnées NORMALISÉES — de 0 à 1 dans la page, en deux temps (une ligne
JSON chacun) : le tableau d'abord, la page entière ensuite. C'est ce que le plan de
jetons attend ; convertir des pixels côté Node demanderait de lui faire
connaître la taille de l'image, qu'il n'a pas.
"""

import base64
import io
import json
import os
import queue
import re
import time
from pathlib import Path

import numpy
from PIL import Image, ImageOps

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import cv2  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from paddleocr import TextDetection, TextRecognition  # noqa: E402
from paddlex.inference.pipelines import load_pipeline_config  # noqa: E402
from paddlex.inference.pipelines.components import CropByPolys, SortQuadBoxes  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

import poids  # noqa: E402

# ============================================================= LE MOTEUR
#
# `onnx` (défaut) : les poids PP-OCRv5 convertis en ONNX, exécutés par
# onnxruntime À TRAVERS les modules de PaddleOCR (`engine="onnxruntime"`) —
# même découpe, même post-traitement, mêmes poids vérifiés : seul le moteur de
# calcul change. C'est le PREMIER lecteur depuis le 1er novembre 2026.
#
# `paddle` : Paddle Inference, le lecteur d'avant, gardé pour la relecture
# lourde de nuit. Même contrat, mêmes poids.
#
# Un autre mot est refusé au démarrage : un moteur inconnu ne se rabat sur
# rien en silence.
MOTEUR = os.environ.get("OCR_MOTEUR", "onnx")
if MOTEUR not in poids.MANIFESTE["moteurs"]:
    raise SystemExit(f"OCR_MOTEUR inconnu : {MOTEUR}")
POIDS = Path(os.environ.get("OCR_POIDS", "/app/poids"))

# Un seul réglage de fils pour les deux moteurs : celui que le compose pose
# déjà (`OCR_FILS` → `OMP_NUM_THREADS`). Deux sur la CX23 (mesuré, plus bas).
FILS = int(os.environ.get("OMP_NUM_THREADS", "2"))

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
# Le second alphabet, ligne par ligne (voir plus bas) : vide = coupé.
RECONNAISSANCE_ARABE = os.environ.get("OCR_MODELE_RECONNAISSANCE_ARABE", "")

# ============================================ CE QUI EST CHARGÉ, ET SON NOM
#
# Seuls les modèles de `poids.json` existent : leurs poids sont DANS l'image,
# vérifiés à la construction, et revérifiés ici AVANT d'être chargés. Un autre
# nom, ou un fichier altéré, arrête le service au démarrage — au lieu de
# télécharger on ne sait quoi, et de rendre des relevés refusés au journal
# faute de tarif.
#
# Le nom du relevé porte les modèles ET le moteur : deux moteurs, même sur les
# mêmes poids, ne rendent pas des relevés identiques à l'octet, et le journal
# doit pouvoir les compter séparément. Chaque nom possible est tarifé
# (migrations 20261014090000, 20261025100000, 20261115090000) ; l'accord est
# vérifié par `infra/ocr/tarif.test.mjs`.
_MODELES = [m for m in (DETECTION, RECONNAISSANCE, RECONNAISSANCE_ARABE) if m]
EMPREINTES = {m: poids.verifier(POIDS, MOTEUR, m) for m in _MODELES}
_SUFFIXE = poids.MANIFESTE["moteurs"][MOTEUR]["suffixe_du_releve"]
MODELE = "+".join(_MODELES) + _SUFFIXE
# Une page sans ligne relue en arabe n'a été lue que par le modèle latin : son
# relevé porte ce nom-là (tarifé lui aussi), pas celui d'un modèle qui n'a pas
# tourné.
MODELE_LATIN = "+".join((DETECTION, RECONNAISSANCE)) + _SUFFIXE

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
#
# `lang` n'est plus passé : PaddleOCR l'ignore dès que les modèles sont
# nommés (il le dit lui-même), et un réglage sans effet est un réglage qui
# ment (`OCR_LANGUE` est retiré de l'image).
_COMMUN = (
    {"device": APPAREIL, "enable_mkldnn": False, "cpu_threads": FILS}
    if MOTEUR == "paddle"
    else {
        "device": APPAREIL,
        "engine": "onnxruntime",
        # Sans l'arène mémoire d'onnxruntime : chaque page a sa taille, et
        # l'arène garde la plus grande. Mesuré le 1er novembre 2026 sur 20
        # pages : pointe 749 Mio au lieu de 1 099, même vitesse, mêmes textes.
        "engine_config": {
            "intra_op_num_threads": FILS,
            "inter_op_num_threads": 1,
            "enable_cpu_mem_arena": False,
        },
    }
)


def _dossier(modele: str) -> str:
    return str(POIDS / MOTEUR / modele)


# =========================================== LA LECTURE, GESTE PAR GESTE (4 novembre 2026)
#
# Le pipeline de PaddleOCR detecte, trie, decoupe et reconnait d'un seul tenant. Le service
# fait ces quatre gestes LUI-MEME, avec les MEMES modules et les MEMES reglages (lus dans la
# configuration du pipeline, `load_pipeline_config("OCR")`, jamais recopies ici) : la lecture
# est celle du pipeline, mais elle rend le tableau d'abord (`/lire`, deux temps, plus bas).
_REGLAGES = load_pipeline_config("OCR")["SubModules"]
_DETECTER_AVEC = {
    cle: _REGLAGES["TextDetection"][cle]
    for cle in ("limit_side_len", "limit_type", "max_side_limit", "thresh", "box_thresh", "unclip_ratio")
}
_SEUIL_DE_RECONNAISSANCE = float(_REGLAGES["TextRecognition"]["score_thresh"])
_trier = SortQuadBoxes()
_decouper = CropByPolys(det_box_type="quad")
# Le lot de reconnaissance, pour les deux alphabets : celui du pipeline, les lignes triees
# par largeur (un lot de meme gabarit se rembourre peu). Mesure du 4 novembre 2026, banc
# sans IA (412 pieces, 210 images) : une ligne a la fois ne gagne que 2,5 % de la mediane,
# et change le bruit de lecture de quelques champs (deux faux de plus).
#
# Mesure le meme jour, et consigne pour qu'on ne la refasse pas (MyTek, deux processeurs) :
# la reconnaissance est liee au calcul, pas au Python (3,7 s de 3,9 dans onnxruntime).
#   - deux sessions a un fil, lots identiques en parallele : 3,2 s contre 3,1 s ;
#   - poids quantifies en int8 (dynamique) : 5,9 s contre 3,5 s, et 36 lignes sur 140 lues
#     autrement (« Algorla Factory », « MontantW ») — sans instructions VNNI, l'int8 perd.
LOT = int(os.environ.get("OCR_LOT", _REGLAGES["TextRecognition"]["batch_size"]))

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
# Quand `OCR_MODELE_RECONNAISSANCE_ARABE` est posee, chaque ligne detectee qui
# peut etre arabe (portes plus bas) est relue par le modele arabe, et la ligne garde la lecture qui contient de
# l'arabe ET dont la confiance tient : un chiffre reste latin, un mot arabe
# devient arabe. Une seule detection, deux reconnaissances : le cout est celui
# de la seconde reconnaissance, pas d'une seconde lecture.
# Les lignes de la sonde (voir `_relire_en_arabe`).
SONDE_ARABE = int(os.environ.get("OCR_SONDE_ARABE", "4"))

# ============================ SEULES LES LIGNES QUI PEUVENT ÊTRE ARABES SE RELISENT
#
# 3 novembre 2026, facture MyTek (française, 140 lignes) : relire CHAQUE ligne
# en arabe doublait le relevé (4,5 s au lieu de 2,2 s sur la carte graphique)
# pour un résultat identique à l'octet. Deux portes, mesurées :
#
#   - une ligne de chiffres n'est jamais rendue à l'arabe (`_garder_l_arabe`) :
#     la relire ne peut rien changer. Écartée, le relevé est identique ;
#   - le modèle latin, devant un mot arabe, rend du bruit à basse confiance.
#     Banc du 3 novembre 2026 (85 pages fictives — 30 arabes, 15 françaises,
#     40 difficiles — et MyTek ; 2 872 lignes) : les 67 lignes que l'arabe
#     remplace avaient toutes une confiance latine ≤ 0,923. Au seuil de 0,95,
#     4 % des lignes se relisent (12 sur 140 pour MyTek) et AUCUNE ligne arabe
#     n'est perdue ; à 0,90, une l'est.
#
# Le seuil est un réglage d'exploitation, pas une règle métier : 1,01 relit
# toutes les lignes qui ne sont pas des chiffres.
ARABE_SI_CONFIANCE_SOUS = float(os.environ.get("OCR_ARABE_SI_CONFIANCE_SOUS", "0.95"))


def _a_relire_en_arabe(latin: str, score_latin: float) -> bool:
    # Une ligne de chiffres se relit aussi quand le latin doute : depuis le
    # 4 novembre 2026, c'est souvent une ligne MIXTE (« الهاتف : 00 49 600 628 »)
    # dont l'etiquette arabe a ete perdue ; relue mot par mot, elle la retrouve,
    # et ses chiffres restent au latin (`_choisir`).
    return score_latin < ARABE_SI_CONFIANCE_SOUS


def _a_de_l_arabe(texte: str) -> bool:
    return any("\u0600" <= c <= "\u06ff" or "\ufb50" <= c <= "\ufeff" for c in texte)


def _ligne_de_chiffres(latin: str) -> bool:
    """Une ligne surtout faite de chiffres (montants, dates, numeros) : elle
    reste au modele latin, qui les lit mieux. Il y faut au moins un chiffre :
    devant des chiffres arabes orientaux (« ٥٢٢١٫٨٥٠ »), le modele latin ne rend
    que leurs separateurs (« , ») — banc sans IA du 4 novembre 2026, s044 —, et
    une ligne de ponctuation n'est pas une ligne de chiffres."""
    visibles = [c for c in latin if not c.isspace()]
    chiffres = sum(1 for c in visibles if c.isdigit() or c in ",./:-")
    return any(c.isdigit() for c in visibles) and chiffres / len(visibles) >= 0.6


def _garder_l_arabe(latin: str, arabe: str, score_latin: float, score_arabe: float) -> bool:
    """Une ligne de CHIFFRES reste au modele latin, qui les lit mieux ; une
    ligne de mots arabes passe au modele arabe, si sa confiance tient."""
    if not _a_de_l_arabe(arabe):
        return False
    if _ligne_de_chiffres(latin):
        return False
    # Une ligne MIXTE (« المجموع 4 135,183 ») ne bascule que si les deux
    # lectures portent les memes nombres : le modele latin lit mieux les
    # chiffres, et un montant ne se troque pas contre un libelle mieux lu.
    # Le latin qui n'a lu AUCUN chiffre n'a rien a troquer : les nombres de l'arabe
    # (chiffres orientaux) sont les seuls lus.
    if re.findall(r"\d+", latin) and re.findall(r"\d+", latin) != re.findall(r"\d+", arabe):
        return False
    return score_arabe >= score_latin * 0.8


def _redresser(tableau: numpy.ndarray, polygone) -> numpy.ndarray:
    """La ligne, redressee sur son polygone exact : la decoupe des RELECTURES (arabe, mot par
    mot). Ce n'est pas celle du pipeline (`_decouper`, le rectangle minimal du polygone
    arrondi) : mesure du 4 novembre 2026, banc sans IA, relire l'arabe sur la decoupe du
    pipeline change la lecture de lignes arabes et mixtes, et 14 champs justes se taisent
    (dates, matricules, numeros). Le modele arabe a ete mesure sur celle-ci."""
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


# ============================== UNE LIGNE MIXTE SE LIT MOT PAR MOT, CHACUN DANS SON ÉCRITURE
#
# 4 novembre 2026, banc sans IA (412 pieces) : sur une facture arabe, la ligne
# « المعرف الجبائي : 1399012W/A/M/000 » rendait « 99012W///000: » par le modele
# latin (0,63) — l'arabe de l'etiquette le derange — et le modele arabe, lui, ne
# lit pas les lettres latines : « ALGORIA FACTORY SARL : الحريف » devenait
# « LORA OY Lالحريف ». Aucun des deux modeles ne lit une ligne mixte ; choisir
# l'un des deux pour la ligne entiere perd toujours une ecriture. Le matricule
# du dossier n'etait plus lu, et le sens de la piece ne se deduisait plus.
#
# Une ligne dont les deux lectures disent deux ecritures se coupe donc a ses
# blancs (le profil d'encre de la decoupe), et chaque morceau se lit par les
# deux modeles : il garde la lecture de SON ecriture. Les morceaux sortent comme
# des lignes, chacun avec sa boite : un matricule a gauche d'une etiquette arabe
# garde sa place sur la page.

# Un blanc qui separe deux mots : au moins cette fraction de la hauteur de ligne.
BLANC_ENTRE_MOTS = float(os.environ.get("OCR_BLANC_ENTRE_MOTS", "0.2"))
_LATIN = re.compile(r"[A-Za-z0-9]")


def _ligne_mixte(latin: str, arabe: str) -> bool:
    """Les deux lectures disent deux ecritures : l'arabe voit des lettres
    arabes, le latin des lettres ou des chiffres."""
    return _a_de_l_arabe(arabe) and re.search(r"[A-Za-z0-9]{2,}", latin) is not None


def _morceaux(decoupe: numpy.ndarray) -> list:
    """Les intervalles [x0, x1) d'encre d'une ligne redressee, coupes a ses blancs."""
    gris = cv2.cvtColor(decoupe, cv2.COLOR_BGR2GRAY) if decoupe.ndim == 3 else decoupe
    _, encre = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    colonnes = (encre > 0).sum(axis=0)
    hauteur, largeur = encre.shape[:2]
    blanc_min = max(4, int(BLANC_ENTRE_MOTS * hauteur))
    morceaux, debut, vide = [], None, 0
    for x in range(largeur):
        if colonnes[x] > 0:
            if debut is None:
                debut = x
            vide = 0
        elif debut is not None:
            vide += 1
            if vide >= blanc_min:
                morceaux.append((debut, x - vide + 1))
                debut, vide = None, 0
    if debut is not None:
        morceaux.append((debut, largeur - vide))
    return [(a, b) for a, b in morceaux if b - a >= 2]


# Un caractere latin imprime tient environ une demi-hauteur de ligne. Une
# lecture qui, pour sa boite, en rend bien moins a laisse quelque chose de cote
# — l'etiquette arabe d'un matricule (« المعرف الجبائي : 1399012W/A/M/000 » lu
# « 9012W///000: ») : meme une ligne de chiffres se relit alors.
LARGEUR_PAR_CARACTERE_MAX = float(os.environ.get("OCR_LARGEUR_PAR_CARACTERE_MAX", "0.7"))


def _trop_court(texte: str, polygone) -> bool:
    xs = [float(p[0]) for p in polygone]
    ys = [float(p[1]) for p in polygone]
    hauteur = max(1.0, max(ys) - min(ys))
    return (max(xs) - min(xs)) / max(1, len(texte.strip())) > LARGEUR_PAR_CARACTERE_MAX * hauteur


def _choisir(latin: str, s_latin: float, arabe: str, s_arabe: float):
    """La lecture d'un morceau : l'arabe s'il en a et que sa confiance tient,
    sinon le latin."""
    if _a_de_l_arabe(arabe) and not _ligne_de_chiffres(latin) and s_arabe >= s_latin * 0.8:
        return arabe, s_arabe, True
    return latin, s_latin, False


def _relire_en_arabe(lecteur: "_Lecteur", tableau, polygones, textes, scores):
    """Relire en arabe les lignes qui peuvent l'être ; garder l'arabe la ou il
    en a. Une ligne mixte se coupe en morceaux, et chacun garde sa lecture.

    Rend les lignes sous la forme (texte, score, boite_ou_None) : `None` garde
    la boite du polygone de la ligne ; une boite (x0, y0, x1, y1) en pixels est
    celle d'un morceau. Rend aussi si le modèle arabe a servi.

    `polygones`, `textes` et `scores` sont alignes index par index : les lignes
    RECONNUES (`_reconnaitre`).
    """
    n = min(len(polygones), len(textes), len(scores))
    sortie = [[(textes[i], scores[i], None)] for i in range(len(textes))]
    if lecteur.arabe is None or n == 0:
        return sortie, False
    candidates = [
        i for i in range(n)
        if _a_relire_en_arabe(textes[i], float(scores[i])) or _trop_court(textes[i], polygones[i])
    ]
    if not candidates:
        return sortie, False
    decoupes = {i: _redresser(tableau, polygones[i]) for i in candidates}
    # LA SONDE : une page sans arabe ne paie pas la relecture. Les lignes les moins sures sont
    # relues d'abord ; si aucune ne garde l'arabe, aucune autre ne sera relue. Mesure du
    # 4 novembre 2026, facture MyTek (francaise) : 0,9 s de relecture arabe pour rien.
    sonde = sorted(candidates, key=lambda i: float(scores[i]))[:SONDE_ARABE]
    if len(candidates) > len(sonde):
        lus_sonde = [r.json["res"] for r in lecteur.arabe.predict([decoupes[i] for i in sonde], batch_size=LOT)]
        if not any(
            _a_de_l_arabe(r.get("rec_text", ""))
            and float(r.get("rec_score", 0.0)) >= float(scores[i]) * 0.8
            for i, r in zip(sonde, lus_sonde)
        ):
            return sortie, False
    ordre = sorted(candidates, key=lambda i: decoupes[i].shape[1] / max(1, decoupes[i].shape[0]))
    lus = [r.json["res"] for r in lecteur.arabe.predict([decoupes[i] for i in ordre], batch_size=LOT)]
    mixtes = []
    for i, r in zip(ordre, lus):
        texte_ar, score_ar = r.get("rec_text", ""), float(r.get("rec_score", 0.0))
        if _ligne_mixte(textes[i], texte_ar):
            mixtes.append(i)
        elif _garder_l_arabe(textes[i], texte_ar, float(scores[i]), score_ar):
            sortie[i] = [(texte_ar, score_ar, None)]
    if mixtes:
        _lire_mot_par_mot(lecteur, polygones, decoupes, mixtes, sortie)
    return sortie, True


def _lire_en_latin(lecteur: "_Lecteur", images: list) -> tuple:
    """La lecture latine de chaque image, dans l'ordre, et les probabilites de ses
    caracteres (`_Caracteres`)."""
    lecteur.caracteres.lues = []
    lus = [r.json["res"] for r in lecteur.latin.predict(images, batch_size=LOT)]
    probabilites = lecteur.caracteres.lues
    if len(probabilites) != len(lus):
        probabilites = [None] * len(lus)
    return lus, probabilites


def _lire_mot_par_mot(lecteur: "_Lecteur", polygones, decoupes, mixtes, sortie):
    """Chaque ligne mixte, coupee a ses blancs, lue morceau par morceau par les
    deux modeles. Une ligne qu'on ne sait pas couper (un seul morceau) garde sa
    lecture latine : on ne troque pas des lettres latines contre de l'arabe."""
    taches = []  # (ligne, x0, x1, image du morceau)
    for i in mixtes:
        d = decoupes[i]
        morceaux = _morceaux(d)
        if len(morceaux) < 2:
            continue
        for a, b in morceaux:
            taches.append((i, a, b, d[:, max(0, a - 2):min(d.shape[1], b + 2)]))
    if not taches:
        return
    images = [t[3] for t in taches]
    lat, probabilites = _lire_en_latin(lecteur, images)
    ara = [r.json["res"] for r in lecteur.arabe.predict(images, batch_size=LOT)]
    par_ligne: dict = {}
    for (i, a, b, img), rl, ra, pl in zip(taches, lat, ara, probabilites):
        texte, score, arabe = _choisir(
            rl.get("rec_text", ""), float(rl.get("rec_score", 0.0)),
            ra.get("rec_text", ""), float(ra.get("rec_score", 0.0)),
        )
        if texte.strip():
            # les probabilites des caracteres, quand le morceau garde sa lecture latine
            latine = not arabe and texte == rl.get("rec_text", "") and pl is not None and len(pl) == len(texte)
            par_ligne.setdefault(i, []).append([a, b, texte, score, arabe, pl if latine else None])
    # Les morceaux voisins d'une meme ecriture se rejoignent et se relisent
    # ensemble : un RIB coupe a ses blancs (« 99 | 684 | 592007571 | 5690 ») se
    # relit d'un trait, dans son ordre a lui, et le modele voit le contexte.
    groupes = []  # (ligne, x0, x1, arabe)
    for i, morceaux in par_ligne.items():
        morceaux.sort(key=lambda m: m[0])
        courant = None
        for m in morceaux:
            if courant is not None and courant[3] == m[4]:
                courant[2] = m[1]
                courant[4].append(m)
            else:
                courant = [i, m[0], m[1], m[4], [m]]
                groupes.append(courant)
    a_relire = [g for g in groupes if len(g[4]) > 1]
    if a_relire:
        crops = [decoupes[g[0]][:, max(0, g[1] - 2):min(decoupes[g[0]].shape[1], g[2] + 2)] for g in a_relire]
        latins = [g for g, c in zip(a_relire, crops) if not g[3]]
        arabes = [g for g, c in zip(a_relire, crops) if g[3]]
        for latin, lot in ((True, latins), (False, arabes)):
            if not lot:
                continue
            images = [crops[a_relire.index(g)] for g in lot]
            if latin:
                lus, probabilites = _lire_en_latin(lecteur, images)
            else:
                lus = [r.json["res"] for r in lecteur.arabe.predict(images, batch_size=LOT)]
                probabilites = [None] * len(lus)
            for g, r, pl in zip(lot, lus, probabilites):
                texte = r.get("rec_text", "")
                if texte.strip():
                    pl = pl if pl is not None and len(pl) == len(texte) else None
                    g[4] = [[g[1], g[2], texte, float(r.get("rec_score", 0.0)), g[3], pl]]
    for i in par_ligne:
        xs = [float(p[0]) for p in polygones[i]]
        ys = [float(p[1]) for p in polygones[i]]
        gauche, haut, bas = min(xs), min(ys), max(ys)
        echelle = (max(xs) - gauche) / max(1, decoupes[i].shape[1])
        siens = [g for g in groupes if g[0] == i]
        # L'ordre de lecture : les groupes de droite a gauche quand l'un est
        # arabe ; a l'interieur d'un groupe latin, de gauche a droite.
        if any(g[3] for g in siens):
            siens.sort(key=lambda g: -g[1])
        sortie[i] = [
            (t, s, (gauche + a * echelle, haut, gauche + b * echelle, bas), pl)
            for g in siens
            for a, b, t, s, _, pl in g[4]
        ]


# ============================================================== LES LECTEURS
#
# Un predicteur n'est pas sur a plusieurs fils : un LECTEUR (ses trois modeles) fait une
# lecture a la fois, HORS de la boucle d'evenements. Avant, `predict` tournait dans la
# boucle elle-meme : pendant une lecture de trente secondes, le controle de sante ne
# repondait plus et le conteneur passait « unhealthy » (audit du 24 octobre 2026).
#
# `OCR_LECTEURS` lecteurs lisent en meme temps, chacun sur `OMP_NUM_THREADS` fils : le
# produit est le nombre de coeurs que le service occupe. Mesure du 4 novembre 2026 : sur
# deux coeurs, la reconnaissance est liee au calcul (voir `LOT`) — un lecteur a deux fils ;
# une machine a quatre coeurs en porte deux, et l'API lit alors deux pages a la fois (elle
# lit `lecteurs` sur `/sante`). La memoire croit d'un jeu de modeles par lecteur.
class _Caracteres:
    """Le decodeur CTC de la reconnaissance latine, qui garde aussi la probabilite de CHAQUE
    caractere lu, decoupe apres decoupe, dans l'ordre ou elles sont reconnues (`lues` : le
    predicteur decode tous ses lots avant de rendre la premiere). Le score d'une ligne en est la moyenne : un mot
    sous une tache (« sans fil » lu « sans fi », le i a 0,50) s'y noie a 0,96 (banc sans IA
    du 4 novembre 2026, algoria-032). Le texte rendu est celui du decodeur, inchange."""

    def __init__(self, decodeur) -> None:
        self.decodeur = decodeur
        self.lues: list = []

    def __call__(self, pred, *args, **kwargs):
        probabilites = numpy.array(pred[0])
        indices = probabilites.argmax(axis=-1)
        maxima = probabilites.max(axis=-1)
        ignores = set(self.decodeur.get_ignored_tokens())
        for b in range(len(indices)):
            garde = numpy.ones(len(indices[b]), dtype=bool)
            garde[1:] = indices[b][1:] != indices[b][:-1]
            for k in ignores:
                garde &= indices[b] != k
            self.lues.append([round(float(p), 3) for p in maxima[b][garde]])
        return self.decodeur(pred, *args, **kwargs)


class _Lecteur:
    """Les modeles d'une lecture : detection, reconnaissance latine, arabe s'il est pose."""

    def __init__(self) -> None:
        self.detection = TextDetection(model_name=DETECTION, model_dir=_dossier(DETECTION), **_COMMUN)
        self.latin = TextRecognition(model_name=RECONNAISSANCE, model_dir=_dossier(RECONNAISSANCE), **_COMMUN)
        predicteur = self.latin.paddlex_predictor
        self.caracteres = _Caracteres(predicteur.post_op)
        predicteur.post_op = self.caracteres
        self.arabe = (
            TextRecognition(model_name=RECONNAISSANCE_ARABE, model_dir=_dossier(RECONNAISSANCE_ARABE), **_COMMUN)
            if RECONNAISSANCE_ARABE
            else None
        )


LECTEURS = int(os.environ.get("OCR_LECTEURS", "1"))
if LECTEURS < 1:
    raise SystemExit(f"OCR_LECTEURS doit valoir au moins 1 : {LECTEURS}")
_libres: queue.Queue = queue.Queue()
for _ in range(LECTEURS):
    _libres.put(_Lecteur())

# Et l'attente d'un lecteur libre est BORNEE (revue du 24 octobre 2026). L'API
# renonce a 120 s ; une requete qui attendrait plus longtemps serait lue pour
# rien, et pousserait les suivantes en delai. Au-dela, « occupe » : l'API bascule
# tout de suite sur le modele de vision. Une lecture deja commencee, elle, ne
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
        "moteur": MOTEUR,
        "modele": MODELE,
        "detection": DETECTION,
        "reconnaissance": RECONNAISSANCE,
        "reconnaissance_arabe": RECONNAISSANCE_ARABE or None,
        # Les lectures que le service mene en meme temps : l'API y borne ses pages.
        "lecteurs": LECTEURS,
        "appareil": APPAREIL,
        # Les empreintes vérifiées au démarrage : ce qui tourne se compare à
        # `poids.json` sans entrer dans le conteneur.
        "empreintes": EMPREINTES,
    }


@app.post("/lire")
async def lire(requete: Request) -> StreamingResponse:
    """Une image en corps brut ; ses lignes et leurs boîtes normalisées, en DEUX temps — une
    ligne JSON par temps (`_vagues`) : le tableau d'abord, la page entière ensuite. Le second
    temps est la lecture complète."""
    return StreamingResponse(_en_flux(await requete.body()), media_type="application/x-ndjson")


# LA RELECTURE D'UNE CELLULE, SEULE (4 novembre 2026). Lue dans sa ligne, une cellule
# partage la decoupe de ses voisines : « 73.950 » lu « 71.950 », « 1 » lu « T ». Lue seule,
# dans sa boite elargie d'une marge, elle se lit juste : mesure sur algoria-028, les deux
# cellules relues justes (0,94 et 0,99). L'API ne relit que les cellules que l'arithmetique
# de la piece contredit ; la preuve, elle, reste l'arithmetique.
RELECTURE_MARGE = float(os.environ.get("OCR_RELECTURE_MARGE", "0.15"))  # en hauteurs de cellule


def _relire(lecteur: "_Lecteur", octets: bytes, boites: list) -> list:
    tableau, largeur, hauteur = _image(octets)
    decoupes = []
    for x0, y0, x1, y1 in boites:
        h = (y1 - y0) * hauteur
        marge = RELECTURE_MARGE * h
        decoupes.append(tableau[
            int(max(0, y0 * hauteur - marge)):int(min(hauteur, y1 * hauteur + marge)),
            int(max(0, x0 * largeur - marge)):int(min(largeur, x1 * largeur + marge)),
        ])
    valides = [i for i, d in enumerate(decoupes) if d.size > 0]
    lus = [("", 0.0)] * len(decoupes)
    for i, l in zip(valides, _reconnaitre(lecteur, [decoupes[i] for i in valides])):
        lus[i] = l[:2]
    return [{"texte": t, "confiance": c} for t, c in lus]


@app.post("/relire")
async def relire(requete: Request) -> dict:
    """`{"image": base64, "boites": [[x0, y0, x1, y1], ...]}` (boites normalisees) : la
    lecture latine de chaque boite, seule, dans l'ordre (`{"lectures": [{texte, confiance}]}`).
    Un lecteur occupe le dit (`{"occupe": true}`)."""
    corps = json.loads(await requete.body())
    try:
        lecteur = await run_in_threadpool(_libres.get, True, ATTENTE_MAX_S)
    except queue.Empty:
        return {"occupe": True}
    try:
        octets = base64.b64decode(corps["image"])
        return {"lectures": await run_in_threadpool(_relire, lecteur, octets, corps["boites"])}
    finally:
        _libres.put(lecteur)


async def _en_flux(octets: bytes):
    """Les deux temps de `_vagues`, une ligne JSON chacun, hors de la boucle d'evenements.

    Le statut HTTP part avant le premier temps : un lecteur occupe le dit DANS le flux
    (`{"occupe": true}`), et l'API bascule sur l'autre lecteur. Le verrou n'est rendu qu'une fois le fil de calcul revenu — une
    attente sur un fil ne s'annule pas avant lui (anyio) : deux lectures ne se recouvrent
    jamais sur un lecteur, meme si le client part en cours de route."""
    try:
        lecteur = await run_in_threadpool(_libres.get, True, ATTENTE_MAX_S)
    except queue.Empty:
        yield json.dumps({"occupe": True}) + "\n"
        return
    try:
        vagues = _vagues(lecteur, octets)
        while (temps := await run_in_threadpool(next, vagues, None)) is not None:
            yield json.dumps(temps, ensure_ascii=False) + "\n"
    finally:
        _libres.put(lecteur)


# ================================================ LA LECTURE PAR VAGUES (4 novembre 2026)
#
# La detection (la geometrie : les boites des lignes) coute 0,3 a 0,5 s par page ; la
# RECONNAISSANCE fait le temps. Le tableau est ce que la preuve lit d'abord : les rangees de
# `VAGUE_RANG_DE_TABLEAU` boites ou plus, du premier au dernier rang, et hors tableau les
# boites COURTES (etiquettes, montants, identifiants). Elles sont reconnues en premier, et
# rendues aussitot (premier temps) : l'API prouve les totaux et les articles pendant que le
# reste de la page se lit. Le second temps rend TOUTES les lignes, relues en arabe la ou il
# le faut : c'est la lecture complete, a l'octet pres, dans l'ordre du pipeline. Aucune ligne
# n'est jamais sautee — mesure du 4 novembre 2026 : sauter le reste quand les totaux se
# prouvent perdait 243 champs justes (matricules, montant en lettres, mode de reglement).
#
VAGUE_RANG_DE_TABLEAU = int(os.environ.get("OCR_VAGUE_RANG_DE_TABLEAU", "4"))
VAGUE_LARGEUR_COURTE = float(os.environ.get("OCR_VAGUE_LARGEUR_COURTE", "0.35"))

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


def _image(octets: bytes):
    """L'image en tableau BVR (Paddle attend du BVR), bornee a `COTE_MAX`.

    L'orientation que le telephone a notee dans la photo est appliquee : sans elle, une
    photo prise en portrait par un appareil qui enregistre en paysage arrive couchee, et
    chaque ligne se lit de travers. L'image passe EN MEMOIRE, jamais par un fichier : un
    chemin fixe, deux requetes simultanees l'ecraseraient l'une l'autre.

    Le tableau est rendu CONTIGU. Le retournement RVB → BVR n'est qu'une vue (pas negatif) :
    OpenCV la recopiait, image entiere, a CHAQUE decoupe de ligne. Mesure du 4 novembre
    2026, MyTek, 140 lignes, deux processeurs : decoupe 1,2 s → 0,02 s, detection 1,3 s →
    0,9 s ; decoupes et polygones identiques au pixel."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(octets))).convert("RGB")
    if max(image.size) > COTE_MAX:
        f = COTE_MAX / max(image.size)
        image = image.resize((max(1, round(image.width * f)), max(1, round(image.height * f))), Image.LANCZOS)
    return numpy.ascontiguousarray(numpy.asarray(image)[:, :, ::-1]), image.width, image.height


def _boite(polygone, largeur: int, hauteur: int) -> list:
    """La boite alignee sur les axes qui englobe le polygone, normalisee de 0 a 1 : c'est ce
    dont la designation a besoin pour raisonner en lignes et en colonnes."""
    xs = [float(p[0]) for p in polygone]
    ys = [float(p[1]) for p in polygone]
    return [
        max(0.0, min(1.0, v))
        for v in (min(xs) / largeur, min(ys) / hauteur, max(xs) / largeur, max(ys) / hauteur)
    ]


# LE CACHET, sans modele : une empreinte d'encre de COULEUR (bleue, violette, rouge),
# compacte (ni trait, ni ligne de texte) et creuse (un anneau, un cadre : peu d'encre pour
# sa boite). Mesure du 4 novembre 2026 sur les 161 pieces du jeu d'ALGORIA (rendus du
# depot, 80 points par pouce) : 41 cachets trouves sur 81, AUCUN sur les 80 pieces sans
# cachet. Une photocopie (le cachet devenu gris) n'est pas vue : rien n'est rendu plutot
# qu'un faux.
CACHET_SATURATION_MIN = int(os.environ.get("OCR_CACHET_SATURATION_MIN", "70"))
CACHET_TAILLE = (0.07, 0.40)  # le plus grand cote, en fraction de la largeur de la page
CACHET_ALLONGEMENT = (0.55, 1.8)  # largeur / hauteur
CACHET_REMPLISSAGE_MAX = 0.45  # encre / boite


def _cachets(tableau: numpy.ndarray) -> list:
    """Les cachets d'encre de couleur de la page, en boites normalisees de 0 a 1."""
    hauteur, largeur = tableau.shape[:2]
    hsv = cv2.cvtColor(tableau, cv2.COLOR_BGR2HSV)
    encre = ((hsv[:, :, 1] > CACHET_SATURATION_MIN) & (hsv[:, :, 2] > 40) & (hsv[:, :, 2] < 235)).astype(numpy.uint8) * 255
    noyau = max(3, int(largeur * 0.006))
    encre = cv2.morphologyEx(encre, cv2.MORPH_CLOSE, numpy.ones((noyau, noyau), numpy.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(encre, 8)
    marques = []
    for c in range(1, n):
        x, y, w, h, aire = (int(v) for v in stats[c])
        cote = max(w, h) / largeur
        if not CACHET_TAILLE[0] <= cote <= CACHET_TAILLE[1]:
            continue
        if not CACHET_ALLONGEMENT[0] <= w / max(h, 1) <= CACHET_ALLONGEMENT[1]:
            continue
        if aire / (w * h) > CACHET_REMPLISSAGE_MAX:
            continue
        marques.append({"type": "cachet", "boite": [x / largeur, y / hauteur, (x + w) / largeur, (y + h) / hauteur]})
    return marques


def _premiere_vague(boites: list) -> list:
    """Les index des boites du premier temps : le tableau, et les boites courtes."""
    rangees: list = []
    for i in sorted(range(len(boites)), key=lambda k: boites[k][1]):
        b = boites[i]
        for r in rangees:
            a = boites[r[0]]
            h = min(a[3] - a[1], b[3] - b[1])
            if min(a[3], b[3]) - max(a[1], b[1]) > 0.5 * h:
                r.append(i)
                break
        else:
            rangees.append([i])
    du_tableau = [r for r in rangees if len(r) >= VAGUE_RANG_DE_TABLEAU]
    haut = min((boites[r[0]][1] for r in du_tableau), default=1.0)
    bas = max((max(boites[i][3] for i in r) for r in du_tableau), default=0.0)
    return [
        i for i, b in enumerate(boites)
        if (b[1] >= haut - 0.005 and b[3] <= bas + 0.005) or b[2] - b[0] <= VAGUE_LARGEUR_COURTE
    ]


def _reconnaitre(lecteur: "_Lecteur", decoupes: list) -> list:
    """La lecture latine de chaque decoupe : (texte, score, probabilites de ses caracteres
    ou None). Triees par largeur avant d'etre reconnues, comme le fait le pipeline (un lot
    de meme gabarit se rembourre peu). Les probabilites d'une decoupe sont celles de son lot
    (`_Caracteres`), dans le meme ordre ; elles ne valent que si elles comptent un nombre
    par caractere du texte."""
    ordre = sorted(range(len(decoupes)), key=lambda i: decoupes[i].shape[1] / float(decoupes[i].shape[0]))
    lus: list = [None] * len(decoupes)
    lecteur.caracteres.lues = []
    for n, (i, r) in enumerate(zip(ordre, lecteur.latin.predict([decoupes[i] for i in ordre], batch_size=LOT))):
        res = r.json["res"]  # une copie profonde a chaque lecture de `json` : une seule
        texte = res.get("rec_text", "")
        lues = lecteur.caracteres.lues
        probabilites = lues[n] if n < len(lues) else None
        if probabilites is not None and len(probabilites) != len(texte):
            probabilites = None
        lus[i] = (texte, float(res.get("rec_score", 0.0)), probabilites)
    return lus


def _vagues(lecteur: "_Lecteur", octets: bytes):
    """La lecture d'une page, en deux temps (voir plus haut). Chaque temps rend un dict
    `{"vague", "lignes", "modele", "millisecondes"}` ; le second est la lecture complete."""
    debut = time.time()
    tableau, largeur, hauteur = _image(octets)
    detectes = lecteur.detection.predict(tableau, **_DETECTER_AVEC)[0].json["res"]["dt_polys"]
    polygones = list(_trier(detectes)) if len(detectes) else []
    # La decoupe de chaque ligne ; une decoupe vide n'est pas une ligne (comme le pipeline).
    decoupes = list(_decouper(tableau, polygones)) if polygones else []
    gardes = [i for i, d in enumerate(decoupes) if d.size > 0 and d.shape[0] > 0 and d.shape[1] > 0]
    polygones = [polygones[i] for i in gardes]
    decoupes = [decoupes[i] for i in gardes]
    boites = [_boite(p, largeur, hauteur) for p in polygones]

    def temps(vague: int, lues: list, morceaux_par_ligne: list, arabe: bool, marques: list | None = None) -> dict:
        lignes = []
        for i in lues:
            for morceau in morceaux_par_ligne[i]:
                texte, score, pixels = morceau[:3]
                if not texte or not texte.strip():
                    continue
                boite = boites[i] if pixels is None else _boite(
                    ((pixels[0], pixels[1]), (pixels[2], pixels[3])), largeur, hauteur)
                # les probabilites des caracteres, quand le morceau est la lecture latine de
                # toute la ligne (une relecture arabe ou un morceau n'en a pas)
                # (un morceau relu en latin porte les siennes)
                if len(morceau) > 3:
                    probabilites = morceau[3]
                else:
                    latine = lus[i] if pixels is None and lus[i] is not None and lus[i][0] == texte else None
                    probabilites = latine[2] if latine else None
                lignes.append({
                    "texte": texte,
                    "boite": boite,
                    "confiance": float(score) if score is not None else None,
                    **({"caracteres": probabilites} if probabilites is not None else {}),
                })
        return {
            "vague": vague,
            "lignes": lignes,
            **({"marques": marques} if marques is not None else {}),
            "modele": MODELE if arabe else MODELE_LATIN,
            "millisecondes": int((time.time() - debut) * 1000),
        }

    premiere = _premiere_vague(boites)
    lus: list = [None] * len(decoupes)
    for i, l in zip(premiere, _reconnaitre(lecteur, [decoupes[i] for i in premiere])):
        lus[i] = l
    # Le premier temps : la lecture latine du tableau et des boites courtes, sans relecture
    # arabe (un montant ne passe jamais a l'arabe, `_garder_l_arabe`).
    retenues = lambda ids: [i for i in ids if lus[i] is not None and lus[i][1] >= _SEUIL_DE_RECONNAISSANCE]
    yield temps(1, retenues(premiere), [[(l[0], l[1], None)] if l else [] for l in lus], False)

    reste = [i for i in range(len(decoupes)) if lus[i] is None]
    for i, l in zip(reste, _reconnaitre(lecteur, [decoupes[i] for i in reste])):
        lus[i] = l
    # Le second temps : toutes les lignes, dans l'ordre du pipeline, relues en arabe la ou
    # il le faut — la lecture complete.
    toutes = retenues(range(len(decoupes)))
    morceaux, arabe = _relire_en_arabe(
        lecteur,
        tableau,
        [polygones[i] for i in toutes],
        [lus[i][0] for i in toutes],
        [lus[i][1] for i in toutes],
    )
    par_ligne: list = [[] for _ in decoupes]
    for k, i in enumerate(toutes):
        par_ligne[i] = morceaux[k]
    # Le second temps porte aussi les MARQUES de la page (les cachets), vues sans modele.
    yield temps(2, toutes, par_ligne, arabe, _cachets(tableau))
