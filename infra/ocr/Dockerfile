# Le second lecteur, dans sa boîte.
#
# Les poids sont TÉLÉCHARGÉS À LA CONSTRUCTION, pas au premier appel : sinon
# le premier démarrage dépend du réseau, et le modèle peut changer sous nos
# pieds entre deux redémarrages. R8 : le relevé doit rester le même tant
# qu'une ligne de code n'a pas bougé.
FROM python:3.12-slim

# libgomp1 n'est pas facultatif : sans lui, paddle refuse de s'importer
# (« libgomp.so.1: cannot open shared object file »). Vérifié le 13 octobre.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends libgl1 libglib2.0-0 libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

# Versions épinglées. « paddleocr » tout court installerait demain autre chose
# qu'aujourd'hui, et le relevé d'une pièce relue ne serait plus celui de sa
# comptabilisation.
RUN pip install --no-cache-dir \
      paddlepaddle==3.3.1 \
      paddleocr==3.7.0 \
      fastapi==0.115.6 \
      "uvicorn[standard]==0.34.0" \
      pillow==11.1.0

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OCR_MODELE_DETECTION=PP-OCRv5_mobile_det \
    OCR_MODELE_RECONNAISSANCE=latin_PP-OCRv5_mobile_rec \
    OCR_LANGUE=fr \
    # Sans borne, Paddle ouvre un fil par cœur vu et affame le reste de la
    # machine — qui porte aussi la base de données.
    OMP_NUM_THREADS=2

COPY service.py /app/service.py
WORKDIR /app

# Les poids, maintenant : une lecture à blanc sur une image unie suffit à les
# faire descendre et à les figer dans l'image.
RUN python -c "\
from PIL import Image; Image.new('RGB',(64,64),'white').save('/tmp/vide.png');\
import os; os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK']='True';\
from paddleocr import PaddleOCR;\
PaddleOCR(lang='fr', text_detection_model_name='PP-OCRv5_mobile_det',\
          text_recognition_model_name='latin_PP-OCRv5_mobile_rec',\
          use_doc_orientation_classify=False, use_doc_unwarping=False,\
          use_textline_orientation=False, enable_mkldnn=False).predict('/tmp/vide.png')"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/sante || exit 1

EXPOSE 8000
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
