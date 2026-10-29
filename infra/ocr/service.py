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


# ================================================== LES LIGNES MIXTES, MORCELEES
#
# Mesure du 29 octobre 2026 (banc de 30 factures arabes fictives, carte
# graphique) : 67,8 % des champs, ZERO facture parfaite. La cause est une
# seule : la ligne tunisienne type, « المجموع باعتبار الأداء : 3 750,000 »,
# melange les deux ecritures. Lue d'un tenant, aucun modele ne la lit :
#
#   - le latin efface l'arabe ET mange les chiffres voisins — « 3 750,000 »
#     devient « 50,000 », « F-2026-2815 » devient « -0-815 » ;
#   - l'arabe lit le libelle et ecorche les nombres.
#
# Et `_garder_l_arabe` a raison de refuser de troquer un montant contre un
# libelle : il n'y avait pas de bon choix A L'ECHELLE DE LA LIGNE. Il y en a
# un a l'echelle du MOT. La ligne est donc coupee aux blancs, chaque morceau
# lu par les deux modeles, chaque morceau garde dans son ecriture ; les
# morceaux voisins de meme ecriture sont recolles et relus d'un tenant —
# « 3 750,000 » reste un seul nombre — et chaque groupe sort comme une ligne
# avec SA boite. La designation gagne au passage des positions exactes, la ou
# `decouperEnMots` les estimait au prorata des caracteres.
#
# Une ligne entierement arabe ou entierement latine ne passe pas ici.

# Le blanc qui separe deux mots, en fraction de la hauteur de ligne. Ne pas
# couper entre un mot arabe et un nombre fait perdre l'un des deux ; couper
# trop fin coute une lecture par morceau sur processeur. Mesure du 29 octobre
# 2026 : 0,12 et 0,22 donnent la meme justesse (93,3 %), 0,22 lit une facture
# arabe en 19,5 s au lieu de 21,6 s (processeur, deux fils). Un morceau qui
# melange encore les deux ecritures est recoupe a la moitie de ce seuil.
BLANC_MIN = float(os.environ.get("OCR_BLANC_MIN", "0.22"))

# Combien de decoupes passent ensemble dans un modele de reconnaissance.
LOT = int(os.environ.get("OCR_LOT", "16"))

# Le modele latin seul, pour relire un groupe : le meme que celui du pipeline.
_latin = (
    TextRecognition(model_name=RECONNAISSANCE, device=APPAREIL, enable_mkldnn=False)
    if RECONNAISSANCE_ARABE
    else None
)


def _morceaux(ligne: numpy.ndarray, seuil: float) -> list:
    """Les colonnes [debut, fin) de chaque morceau d'encre, coupees aux blancs
    d'au moins `seuil` fois la hauteur de ligne."""
    gris = cv2.cvtColor(ligne, cv2.COLOR_BGR2GRAY) if ligne.ndim == 3 else ligne
    _, encre = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = encre.shape
    pleine = (encre > 0).sum(axis=0) > max(1, h // 25)
    blanc_min = max(1, int(h * seuil))
    morceaux, debut, fin, vide = [], None, 0, 0
    for x in range(w):
        if pleine[x]:
            if debut is None:
                debut = x
            fin, vide = x + 1, 0
        elif debut is not None:
            vide += 1
            if vide >= blanc_min:
                morceaux.append([debut, fin])
                debut = None
    if debut is not None:
        morceaux.append([debut, fin])
    # Un point, une virgule, un signe diacritique : quelques pixels qu'aucun
    # modele ne lit seuls, et qui coutent chacun une lecture entiere sur
    # processeur (~0,12 s). Ils rejoignent leur voisin le plus proche.
    i = 0
    while len(morceaux) > 1 and i < len(morceaux):
        a, b = morceaux[i]
        if b - a >= 0.25 * h:
            i += 1
            continue
        gauche = a - morceaux[i - 1][1] if i > 0 else None
        droite = morceaux[i + 1][0] - b if i + 1 < len(morceaux) else None
        if droite is None or (gauche is not None and gauche <= droite):
            morceaux[i - 1][1] = b
        else:
            morceaux[i + 1][0] = a
        del morceaux[i]
    return morceaux


def _ecriture(arabe: str) -> tuple:
    """L'ecriture d'UN morceau, et s'il melange encore les deux.

    Jugee sur la seule lecture du modele ARABE, qui lit aussi les chiffres et
    les lettres latines : un second modele doublerait le cout sur processeur.
    « Melange » : un chiffre ET une lettre arabe — c'est « المعرف : 1 »,
    colles par un blanc trop etroit, qu'il faut recouper.
    """
    visibles = [c for c in arabe if not c.isspace()]
    if not visibles:
        return "latin", False
    chiffres = sum(c.isdigit() for c in visibles)
    lettres_arabes = sum(_a_de_l_arabe(c) for c in visibles)
    melange = chiffres >= 1 and lettres_arabes >= 1
    if not lettres_arabes:
        return "latin", False
    # Un nombre avec une lettre arabe egaree : il reste un nombre.
    if chiffres and sum(c.isdigit() or c in ",./:-%" for c in visibles) / len(visibles) >= 0.6:
        return "latin", melange
    return "arabe", melange


def _lire_lot(modele, decoupes: list) -> list:
    """Toutes les decoupes en un appel, par paquets tries : (texte, score).

    Mesure du 29 octobre 2026, processeur, deux fils : lus un par un, les
    morceaux portaient une facture arabe de 8,7 s a 42 s.
    """
    if not decoupes:
        return []
    # Triees par allongement, comme le fait le pipeline : un paquet se
    # complete jusqu'a sa decoupe la plus longue, et melanger un « 8 » a une
    # ligne entiere ferait calculer du blanc.
    ordre = sorted(range(len(decoupes)), key=lambda i: decoupes[i].shape[1] / max(1, decoupes[i].shape[0]))
    lus = modele.predict([decoupes[i] for i in ordre], batch_size=LOT)
    sortie = [None] * len(decoupes)
    for i, r in zip(ordre, lus):
        sortie[i] = (r.json["res"].get("rec_text", ""), float(r.json["res"].get("rec_score", 0.0)))
    return sortie


def _classer(morceaux: list) -> list:
    """(ecriture, melange, lettre arabe vue, lecture arabe) par morceau.

    `morceaux` : des decoupes d'image, de toutes les lignes de la page a la fois.
    """
    return [_ecriture(a[0]) + (_a_de_l_arabe(a[0]), a) for a in _lire_lot(_arabe, morceaux)]


def _morceler_page(lignes: list) -> list:
    """Chaque ligne mixte de la page en groupes d'une seule ecriture.

    `lignes` : des (decoupe de la ligne, boite en pixels). Rend, par ligne :
    une liste de (texte, score, boite) quand la ligne se coupe en plusieurs
    groupes ; « arabe » ou « latin » quand elle n'a qu'une ecriture — elle se
    garde alors entiere, lue par ce modele ; `None` quand on ne sait pas la
    couper (ligne debout, ou d'un seul morceau).

    Toutes les lignes avancent ENSEMBLE, etape par etape, pour que chaque
    modele ne soit appele qu'une fois par etape et par page.
    """
    def marge(h):
        return max(2, h // 8)

    def rogner(k, a, b):
        img = lignes[k][0]
        h, w = img.shape[:2]
        return img[:, max(0, a - marge(h)):min(w, b + marge(h))]

    # 1. Couper chaque ligne aux blancs, et classer tous les morceaux d'un coup.
    morceaux = {}
    for k, (img, _) in enumerate(lignes):
        h, w = img.shape[:2]
        m = _morceaux(img, BLANC_MIN) if h <= w else []
        if len(m) >= 2:
            morceaux[k] = m
    cles = [(k, a, b) for k, m in morceaux.items() for a, b in m]
    classes = dict(zip(cles, _classer([rogner(*c) for c in cles])))

    # 2. Un morceau qui melange encore les deux ecritures — « المعرف : 1 »,
    #    colles par un blanc trop etroit — est recoupe plus finement.
    sous_cles, remplace = [], {}
    for (k, a, b) in cles:
        if classes[(k, a, b)][1]:
            sous = _morceaux(lignes[k][0][:, a:b], BLANC_MIN / 2)
            if len(sous) > 1:
                remplace[(k, a, b)] = [(k, a + x, a + y) for x, y in sous]
                sous_cles += remplace[(k, a, b)]
    classes.update(zip(sous_cles, _classer([rogner(*c) for c in sous_cles])))

    resultats = [None] * len(lignes)
    a_relire = {"latin": [], "arabe": []}
    groupes_par_ligne = {}
    for k, m in morceaux.items():
        h = lignes[k][0].shape[0]
        liste = []
        for a, b in m:
            for c in remplace.get((k, a, b), [(k, a, b)]):
                e, _, vu, lu_a = classes[c]
                liste.append([c[1], c[2], e, vu, lu_a])
        # 3. Une lettre isolee — le « ح » final de « النجاح », detache par
        #    son dessin — ne dit rien seule. Elle prend l'ecriture de son
        #    voisin le plus proche, si le modele arabe y voit une lettre : un
        #    « 8 » de quantite reste un chiffre.
        for i, (a, b, _, vu, _) in enumerate(liste):
            if b - a >= 0.9 * h or not vu:
                continue
            gauche = a - liste[i - 1][1] if i > 0 else None
            droite = liste[i + 1][0] - b if i + 1 < len(liste) else None
            if gauche is None and droite is None:
                continue
            voisin = i - 1 if droite is None or (gauche is not None and gauche <= droite) else i + 1
            liste[i][2] = liste[voisin][2]
        # 4. Les morceaux voisins de meme ecriture se recollent.
        groupes = []
        for a, b, e, _, lu_a in liste:
            if groupes and groupes[-1]["e"] == e:
                groupes[-1]["b"], groupes[-1]["n"] = b, groupes[-1]["n"] + 1
            else:
                groupes.append({"a": a, "b": b, "e": e, "n": 1, "lu": lu_a})
        if len(groupes) < 2:
            resultats[k] = groupes[0]["e"] if groupes else None
            continue
        groupes_par_ligne[k] = groupes
        # Un groupe latin se relit TOUJOURS par le modele latin, qui lit
        # mieux les chiffres ; un groupe de plusieurs morceaux se relit d'un
        # tenant : « 3 750,000 » reste un seul nombre. Un mot arabe seul
        # garde la lecture qui l'a classe.
        for g in groupes:
            if g["e"] == "latin" or g["n"] > 1:
                a_relire[g["e"]].append((g, rogner(k, g["a"], g["b"])))

    # 5. Les relectures, un appel par modele.
    for e, modele in (("latin", _latin), ("arabe", _arabe)):
        for (g, _), lu in zip(a_relire[e], _lire_lot(modele, [d for _, d in a_relire[e]])):
            g["lu"] = lu

    for k, groupes in groupes_par_ligne.items():
        w = lignes[k][0].shape[1]
        x0, y0, x1, y1 = lignes[k][1]
        sortie = [
            (g["lu"][0], g["lu"][1], (x0 + (x1 - x0) * g["a"] / w, y0, x0 + (x1 - x0) * g["b"] / w, y1))
            for g in groupes
        ]
        # L'ordre de lecture d'une ligne arabe va de droite a gauche : le
        # libelle, puis son montant. A l'interieur d'un groupe, chaque modele
        # rend deja son ordre a lui.
        sortie.sort(key=lambda g: -g[2][0])
        resultats[k] = sortie
    return resultats


def _boite_px(polygone):
    xs = [float(p[0]) for p in polygone]
    ys = [float(p[1]) for p in polygone]
    return (min(xs), min(ys), max(xs), max(ys))


def _tel_quel(polygones, textes, scores) -> list:
    """La lecture du pipeline, sans relecture : (texte, score, boite en pixels)."""
    return [
        (t, float(scores[i]) if i < len(scores) else None,
         _boite_px(polygones[i]) if i < len(polygones) and polygones[i] is not None else None)
        for i, t in enumerate(textes)
    ]


def _relire_en_arabe(tableau, polygones, textes, scores):
    """Relire chaque ligne en arabe ; garder l'arabe la ou il en a.

    Rend une liste de (texte, score, boite en pixels ou None). Une ligne
    mixte peut en rendre plusieurs.

    Seulement sur `rec_polys` — les polygones des lignes RECONNUES, alignes
    index par index sur `rec_texts` et `rec_scores`. Jamais sur `dt_polys`,
    qui ne leur correspond pas.
    """
    n = min(len(polygones), len(textes), len(scores))
    if _arabe is None or n == 0:
        return _tel_quel(polygones, textes, scores)
    decoupes = [_decouper(tableau, polygones[i]) for i in range(n)]
    boites = [_boite_px(polygones[i]) for i in range(n)]
    lus_ar = _lire_lot(_arabe, decoupes)
    garde = [_garder_l_arabe(textes[i], lus_ar[i][0], float(scores[i]), lus_ar[i][1]) for i in range(n)]
    # Les lignes a morceler : de l'arabe vu, la ligne couchee, et pas deja
    # gardee entiere en arabe. Toutes ensemble, pour lire par lots.
    # Une ligne ou le latin n'a vu que de la ponctuation (« : ») et ou
    # l'arabe ne voit aucun chiffre est arabe d'un bout a l'autre : c'est la
    # ligne du client, gardee entiere sans la couper.
    for i in range(n):
        latin_vu = re.sub(r"[\s:.,;|'`!-]", "", textes[i])
        if not garde[i] and not latin_vu and _a_de_l_arabe(lus_ar[i][0]) \
                and not re.search(r"\d", lus_ar[i][0]):
            garde[i] = True
    a_morceler = [
        i for i in range(n)
        if not garde[i] and _a_de_l_arabe(lus_ar[i][0])
        and (boites[i][3] - boites[i][1]) < (boites[i][2] - boites[i][0])
    ]
    morceles = dict(zip(a_morceler, _morceler_page([(decoupes[i], boites[i]) for i in a_morceler])))
    sortie = []
    for i in range(n):
        texte_ar, score_ar = lus_ar[i]
        morceaux = morceles.get(i)
        if garde[i] or morceaux == "arabe":
            # « arabe » : toute la ligne l'est, « : » compris — la ligne du
            # client, que la lecture latine reduisait a son deux-points.
            sortie.append((texte_ar, score_ar, boites[i]))
        elif isinstance(morceaux, list):
            sortie.extend(morceaux)
        else:
            sortie.append((textes[i], float(scores[i]), boites[i]))
    return sortie + _tel_quel(polygones[n:], textes[n:], scores[n:])


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
        rec_polys = donnees.get("rec_polys", [])
        if rec_polys:
            elements = _relire_en_arabe(tableau, rec_polys, textes, scores)
        else:
            # Sans polygones RECONNUS, pas de relecture : `dt_polys` ne
            # s'aligne pas sur les textes. On garde la lecture telle quelle.
            elements = _tel_quel(polygones, textes, scores)
        for texte, score, boite_px in elements:
            if not texte or not texte.strip():
                continue
            # Le polygone a quatre points et peut être incliné : on rend la
            # boîte alignée sur les axes qui l'englobe. C'est ce dont la
            # désignation a besoin pour raisonner en lignes et en colonnes.
            boite = [0.0, 0.0, 1.0, 1.0]
            if boite_px is not None:
                x0, y0, x1, y1 = boite_px
                boite = [
                    max(0.0, min(1.0, x0 / largeur)),
                    max(0.0, min(1.0, y0 / hauteur)),
                    max(0.0, min(1.0, x1 / largeur)),
                    max(0.0, min(1.0, y1 / hauteur)),
                ]
            lignes.append({"texte": texte, "boite": boite, "confiance": score})

    return {
        "lignes": lignes,
        "millisecondes": int((time.time() - debut) * 1000),
        "modele": "+".join(m for m in (DETECTION, RECONNAISSANCE, RECONNAISSANCE_ARABE) if m),
    }
