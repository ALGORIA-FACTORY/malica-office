#!/usr/bin/env bash
# Chaîne d'ingestion complète du corpus juridique tunisien.
# Chaque étape est reprenable : relancer ne retraite que ce qui reste.
set -euo pipefail
export MALICA_DSN="${1:?donnez une URL de connexion}"
export MALICA_PRIORITE_MAX="${2:-5}"     # 3 = ce dont le moteur a besoin ; 5 = tout
echo "=== 1/4  téléchargement, extraction, empreinte SHA-256"; python3 ingerer.py
echo "=== 2/4  OCR bilingue français-arabe des scans (long)";   python3 ocr.py
echo "=== 3/4  graphe des références juridiques";               python3 references.py
echo "=== 4/4  segmentation en articles puis versions";         python3 segmenter.py && python3 versions.py
