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
en coordonnées NORMALISÉES — de 0 à 1 dans la page. C'est ce que le plan de
jetons attend ; convertir des pixels côté Node demanderait de lui faire
connaître la taille de l'image, qu'il n'a pas.
"""

import io
import os
import re
import threading
import time
from pathlib import Path

import numpy
from PIL import Image, ImageOps

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import cv2  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from paddleocr import PaddleOCR, TextRecognition  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

import poids  # noqa: E402

# ============================================================= LE MOTEUR
#
# `onnx` (défaut) : les poids PP-OCRv5 convertis en ONNX, exécutés par
# onnxruntime À TRAVERS le pipeline de PaddleOCR (`engine="onnxruntime"`) —
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


_ocr = PaddleOCR(
    text_detection_model_name=DETECTION,
    text_detection_model_dir=_dossier(DETECTION),
    text_recognition_model_name=RECONNAISSANCE,
    text_recognition_model_dir=_dossier(RECONNAISSANCE),
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    **_COMMUN,
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
# Quand `OCR_MODELE_RECONNAISSANCE_ARABE` est posee, chaque ligne detectee qui
# peut etre arabe (portes plus bas) est relue par le modele arabe, et la ligne garde la lecture qui contient de
# l'arabe ET dont la confiance tient : un chiffre reste latin, un mot arabe
# devient arabe. Une seule detection, deux reconnaissances : le cout est celui
# de la seconde reconnaissance, pas d'une seconde lecture.
_arabe = (
    TextRecognition(model_name=RECONNAISSANCE_ARABE, model_dir=_dossier(RECONNAISSANCE_ARABE), **_COMMUN)
    if RECONNAISSANCE_ARABE
    else None
)
# Le modele latin, seul, pour relire les morceaux d'une ligne mixte (plus bas) :
# le meme modele que celui du pipeline, sans sa detection. Il n'existe qu'avec
# le second alphabet : sans lui, aucune ligne n'est jamais dite mixte.
_ocr_latin_seul = (
    TextRecognition(model_name=RECONNAISSANCE, model_dir=_dossier(RECONNAISSANCE), **_COMMUN)
    if RECONNAISSANCE_ARABE
    else None
)
# Les lignes relues par lots, triées par largeur comme le fait le pipeline :
# un lot de lignes de même gabarit se rembourre peu. Mesuré sur trois pages :
# mêmes textes qu'une à une.
LOT_ARABE = 6

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
    reste au modele latin, qui les lit mieux."""
    visibles = [c for c in latin if not c.isspace()]
    chiffres = sum(1 for c in visibles if c.isdigit() or c in ",./:-")
    return bool(visibles) and chiffres / len(visibles) >= 0.6


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


def _relire_en_arabe(tableau, polygones, textes, scores):
    """Relire en arabe les lignes qui peuvent l'être ; garder l'arabe la ou il
    en a. Une ligne mixte se coupe en morceaux, et chacun garde sa lecture.

    Rend les lignes sous la forme (texte, score, boite_ou_None) : `None` garde
    la boite du polygone de la ligne ; une boite (x0, y0, x1, y1) en pixels est
    celle d'un morceau. Rend aussi si le modèle arabe a servi.

    Seulement sur `rec_polys` — les polygones des lignes RECONNUES, alignes
    index par index sur `rec_texts` et `rec_scores`. Jamais sur `dt_polys`,
    qui ne leur correspond pas.
    """
    n = min(len(polygones), len(textes), len(scores))
    sortie = [[(textes[i], scores[i], None)] for i in range(len(textes))]
    if _arabe is None or n == 0:
        return sortie, False
    candidates = [
        i for i in range(n)
        if _a_relire_en_arabe(textes[i], float(scores[i])) or _trop_court(textes[i], polygones[i])
    ]
    if not candidates:
        return sortie, False
    decoupes = {i: _decouper(tableau, polygones[i]) for i in candidates}
    ordre = sorted(candidates, key=lambda i: decoupes[i].shape[1] / max(1, decoupes[i].shape[0]))
    lus = [r.json["res"] for r in _arabe.predict([decoupes[i] for i in ordre], batch_size=LOT_ARABE)]
    mixtes = []
    for i, r in zip(ordre, lus):
        texte_ar, score_ar = r.get("rec_text", ""), float(r.get("rec_score", 0.0))
        if _ligne_mixte(textes[i], texte_ar):
            mixtes.append(i)
        elif _garder_l_arabe(textes[i], texte_ar, float(scores[i]), score_ar):
            sortie[i] = [(texte_ar, score_ar, None)]
    if mixtes:
        _lire_mot_par_mot(tableau, polygones, decoupes, mixtes, textes, scores, sortie)
    return sortie, True


def _lire_mot_par_mot(tableau, polygones, decoupes, mixtes, textes, scores, sortie):
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
    lat = [r.json["res"] for r in _ocr_latin_seul.predict(images, batch_size=LOT_ARABE)]
    ara = [r.json["res"] for r in _arabe.predict(images, batch_size=LOT_ARABE)]
    par_ligne: dict = {}
    for (i, a, b, img), rl, ra in zip(taches, lat, ara):
        texte, score, arabe = _choisir(
            rl.get("rec_text", ""), float(rl.get("rec_score", 0.0)),
            ra.get("rec_text", ""), float(ra.get("rec_score", 0.0)),
        )
        if texte.strip():
            par_ligne.setdefault(i, []).append([a, b, texte, score, arabe])
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
        for modele, lot in ((_ocr_latin_seul, latins), (_arabe, arabes)):
            if not lot:
                continue
            images = [crops[a_relire.index(g)] for g in lot]
            for g, r in zip(lot, (r.json["res"] for r in modele.predict(images, batch_size=LOT_ARABE))):
                texte = r.get("rec_text", "")
                if texte.strip():
                    g[4] = [[g[1], g[2], texte, float(r.get("rec_score", 0.0)), g[3]]]
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
            (t, s, (gauche + a * echelle, haut, gauche + b * echelle, bas))
            for g in siens
            for a, b, t, s, _ in g[4]
        ]


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
        "moteur": MOTEUR,
        "modele": MODELE,
        "detection": DETECTION,
        "reconnaissance": RECONNAISSANCE,
        "reconnaissance_arabe": RECONNAISSANCE_ARABE or None,
        "appareil": APPAREIL,
        # Les empreintes vérifiées au démarrage : ce qui tourne se compare à
        # `poids.json` sans entrer dans le conteneur.
        "empreintes": EMPREINTES,
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
    arabe_lu = False
    for resultat in _ocr.predict(tableau):
        donnees = resultat.json["res"] if hasattr(resultat, "json") else resultat
        textes = donnees.get("rec_texts", [])
        polygones = donnees.get("rec_polys", []) or donnees.get("dt_polys", [])
        scores = donnees.get("rec_scores", [])
        lues, relu = _relire_en_arabe(tableau, donnees.get("rec_polys", []), textes, scores)
        arabe_lu = arabe_lu or relu
        for i, morceaux in enumerate(lues):
            for texte, score, pixels in morceaux:
                if not texte or not texte.strip():
                    continue
                # Le polygone a quatre points et peut être incliné : on rend la
                # boîte alignée sur les axes qui l'englobe. C'est ce dont la
                # désignation a besoin pour raisonner en lignes et en colonnes.
                boite = [0.0, 0.0, 1.0, 1.0]
                if pixels is not None:
                    x0, y0, x1, y1 = pixels
                elif i < len(polygones) and polygones[i] is not None:
                    xs = [float(p[0]) for p in polygones[i]]
                    ys = [float(p[1]) for p in polygones[i]]
                    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
                else:
                    x0 = None
                if x0 is not None:
                    boite = [
                        max(0.0, min(1.0, x0 / largeur)),
                        max(0.0, min(1.0, y0 / hauteur)),
                        max(0.0, min(1.0, x1 / largeur)),
                        max(0.0, min(1.0, y1 / hauteur)),
                    ]
                lignes.append(
                    {
                        "texte": texte,
                        "boite": boite,
                        "confiance": float(score) if score is not None else None,
                    }
                )

    return {
        "lignes": lignes,
        "millisecondes": int((time.time() - debut) * 1000),
        "modele": MODELE if arabe_lu else MODELE_LATIN,
    }
