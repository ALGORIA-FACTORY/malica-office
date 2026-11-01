# Le lecteur OCR, dans sa boîte : deux moteurs, les mêmes poids.
#
# Les poids sont TÉLÉCHARGÉS, VÉRIFIÉS ET CONVERTIS À LA CONSTRUCTION, pas au
# premier appel : sinon le premier démarrage dépend du réseau, et le modèle
# peut changer sous nos pieds entre deux redémarrages. R8 : le relevé doit
# rester le même tant qu'une ligne de ce dépôt n'a pas bougé — d'où
# l'empreinte SHA-256 de chaque fichier, dans `poids.json`.

# ================================================== 1. LES POIDS, ET LEUR PREUVE
#
# Une étape à part : paddle2onnx et ses dépendances ne vont pas dans l'image
# servie. Versions épinglées toutes : la conversion est déterministe À
# VERSIONS ÉGALES, et l'empreinte de chaque `inference.onnx` le vérifie.
FROM python:3.12-slim AS poids

RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      paddlepaddle==3.3.1 \
      paddle2onnx==2.1.0 \
      onnx==1.17.0 \
      protobuf==7.36.2 \
      numpy==2.5.4

# Un miroir interne peut remplacer la source (gabarit d'URL, voir poids.py) ;
# les empreintes, elles, ne se remplacent pas.
ARG POIDS_SOURCE=
COPY poids.json poids.py /construction/
RUN POIDS_SOURCE="${POIDS_SOURCE}" python /construction/poids.py telecharger /poids \
 && python /construction/poids.py convertir /poids

# ====================================================== 2. LE SERVICE
FROM python:3.12-slim

# libgomp1 n'est pas facultatif : sans lui, paddle refuse de s'importer
# (« libgomp.so.1: cannot open shared object file »). Vérifié le 13 octobre.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends libgl1 libglib2.0-0 libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

# Versions épinglées. « paddleocr » tout court installerait demain autre chose
# qu'aujourd'hui, et le relevé d'une pièce relue ne serait plus celui de sa
# comptabilisation. paddlex est épinglé lui aussi : c'est lui qui porte le
# pipeline (découpe, post-traitement) et le moteur onnxruntime.
RUN pip install --no-cache-dir \
      paddlepaddle==3.3.1 \
      paddleocr==3.7.0 \
      paddlex==3.7.2 \
      onnxruntime==1.31.1 \
      fastapi==0.115.6 \
      "uvicorn[standard]==0.34.0" \
      pillow==11.1.0

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OCR_MOTEUR=onnx \
    OCR_POIDS=/app/poids \
    OCR_MODELE_DETECTION=PP-OCRv5_mobile_det \
    OCR_MODELE_RECONNAISSANCE=latin_PP-OCRv5_mobile_rec \
    # Le second alphabet, ligne par ligne : vide = coupe. Ses poids sont dans
    # l'image, l'allumer ne demande aucun reseau.
    OCR_MODELE_RECONNAISSANCE_ARABE= \
    # Sans borne, le moteur ouvre un fil par cœur vu et affame le reste de la
    # machine — qui porte aussi la base de données.
    OMP_NUM_THREADS=2

COPY --from=poids /poids /app/poids
COPY poids.json poids.py service.py /app/
WORKDIR /app

# Le contrat, éprouvé à la construction, sur chaque moteur : le service
# démarre (empreintes revérifiées), lit une page fictive, et rend la forme
# attendue sous le nom tarifé. Une image qui ne lit pas ne se publie pas.
RUN for moteur in onnx paddle; do \
      OCR_MOTEUR=$moteur OCR_MODELE_RECONNAISSANCE_ARABE=arabic_PP-OCRv5_mobile_rec python -c "\
import io; from PIL import Image, ImageDraw, ImageFont;\
p = Image.new('RGB', (900, 300), 'white'); d = ImageDraw.Draw(p);\
d.text((40, 60), 'TOTAL TTC 1 234,500', fill='black', font=ImageFont.load_default(size=48));\
d.text((40, 170), 'Facture 293/2026', fill='black', font=ImageFont.load_default(size=48));\
b = io.BytesIO(); p.save(b, 'PNG');\
import service; r = service._lire(b.getvalue());\
assert set(r) == {'lignes', 'millisecondes', 'modele'}, r;\
assert r['modele'] == service.MODELE, r['modele'];\
assert r['lignes'] and all(set(l) == {'texte', 'boite', 'confiance'} and len(l['boite']) == 4\
  and all(0.0 <= v <= 1.0 for v in l['boite']) for l in r['lignes']), r;\
assert any('234' in l['texte'] for l in r['lignes']), r;\
print(service.MODELE, [l['texte'] for l in r['lignes']])" || exit 1; \
    done

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/sante || exit 1

EXPOSE 8000
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
