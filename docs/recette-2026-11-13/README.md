# Recette locale du 13 novembre 2026 — PR #383

Pile locale jetable : Postgres neuf migré comme en CI, API et site lancés
depuis cette branche, compte et pièces d'essai (`essai.local`), aucune donnée
réelle. Téléphone Pixel 7 (Chromium), clics réels. Les captures sont des
rendus de cet écran, pas des maquettes.

## 1 · « Pour moi · Privé · jamais lu » abandonné au choix du rayon (G2)

- `1a-pour-qui-fr.png` — deux pièces, étape « Pour qui ? », « 1 sur 6 ».
- `1b-dans-quel-rayon-fr.png` — après « Pour moi » : « Dans quel rayon ? ».
  Base à cet instant : les deux pièces sont `personnel`, `capturee`,
  `gardee_le` posé, rayon `autres` (`capture.rangements_prives`), aucune
  lecture (`capture.extractions`).
- `1c-accueil-apres-abandon-fr.png` — on quitte sans choisir : Achats et Ventes
  ne comptent que les pièces de la société (« 1 pièce » chacun).
- `1d-espace-prive-fr.png` — « Mon espace · 2 papiers », rayon Autres.

## 2 · Basic sans comptabilité (G5)

- `2-bibliotheque-fr.png`, `2-bibliotheque-ar.png` — bibliothèque : 2 pièces
  (les documents joints et les pièces privées ne comptent pas).
- La fiche de la facture affiche « Rangée » (« مصنّفة » en arabe) au lieu de
  « À envoyer » ; l'accueil dit « Tout est en ordre » (texte relevé,
  voir 1c).

## 3 · Capture : numérotation, reprise, type déclaré (G6)

- `3-etape-1-fr.png` à `3-etape-4-fr.png` — « 1 sur 6 », « 2 sur 6 »,
  « 3 sur 6 », « 4 sur 6 » : une seule numérotation, pas de second compteur.
- `3-reprise-apres-rechargement-fr.png` — rechargement à l'étape 4 : l'écran
  revient à « 4 sur 6 », la même pièce, et le type « Facture de vente »
  déclaré à l'import est repris à « Vérifier ».

## 4 · Documents comptés (G8, D10), français et arabe RTL

- `4-documents-lies-fr.png`, `4-documents-lies-ar.png` — « 2 DOCUMENTS » /
  « 2 وثيقة » pour une facture et son justificatif joint (`dir="rtl"`).
- `4-dossier-achats-fr.png`, `4-dossier-achats-ar.png` — le dossier Achats
  compte « 1 pièce » / « وثيقة واحدة » : le justificatif joint n'y figure pas.

## Ce que cette recette ne prouve pas

- **La lecture IA de bout en bout.** Aucune clé de lecture n'est configurée sur
  ce poste (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, ni `QWEN_BASE_URL` /
  `QWEN_OCR_MODEL` pour l'œil). Les lectures de l'étape « Vérifier » sont
  posées par le banc d'essai (`lecture-d-essai.ts`), pas par un modèle. Les
  étapes 2 à 4 de la capture ont été atteintes par l'adresse (`?etape=`), pas
  par un clic depuis l'étape 0 : seule la suite 0 → 1 → rayon l'est.
- **L'export (« À exporter », ZIP et Excel).** Aucune maquette PME ne le
  montre : `malica.html` et `pme-mobile.html` n'en ont pas. Seule existe
  `05_export_csv_fec`, côté cabinet. Rien n'est codé tant qu'une maquette PME
  ne l'a pas arrêté.
