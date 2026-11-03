# Avis des composants tiers du lecteur OCR

Ce fichier voyage dans l'image (`/licenses/`), avec le texte de licence de
chaque paquet installé. Vérifié le 1er novembre 2026.

## Les poids des modèles

Licence : Apache-2.0 (étiquette des fiches Hugging Face de PaddlePaddle ; le
code PaddleOCR, même licence, en porte le texte : `/licenses/paddleocr/`).
Copyright : PaddlePaddle Authors.

| Modèle | Dépôt | Révision épinglée |
| --- | --- | --- |
| PP-OCRv5_mobile_det | https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det | `0d63e78e2b680928f6b1747d76a08db6e645efb7` |
| latin_PP-OCRv5_mobile_rec | https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec | `ab2cd5cc5fa6309be2e5acdfe66eca2c2c127d57` |
| arabic_PP-OCRv5_mobile_rec | https://huggingface.co/PaddlePaddle/arabic_PP-OCRv5_mobile_rec | `33d91636a65dca87f5562cc48860332ae367ee1b` |

**Modification (Apache-2.0 § 4 b)** : les poids sont convertis, sans autre
changement, au format ONNX par `paddle2onnx` 2.1.0 (opset 14) à la
construction de l'image. Les empreintes SHA-256 des fichiers d'origine et des
fichiers convertis sont dans `poids.json` ; celles des `inference.pdiparams`
sont identiques à celles que publie Hugging Face.

Le dictionnaire du modèle latin est celui de sa révision (836 entrées, section
`PostProcess.character_dict` de `inference.yml`), le même que
`ppocr/utils/dict/ppocrv5_latin_dict.txt` de PaddleOCR.

## Les logiciels

| Composant | Version | Licence |
| --- | --- | --- |
| paddlepaddle | 3.3.1 | Apache-2.0 |
| paddleocr | 3.7.0 | Apache-2.0 |
| paddlex | 3.7.2 | Apache-2.0 |
| paddle2onnx (construction seulement) | 2.1.0 | Apache-2.0 |
| onnxruntime | 1.31.1 | MIT, avec `ThirdPartyNotices.txt` de Microsoft |
| fastapi | 0.115.6 | MIT |
| uvicorn | 0.34.0 | BSD-3-Clause |
| pillow | 11.1.0 | MIT-CMU (HPND) |

Aucun de ces projets ne publie de fichier NOTICE au sens d'Apache-2.0 § 4 d.
