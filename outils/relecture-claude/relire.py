#!/usr/bin/env python3
"""La relecture ciblée par Claude — une MESURE, pas un chemin de production (8 novembre 2026).

Proposition au dirigeant, qui décidera : elle touche la règle R2 (« le modèle qui désigne ne
voit jamais la pièce »). Ici le modèle ne désigne pas : il RELIT une case découpée de l'image,
et sa lecture n'est qu'un CANDIDAT. La pièce n'est prouvée que si le Sudoku referme toutes ses
contraintes avec elle ; sinon rien ne change.

Deux temps :

  relire  — pour chaque pièce « aucune solution » qui a une image, choisit ses cases de
            montant, les découpe (la ligne pour le contexte, la case agrandie), les fait relire
            par le modèle en lots parallèles, et écrit un relevé candidat (copie du relevé OCR,
            les jetons relus remplacés). Journal : coût, secondes par étape.
  bilan   — compare le banc rejoué sur ce relevé au banc de référence : pièces gagnées, faux.

Le nom du modèle est un paramètre (R8) ; son prix se lit dans `agents.model_pricing`
(fichier `--tarifs`, relevé par le workflow). La consigne est versionnée à côté
(`consigne.md`). Aucune clé n'est écrite nulle part : `ANTHROPIC_API_KEY` vient de
l'environnement.
"""

import argparse
import base64
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
URL = "https://api.anthropic.com/v1/messages"
VERSION = "2023-06-01"

# Un montant tunisien, ou ce qu'un lecteur latin en fait : des chiffres (latins ou orientaux)
# ou leurs sosies (« VA,517 » pour « ٧٨,٢٣٦ »), avec un séparateur près de la fin.
SEPARATEURS = ".,،٫٬"
CHIFFRES = "0123456789٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"
SOSIES = "OoIlLSBZAVTEYrqgGbn|)(*-"
ORIENTAUX = {**{chr(0x0660 + i): str(i) for i in range(10)}, **{chr(0x06F0 + i): str(i) for i in range(10)}}

SCHEMA = {
    "type": "object",
    "properties": {
        "cellules": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "texte": {"type": "string"},
                    "lisible": {"type": "boolean"},
                },
                "required": ["id", "texte", "lisible"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cellules"],
    "additionalProperties": False,
}


def est_une_case_de_montant(texte: str) -> bool:
    t = re.sub(r"\s", "", texte)
    if not 2 <= len(t) <= 22 or not any(c in SEPARATEURS for c in t):
        return False
    # « 1,... » ou « 1,.* » : un timbre dont les zéros sont perdus reste une case de montant.
    if not re.search(f"[{re.escape(SEPARATEURS)}][{CHIFFRES}{SOSIES}.…]{{1,4}}[.*]?$", t):
        return False
    proches = sum(c in CHIFFRES or c in SOSIES or c in SEPARATEURS or c in ".…" for c in t)
    return proches / len(t) >= 0.8 and sum(c in CHIFFRES for c in t) >= 1


MONTANT = re.compile(f"[{CHIFFRES}](?:[{CHIFFRES} {re.escape(SEPARATEURS)}]*[{CHIFFRES}])?")


def le_montant(texte: str) -> str | None:
    """La lecture réduite à son montant : la case relue peut porter un voisin (« % 2 245,018 »,
    « 5.780,238 س », « 2 723,477 D »). Un seul nombre, sinon rien : deux nombres dans une
    case ne se départagent pas ici."""
    trouves = [m.group(0).strip() for m in MONTANT.finditer(texte)]
    trouves = [t for t in trouves if len(re.sub(r"\D", "", translitterer(t))) >= 2]
    return trouves[0] if len(trouves) == 1 else None


def translitterer(texte: str) -> str:
    """Le candidat donné au moteur : chiffres orientaux en latins, « ، » et « ٫ » en virgule,
    « ٬ » en espace. Ce qui reste à décider (proposition) : le moteur refuse aujourd'hui les
    chiffres orientaux d'un lecteur d'image (`litLesChiffresOrientaux`)."""
    t = "".join(ORIENTAUX.get(c, c) for c in texte)
    return t.replace("،", ",").replace("٫", ",").replace("٬", " ")


def png(img: Image.Image) -> str:
    b = io.BytesIO()
    img.save(b, format="JPEG", quality=92)
    return base64.b64encode(b.getvalue()).decode()


def decouper(image: Image.Image, jetons: list, plafond: int):
    """Les cases à relire et leurs images : la case agrandie, et sa ligne entière."""
    w, h = image.size
    cases = [t for t in jetons if t.get("page", 1) == 1 and est_une_case_de_montant(t["text"])]
    # Les totaux sont en bas : d'abord les lectures étranges, puis du bas vers le haut.
    cases.sort(key=lambda t: (not re.search(f"[{SOSIES}]", t["text"]), -t["y0"]))
    cases = cases[:plafond]
    sorties = []
    for i, t in enumerate(cases):
        x0, y0, x1, y1 = t["x0"] * w, t["y0"] * h, t["x1"] * w, t["y1"] * h
        hc = max(8.0, y1 - y0)
        case = image.crop((max(0, x0 - 0.6 * hc), max(0, y0 - 0.35 * hc), min(w, x1 + 0.6 * hc), min(h, y1 + 0.35 * hc)))
        k = max(1.0, min(4.0, 64 / max(1, case.size[1])))
        case = case.resize((int(case.size[0] * k), int(case.size[1] * k)), Image.LANCZOS)
        ligne = image.crop((0, max(0, y0 - 0.8 * hc), w, min(h, y1 + 0.8 * hc)))
        if ligne.size[0] > 1000:
            ligne = ligne.resize((1000, max(1, int(ligne.size[1] * 1000 / ligne.size[0]))), Image.LANCZOS)
        sorties.append({"id": f"C{i + 1}", "jeton": t, "case": png(case), "ligne": png(ligne)})
    return sorties


def appeler(modele: str, consigne: str, lot: list, cle: str):
    contenu = []
    for c in lot:
        contenu += [
            {"type": "text", "text": f"{c['id']} — la ligne (contexte) :"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": c["ligne"]}},
            {"type": "text", "text": f"{c['id']} — la case à transcrire :"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": c["case"]}},
        ]
    contenu.append({"type": "text", "text": "Rends le JSON des cases " + ", ".join(c["id"] for c in lot) + "."})
    corps = json.dumps({
        "model": modele,
        "max_tokens": 2048,
        "system": [{"type": "text", "text": consigne, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": contenu}],
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}, "effort": "low"},
    }).encode()
    for essai in range(4):
        debut = time.time()
        req = urllib.request.Request(URL, data=corps, method="POST", headers={
            "content-type": "application/json", "x-api-key": cle, "anthropic-version": VERSION})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                rep = json.loads(r.read())
            texte = "".join(b.get("text", "") for b in rep.get("content", []) if b.get("type") == "text")
            return json.loads(texte)["cellules"], rep.get("usage", {}), time.time() - debut, None
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and essai < 3:
                time.sleep(2 ** essai * 3)
                continue
            return [], {}, time.time() - debut, f"HTTP {e.code} : {e.read()[:200]!r}"
        except Exception as e:  # une réponse illisible est une panne mesurée, pas un arrêt
            if essai < 3:
                time.sleep(2)
                continue
            return [], {}, time.time() - debut, f"{type(e).__name__} : {e}"
    return [], {}, 0.0, "épuisé"


def cout(usage: dict, tarif: dict) -> float:
    return (usage.get("input_tokens", 0) * tarif["entree"]
            + usage.get("cache_read_input_tokens", 0) * tarif.get("cache", tarif["entree"])
            + usage.get("cache_creation_input_tokens", 0) * tarif.get("cache_ecriture", tarif["entree"])
            + usage.get("output_tokens", 0) * tarif["sortie"]) / 1e6


def relire(a):
    cle = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not cle:
        sys.exit("ANTHROPIC_API_KEY absente : la mesure ne part pas")
    tarifs = json.load(open(a.tarifs))
    if a.modele not in tarifs:
        sys.exit(f"{a.modele} : aucun tarif dans agents.model_pricing (R8) — la mesure ne part pas")
    tarif = tarifs[a.modele]
    consigne = open(os.path.join(ICI, "consigne.md"), encoding="utf-8").read()
    base = json.load(open(a.base))
    if os.path.exists(a.sortie):
        shutil.rmtree(a.sortie)
    shutil.copytree(a.cache, a.sortie)
    journal, depense = [], 0.0
    for p in base:
        if p["issue"] != "aucune" or p["corpus"] not in ("algoria", "synthetique"):
            continue
        image = os.path.join(a.racine, f"outils/jeu-{p['corpus']}/rendus/{p['id']}.jpg")
        releve = os.path.join(a.sortie, f"{p['corpus']}-{p['id']}.json")
        if not os.path.exists(image) or not os.path.exists(releve):
            continue
        if depense >= a.plafond:
            journal.append({"piece": f"{p['corpus']}-{p['id']}", "panne": "plafond atteint"})
            continue
        d = json.load(open(releve))
        t0 = time.time()
        cases = decouper(Image.open(image).convert("RGB"), d["tokens"], a.cases)
        t_decoupe = time.time() - t0
        lots = [cases[i:i + a.lot] for i in range(0, len(cases), a.lot)]
        t1 = time.time()
        with ThreadPoolExecutor(max_workers=max(1, len(lots))) as ex:
            reponses = list(ex.map(lambda l: appeler(a.modele, consigne, l, cle), lots))
        t_appel = time.time() - t1
        lus = {}
        usage_total, pannes, durees = {}, [], []
        for cellules, usage, duree, panne in reponses:
            durees.append(duree)
            if panne:
                pannes.append(panne)
            for k, v in usage.items():
                if isinstance(v, int):
                    usage_total[k] = usage_total.get(k, 0) + v
            for c in cellules:
                lus[c["id"]] = c
        depense += cout(usage_total, tarif)
        changes = []
        for c in cases:
            r = lus.get(c["id"])
            if not r or not r["lisible"] or not r["texte"].strip():
                continue
            montant = le_montant(r["texte"])
            if montant is None:
                continue
            candidat = translitterer(montant)
            if re.sub(r"\s", "", candidat) != re.sub(r"\s", "", c["jeton"]["text"]):
                changes.append({"ocr": c["jeton"]["text"], "claude": r["texte"], "candidat": candidat})
                c["jeton"]["text"] = candidat
        if changes:
            json.dump(d, open(releve, "w"), ensure_ascii=False)
        journal.append({
            "piece": f"{p['corpus']}-{p['id']}", "cases": len(cases), "lots": len(lots),
            "illisibles": sum(1 for r in lus.values() if not r["lisible"]),
            "changes": changes, "pannes": pannes, "usage": usage_total,
            "cout": cout(usage_total, tarif), "decoupeS": t_decoupe, "appelS": t_appel,
            "appelsS": durees,
        })
        print(f"{p['corpus']}-{p['id']} : {len(cases)} cases, {len(changes)} relues autrement, "
              f"{t_appel:.1f} s, {cout(usage_total, tarif):.4f} $", file=sys.stderr)
    json.dump({"modele": a.modele, "depense": depense, "journal": journal},
              open(a.journal, "w"), ensure_ascii=False, indent=1)


def quantile(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0.0


def bilan(a):
    def charge(f):
        return {(p["corpus"], p["id"]): p for p in json.load(open(f))}
    base = charge(a.base)
    lignes = ["## La relecture ciblée par Claude — bilan\n",
              f"Référence : {sum(p['issue'] == 'prouvee' for p in base.values())} pièces prouvées sur {len(base)}.\n",
              "| modèle | pièces relues | gagnées | prouvées (union) | faux sur les gagnées | coût total | coût / pièce relue | appel médian | appel p95 | découpe médiane | re-preuve médiane |",
              "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"]
    details = []
    for j, r in zip(a.journaux, a.relus):
        jo = json.load(open(j))
        rel = charge(r)
        relues = [x for x in jo["journal"] if "cases" in x]
        gagnees, faux = [], []
        for k, p in rel.items():
            if base[k]["issue"] != "prouvee" and p["issue"] == "prouvee":
                gagnees.append(k)
                faux += [(k, c["champ"], c["attendu"], c["lu"]) for c in p.get("champs") or []
                         if c["issue"] in ("faux", "invente")]
        # La re-preuve : le moteur rejoué sur le relevé candidat (sudokuMs du banc).
        repreuve = [rel[tuple(x["piece"].split("-", 1))].get("sudokuMs", 0) / 1000 for x in relues
                    if tuple(x["piece"].split("-", 1)) in rel]
        n = len(relues) or 1
        lignes.append(
            f"| {jo['modele']} | {len(relues)} | {len(gagnees)} | "
            f"{sum(p['issue'] == 'prouvee' for p in base.values()) + len(gagnees)} | {len(faux)} | "
            f"{jo['depense']:.4f} $ | {jo['depense'] / n:.4f} $ | "
            f"{quantile([x['appelS'] for x in relues], 0.5):.1f} s | {quantile([x['appelS'] for x in relues], 0.95):.1f} s | "
            f"{quantile([x['decoupeS'] for x in relues], 0.5):.2f} s | {quantile(repreuve, 0.5):.2f} s |")
        details.append(f"\n### {jo['modele']}\n\nGagnées : {', '.join('-'.join(k) for k in gagnees) or 'aucune'}\n")
        if faux:
            details.append("**Faux sur les pièces gagnées :**\n" + "\n".join(f"- {f}" for f in faux))
        details.append("\nCases relues autrement que l'OCR (extrait) :\n")
        for x in relues:
            for c in x["changes"][:6]:
                details.append(f"- {x['piece']} : OCR « {c['ocr']} » → Claude « {c['claude']} »")
            for pn in x["pannes"]:
                details.append(f"- {x['piece']} : panne {pn}")
    open(a.sortie, "w").write("\n".join(lignes + details) + "\n")
    print("\n".join(lignes))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="temps", required=True)
    r = sp.add_parser("relire")
    r.add_argument("--base", required=True)
    r.add_argument("--cache", required=True)
    r.add_argument("--racine", default=".")
    r.add_argument("--modele", required=True)
    r.add_argument("--tarifs", required=True)
    r.add_argument("--plafond", type=float, default=15.0)
    r.add_argument("--cases", type=int, default=40)
    r.add_argument("--lot", type=int, default=6)
    r.add_argument("--sortie", required=True)
    r.add_argument("--journal", required=True)
    b = sp.add_parser("bilan")
    b.add_argument("--base", required=True)
    b.add_argument("--journaux", nargs="+", required=True)
    b.add_argument("--relus", nargs="+", required=True)
    b.add_argument("--sortie", required=True)
    a = ap.parse_args()
    relire(a) if a.temps == "relire" else bilan(a)
