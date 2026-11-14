# Recette locale du 14 novembre 2026 — l'export de la bibliothèque (G5)

Pile locale jetable : Postgres neuf migré comme en CI, API et site lancés depuis
cette branche, comptes et pièces d'essai (`essai.local`), aucune donnée réelle.
Téléphone Pixel 7 (Chromium), clics réels, téléchargements réels. Maquette
approuvée : `docs/maquettes/pme-export-bibliotheque.html`.

- `1-accueil-a-exporter-fr.png`, `1-accueil-a-exporter-ar.png` — l'accueil d'une
  société sans comptabilité : « À exporter · 2 », le geste « Exporter », puis
  « Remis le 14/11 » (le dernier export).
- `2-bibliotheque-boutons-fr.png`, `2-bibliotheque-boutons-ar.png` — le mois
  ouvert : « Exporter novembre 2026 » à côté d'« Imprimer » et de
  « Sélectionner ». Aucun écran neuf.
- `3-feuille-fr.png`, `3-feuille-ar.png` — la feuille : ZIP et Excel cochés, le
  périmètre dit en clair, « Les pièces privées ne sont pas incluses ». En arabe,
  `dir="rtl"` : tout se retourne.
- `3b-feuille-depuis-l-accueil-fr.png` — la même feuille, ouverte depuis l'accueil.
- `4-pret-fr.png`, `4-pret-ar.png`, `4b-pret-depuis-l-accueil-fr.png` — « Prêt · 2
  fichiers », un bouton par fichier. Sur l'accueil, la feuille reste ouverte
  quand le compteur tombe à zéro.
- `5-accueil-remis-fr.png`, `5-accueil-remis-ar.png` — après l'export : plus de
  « À exporter », seulement « Remis le 14/11 ».

Les deux fichiers ont été téléchargés par le bouton, puis ouverts : le ZIP
contient `Achats/…`, `Tickets et reçus/…`, `Ventes/…` (un original par pièce) ;
l'Excel a une feuille « Pièces », une ligne par pièce (date, tiers, type, montant
tel que lu, devise, dossier, référence, nom du fichier dans le ZIP), sans formule.

## Ce que cette recette ne prouve pas

- **« Toutes les sociétés » au clic.** Le fichier réunissant plusieurs sociétés
  (un dossier par société, une feuille par société) est prouvé par l'épreuve
  `la-bibliotheque-s-exporte.test.ts`, pas cliqué dans le navigateur.
- **Android.** Aucun appareil : sur la coque, le fichier est écrit dans les
  documents de l'application et son chemin est dit à l'écran (comme
  l'impression). La feuille de partage du téléphone (« Partager ») demande un
  greffon (`@capacitor/share`) absent du dépôt : non fait.
- **Les montants.** Les pièces d'essai n'ont pas de lecture chiffrée : la colonne
  « Montant TTC » est vide ici. Le montant tel que lu (chaîne décimale, sans
  flottant) est prouvé par le code de l'export, pas par ces captures.
- **Libellés arabes.** Les libellés `pme.export.*` et les mentions du fichier en
  arabe sont provisoires, à faire valider par un lecteur arabophone.
- **L'écran de la tour.** Les limites (taille, conservation, simultanés) se
  règlent par `plateforme.export_regler` ; aucun écran de la tour ne les montre
  (même dette que `impression_regler`, nommée dans `integrite-de-la-base.json`).
