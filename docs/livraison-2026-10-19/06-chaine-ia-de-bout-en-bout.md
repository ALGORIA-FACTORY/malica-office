# La chaîne, de la photo à l'écriture

Relevé sur `apps/api/src/malica/lecture/read-flow.ts`, `modeles.ts`,
`token-plan.ts` et les migrations. Ce qui est marqué **À INSÉRER** n'existe pas
encore : ce sont les deux seuls points où le compteur de lectures entre dans la
chaîne.

---

## Le trajet

```
  ┌─ le téléphone ────────────────────────────────────────────────────────┐
  │  capabilities/scanner.ts   photo → archive couleur, plafond 350 Ko    │
  │  lib/hors-ligne/file.ts    la file, 50 éléments / 250 Mo              │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  │  capture.enregistrer({vis})
                                  │  ← LA DESTINATION SE CHOISIT ICI (B6)
                                  ▼
  ┌─ capture.pieces ──────────────────────────────────────────────────────┐
  │  vis = personnel | entite | partage     status = capturee             │
  │  created_by = auth.uid()                sha256, idempotency_key       │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  │  clic explicite : « Lire les 6 »
                                  ▼
          ╔═══ À INSÉRER ═══════════════════════════════════════════╗
          ║  public.lecture_autorisee(piece)                        ║
          ║    personnel      → refus, 0 appel modèle, 0 débit      ║
          ║    plafond_atteint→ refus, la capture reste ouverte     ║
          ║    relecture      → autorisé, et gratuit                ║
          ╚═════════════════════════╤═══════════════════════════════╝
                                    ▼
  ┌─ PASSE 1 · le relevé ─────────────────────────────────────────────────┐
  │  pdf-text (0 jeton) si le PDF porte une couche de texte               │
  │  PaddleOCR  PP-OCRv5_mobile_det + latin_PP-OCRv5_mobile_rec           │
  │  qwen-vl-ocr-2025-11-20 (vision, 0,07 / 0,16 $ le Mtok)               │
  │  → capture.token_plan : chaque mot, sa page, sa boîte, sa confiance   │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  │  SECOND LECTEUR, si la confiance est basse :
                                  │  Paddle a lu → la vision relit, et l'inverse
                                  ▼
  ┌─ PASSE 2 · la désignation ────────────────────────────────────────────┐
  │  deepseek-chat (ROLE_DESIGNATION)                                     │
  │  ►► IL NE VOIT JAMAIS L'IMAGE ◄◄                                      │
  │  Il reçoit le plan de tokens et rend des {page, ordinal} — JAMAIS      │
  │  une valeur. Les montants sont RELUS dans le plan (`token-plan.ts`).  │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  │  R2 — la frontière
                                  ▼
  ┌─ capture.persisterLecture ────────────────────────────────────────────┐
  │  extractions · citations · piece_articles · analyses                  │
  │  `capture_read_persist` lève « R2 : citation orpheline » si un champ  │
  │  cite un token qui n'existe pas. Aucun montant n'entre sans origine.  │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
          ╔═══ À INSÉRER ═══════════════════════════════════════════╗
          ║  public.lecture_consommer(piece)                        ║
          ║  APRÈS la persistance, et seulement si elle a réussi.   ║
          ╚═════════════════════════╤═══════════════════════════════╝
                                    ▼
  ┌─ capture.analyser → le verdict ───────────────────────────────────────┐
  │  à comptabiliser · avec réserve · à rapprocher · à rejeter ·          │
  │  anomalie à signaler        (capture.analyses, ajout seul)            │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌─ la conversation ─────────────────────────────────────────────────────┐
  │  charges.questions → l'écran pose UNE question à la fois              │
  │  charges.answer    → la réponse est une `capture.precisions`, un      │
  │                      ajout daté, jamais une réécriture (R7)           │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌─ la destination finale ───────────────────────────────────────────────┐
  │  collab.setPieceVis → 'entite'  : le dirigeant a quelque chose à      │
  │                                   valider (notification a_valider)    │
  │                     → 'partage' : transmise_le = now(), le cabinet    │
  │                                   est prévenu (notification partagee) │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Les six règles de cette chaîne

**1. La destination précède la lecture.** `visibilite-a-la-capture.ts` rend
`personnel` pour toute capture depuis le 7 octobre, et l'en-tête du fichier dit
pourquoi : une facture est partie au cabinet avant d'être lue, donc avant que
son verdict existe. La transmission est une **réponse**, à la fin.

**2. Le modèle qui désigne ne voit pas l'image.** C'est toute la défense contre
l'hallucination : il rend des coordonnées, pas des chiffres. Un champ qui ne
correspond à aucun token devient un drapeau, jamais une valeur.

**3. Une lecture qui échoue ne se facture pas.** D'où l'ordre : `autorisee`
avant le premier appel de modèle, `consommer` après la persistance. Si R2 lève
sur une citation orpheline, le client n'a rien reçu, et rien n'est débité.

**4. Une relecture est gratuite.** `unique (piece_id)` sur
`facturation.lectures`. Si corriger coûtait, le client apprendrait à ne pas
corriger — et Malica cesserait d'apprendre de ses corrections, qui sont
précisément ce dont elle apprend.

**5. Le plafond arrête la lecture, jamais la capture.** Les pièces s'empilent,
non lues. Rien n'est perdu quand le client régularise. *Mesuré : 66 pièces en
base, 65 lues, sur une licence Basic.*

**6. Le modèle vient de la table qui le tarife** (R8). Un organe appelé sans
ligne de tarif en vigueur **ne se journalise pas**, et le plafond de
`agents.budgets` ne mord alors sur rien. Changer de modèle est une ligne de
migration ; un millésime figé, jamais `-latest`, sinon une pièce relue ne donne
plus ce qu'elle donnait à sa comptabilisation.

---

## Les deux plafonds, qu'il ne faut jamais confondre

| | `agents.budgets` | `facturation.lectures` |
|---|---|---|
| unité | **dollars** | **lectures** |
| protège | ALGORIA d'une facture Alibaba | le client d'un dépassement |
| portée | par organisation | par **licence** (mise en commun) |
| posé par | l'exploitant | la grille `ref.offres` |
| quand il mord | pendant l'appel au modèle | **avant** le premier appel |

---

## Ce que l'écran doit dire quand ça refuse

Jamais un code, jamais une erreur technique. `lecture_autorisee` rend un
`motif`, et l'écran le traduit :

| `motif` | ce que Malica dit |
|---|---|
| `piece_personnelle` | « Celle-là est à vous. Je ne la lis pas, et elle ne coûte rien. » |
| `plafond_atteint` | « Vos 65 lectures sont prises. Continuez à photographier — je les lirai le 1er, ou plus tôt si vous passez à Solo. » |
| `licence_suspendue` | « Je ne peux plus lire tant que le forfait n'est pas régularisé. Vos pièces vous attendent, aucune n'est perdue. » |
| `organisation_sans_licence` | ne doit jamais atteindre l'écran : c'est un défaut d'installation, pas un état du produit. Journaliser et alerter. |

---

## Les épreuves à écrire

Dans le style du dépôt — un fichier, un nom qui dit la règle, un en-tête qui
dit pourquoi :

- `le-plafond-arrete-la-lecture-pas-la-capture.test.ts`
- `une-lecture-qui-echoue-ne-se-facture-pas.test.ts` — R2 lève, zéro ligne
  dans `facturation.lectures`
- `une-relecture-ne-coute-rien.test.ts`
- `une-piece-personnelle-ne-part-jamais-au-modele.test.ts` — zéro appel,
  vérifié sur `agents.agent_runs`
- `le-quota-se-met-en-commun.test.ts` — Premium, trois sociétés, 360 au groupe
