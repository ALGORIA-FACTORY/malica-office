# Corpus sans incertain : relevé, premières corrections, ce qui bloque (11 novembre 2026)

Branche `chantier/corpus-sans-incertain`. **Chantier partiel** : C1 et C10b sont corrigés et rejoués ;
le reste dépend de sources officielles que ce poste n'a pas pu lire (section 3). Rien n'est écrit sur
staging ni en production. Les corrections ont été jouées sur une copie locale, `malica_corpus_chantier`
(schéma `legal` sans fragments), jamais sur `malica`.

## 1. Relevé, en lecture seule (`db/verification/defauts_corpus.sql`)

Le relevé retrouve exactement les nombres de la stratégie du 11 novembre (C1 121, C2 345, C3 497,
C4 4 556, C7 12 102, C8 2 791). Il se rejoue : `psql -f db/verification/defauts_corpus.sql <base>`.

| Défaut                                     |           Avant |  Après | État                                                                                      |
| ------------------------------------------ | --------------: | -----: | ----------------------------------------------------------------------------------------- |
| C1 abrogé avec version ouverte             |             121 |     76 | corrigé : 45 remis en vigueur ; 74 sont de vraies pierres tombales ; 2 laissés à l'expert |
| C2 sans version 2024 (codes, recueil)      |             345 |    345 | non corrigé                                                                               |
| C3 en vigueur sans version ouverte         |             497 |    497 | cause trouvée, non corrigé                                                                |
| C4 statut indéterminé                      |           4 556 |  4 556 | non traité                                                                                |
| C5 versions de plus de 10 000 car.         |             472 |    472 | non traité (max : 632 595 car.)                                                           |
| C6 `valid_from` = 1er janvier de l'édition | 8 473 sur 8 473 |  8 473 | non corrigé                                                                               |
| C7 sans référence JORT                     |          12 102 | 12 102 | non corrigé                                                                               |
| C8 extraction incertain/partiel            |           2 791 |  2 791 | non corrigé                                                                               |
| C9 codes sans arabe                        |              10 |     10 | non corrigé                                                                               |
| C10b articles sans nom de corpus           |               6 |      0 | corrigé                                                                                   |
| C10a nom français vide (recueil)           |               1 |      1 | INCERTAIN                                                                                 |
| C10c documents en échec                    |               5 |      5 | motifs vérifiés, non récupérables ici                                                     |

## 2. Ce qui a été fait

**C1** : sur les 121, la lecture du texte donne trois causes. 45 articles portent un texte en vigueur : abrogation
d'un seul alinéa (CIRPPIS 12, 15, 49, CFL 6…), « abrogé et remplacé » (CASSUR, CNSS), ou mention de l'article
voisin restée dans le texte (CTVA 12). 74 ne contiennent que la mention d'abrogation : ils restent abrogés, avec
leur version « tombeau », ce qui est exact. 2 sont ambigus (CDET 149, RECUEIL 2000-08-09 art. 5) : non modifiés.
La règle est `db/corpus/statuts.mjs`, fonction pure éprouvée (7 cas), appliquée par
`db/corpus/appliquer-statuts.mjs` (rapport par défaut, `--ecrire` explicite, rejouable : un 2ᵉ passage ne trouve
plus rien). Retour arrière : remettre `statut = 'abroge'` sur les identifiants que l'outil imprime.
`abroge_par` n'est pas touché ; sur un article en vigueur il vaut note d'abrogation partielle.
_Limite_ : « abrogé et remplacé, texte à la suite = en vigueur » est une lecture de la convention d'annotation
de la DGELF, à faire confirmer par un expert sur CASSUR 54–61 et CNSS 41–107.

**C10b** : la ligne de `corpus_noms` s'appelait `DECRET_LOI_FINANCES_NOV` alors que les articles sont sous
`DECRET_LOI_FINANCES_NOV-2022`. Migration `20261211100000_…` : la clé est corrigée, le nom reste celui de la file.

## 3. Ce qui bloque, et ce qu'il faut décider

1. **Provenance non officielle.** Hôtes d'origine relevés dans `legal.ingestion_queue.url_fichier` : sur 50 codes,
   39 viennent de `jibaya.tn`, 7 de sites de cabinets, banques ou marchés (`alliance-tunisie.com`, `chaexpert.com`,
   `bna.tn`, `cmf.tn`), 1 de `cga.gov.tn` ; 687 notes communes sur 688 et 48 conventions sur 48 viennent de
   `jibaya.tn` ; 68 lois de finances sur 98 de `lake.jort.tn`, 30 de `jibaya.tn` ; des normes comptables de
   `exacomaudit.com` (20 sur 42). La règle « sources officielles uniquement » n'est donc pas respectée pour la
   majorité du corpus. Je n'ai rien corrigé : il faut reprendre ces textes d'une source officielle, ou arrêter une
   dérogation écrite. Les PDF eux-mêmes ne sont pas conservés (`legal.documents` est vide) : aucune ré-extraction
   sans re-téléchargement. (Hôtes classés officiels ou non à ma lecture : à valider ; `lake.jort.tn` ressemble au
   JORT, non vérifié.)
2. **Sources officielles lues** (lecture du 11 novembre, sans téléchargement) :
   `www.finances.gov.tn` répond ; ses PDF de codes portent « 2017 » dans leur nom (consolidé ou non : INCERTAIN) ;
   les lois de finances 2024, 2025 et 2026 y sont listées (`/sites/default/files/2023-12/LF2024_0.pdf`,
   `/2024-12/LF2025.pdf`, `/2026-01/115725.pdf`) ; aucune loi de finances 2027 n'est publiée (INCERTAIN si une
   autre rubrique la porte). `www.impots.finances.gov.tn` (DGI) : erreur TLS « chaîne de certificats
   incomplète » ; je n'ai pas désactivé la vérification TLS. `doc-fiscale.finances.gov.tn` est lié par le
   ministère mais n'a pas été lu. **Aucune édition 2024 d'un code n'a été trouvée.**
3. **C2** : sur les 345 articles, seuls 8 ont un texte identique avant et après 2024 (CDET 6, CFL 2) ; les autres
   ont changé ou sont mal lus. Le texte de 2024 ne se déduit donc pas : il faut l'édition 2024 officielle.
4. **C3** : cause relevée. Ce n'est pas une abrogation : l'édition 2026, la dernière, est mal lue (CIRPPIS 46
   articles lus sur 111, CDET 103 sur 144, CFL 2 sur 96, recueil 417 sur 873). Les articles absents (CDET 20, 26,
   41…) sont en vigueur. Le correctif est de relire l'édition 2026 depuis une source officielle, pas de changer un statut.
5. **Rappel avant/après : non mesuré.** `db/corpus/sonder.mjs` demande `bun` (absent de ce poste) et l'encodeur
   payant. Les fragments ne sont pas dans la copie. Point à noter : l'en-tête encodé de chaque fragment contient
   le statut de l'article ; les 45 articles de C1 devront être ré-encodés (coût estimé non mesuré), et le rappel
   rejoué avant publication. La correction C1 n'est donc **pas** prête pour staging.
6. **C4, C5, C6, C7, C8, C9** : non traités, parce qu'ils exigent la même relecture officielle (dates d'effet et
   JORT lus sur la loi de finances, arabe, découpage par alinéa). Aucune date d'effet n'a été déduite : INCERTAIN.
7. **Veille** : il n'existe aucune veille automatique dans le dépôt. `db/corpus/` ne contient que des outils lancés
   à la main (charger, reconstruire, vectoriser, sonder). Autre manque : la règle qui a posé les statuts
   initiaux n'est dans aucun script versionné ; `statuts.mjs` est la première règle de statut du dépôt.

## 4. Coût

0 $ : aucun encodage lancé, aucun appel payant. Le seuil de 20 $ n'est pas atteint.

## 5. À changer dans les zones réservées à l'autre session

- `apps/api/src/malica/` : après correction de C1, rejouer la question IS (article 49, taux de 20 %) pour
  vérifier l'hypothèse de la stratégie (§2 du document du 11 novembre) ; aujourd'hui elle reste une hypothèse.
- `packages/socle/` : rien.

## 6. Textes officiels lus le 11 novembre 2026 (lecture seule)

Trois numéros du Journal Officiel, publiés par `www.finances.gov.tn`, lus en arabe sur le texte natif (extraction
`pdftotext`, signature numérique de l'Imprimerie Officielle). L'empreinte est celle du fichier tel que reçu.

| Texte                                           | Adresse                                                                | JORT                               | SHA-256 (fichier reçu)                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Loi n° 2023-13 du 11 décembre 2023 (LF 2024)    | `https://www.finances.gov.tn/sites/default/files/2023-12/LF2024_0.pdf` | n° 144 du 12 décembre 2023, 184 p. | `5ef1dd07f7f5b10c1e70fc2d467912ad6e8fd1d8132c441b4348aeb4f99756a4` |
| Loi n° 2024-48 du 9 décembre 2024 (**LF 2025**) | `https://www.finances.gov.tn/sites/default/files/2024-12/LF2025.pdf`   | n° 149 du 10 décembre 2024, 169 p. | `08feaf86e175c192c3f3f87a176b126abfafea044eb36e634a3ed5818cd0f889` |
| Loi n° 2025-17 du 12 décembre 2025 (LF 2026)    | `https://www.finances.gov.tn/sites/default/files/2026-01/115725.pdf`   | n° 148 du 12 décembre 2025, 101 p. | `84f96735cc24a3fd90920e83c7fe4de2d0b22c128ada5b48df8a16135f053fc4` |

Correction : la loi n° 2024-48 est la loi de finances **pour 2025**, pas pour 2024 (la section 3 la laissait INCERTAIN).

**Premier fait sourcé pour C6 (date d'effet), article 49 du CIRPPIS.** L'article 37 de la loi 2024-48
(JORT n° 149, p. 6428-6429) réécrit l'article 49 : taux de l'IS fixé à 20 %, 40 % pour les banques et les
assurances, entre autres. Sa clause d'application, lue dans le texte, dit en substance que le chapitre
s'applique aux **bénéfices réalisés à compter du 1er janvier 2024**, et, pour les plus-values de cession des
non-résidents non établis, à compter du 1er janvier 2025. La version « édition 2025 » de l'article 49, datée du
1er janvier 2025 en base, n'est donc pas sa date d'effet : c'est l'illustration exacte de C6. La clause est citée
d'après une extraction de texte arabe (ordre des mots inversé par l'extracteur) : relecture par un juriste
recommandée avant d'écrire la date en base. Aucune date d'effet n'a encore été écrite en base.

Accès restants : `legislation.tn` ne répond pas depuis ce poste (HTTP 503 en clair, connexion refusée en TLS) ;
son éditeur reste non confirmé. `doc-fiscale.finances.gov.tn` : 503. Le Journal Officiel lui-même (`iort.gov.tn`)
n'est pas joignable d'ici. Les PDF ci-dessus sont des numéros du Journal Officiel ; la consolidation des codes,
elle, reste à obtenir d'une source officielle.
