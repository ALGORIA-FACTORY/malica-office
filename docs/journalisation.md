# La journalisation de bout en bout

Une opération — une capture sur le téléphone, une validation au cabinet — se
suit d'étape en étape jusqu'à ce que l'écran a montré, et se relit en SQL.
Migration `20261118130000_une_operation_se_suit_de_bout_en_bout.sql` ; code
dans `apps/api/src/observabilite/`.

## Le modèle

| Objet                                   | Ce qu'il porte                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observabilite.traces`                  | Une opération d'origine : `id` (venu du client par `x-malica-trace`, sinon créé à l'entrée HTTP), `parente_id` (un travail différé, une reprise), `origine` (`android`, `pwa`, `web`, `api`, `tache`), `tenant_id`, `acteur`, `piece_id`, `version` du client, `debut`.                                             |
| `observabilite.evenements`              | Ses étapes : `etape` (vocabulaire fermé), `issue` (`ok`, `refus`, `erreur`, `ignore` — `ignore` dit aussi une requête abandonnée par le client), `debut`, `duree_ms`, `cle` d'idempotence, `acteur`, `piece_id`, `audit_ids` (les lignes d'`audit.event_log` que l'étape a écrites), `detail` borné, `repetitions`. |
| `observabilite.etapes`                  | Le vocabulaire, et pour chaque étape les seules clés que son `detail` peut porter.                                                                                                                                                                                                                                  |
| `observabilite.reglages`                | La rétention (90 jours au départ, INCERTAIN). La dernière ligne vaut.                                                                                                                                                                                                                                               |
| `observabilite.chronologie_v`           | Chaque étape avec sa trace, à plat.                                                                                                                                                                                                                                                                                 |
| `observabilite.diagnostic_piece(piece)` | La chronologie d'une pièce, traces parentes et enfants comprises.                                                                                                                                                                                                                                                   |

Ce que le journal ne recopie pas : les faits métier sont dans `audit.event_log`
(l'étape les **référence** par `audit_ids`), les pannes de l'appareil dans
`audit.journal_client`, les gestes de la tour dans `audit.journal_plateforme`.

## Les droits

- `anon`, `authenticated` et `malica_api` ne lisent rien : pas même l'usage du
  schéma pour les deux premiers. `malica_api` n'exécute que
  `observabilite.consigner`, `observabilite.purger` et
  `observabilite.trace_d_origine` (un identifiant, rien de ce que la trace
  porte : la parente d'une relecture de nuit).
- Le propriétaire est `greffier` (sans connexion), et non le `portier` : le
  portier est membre d'`authenticated` pour que ses portes subissent les
  politiques de l'appelant ; ici aucun client ne lit, et le greffier ne possède
  que ce schéma.
- La lecture est à `malica_exploitation` (sans connexion, sans mot de passe dans
  le dépôt). Un DBA l'endosse : `grant malica_exploitation to <son rôle>;` puis
  `set role malica_exploitation;`. Le superutilisateur lit aussi.
- `observabilite.consigner` ne retient le dossier d'une trace que s'il appartient
  à son acteur (membre, cabinet engagé, opérateur) : sinon il est écarté et
  compté. Appelée sous l'identité d'un utilisateur, elle refuse
  (`refus.geste.non_permis`).

## Ce qui est garanti, et ce qui ne l'est pas

Garanti, et éprouvé (`le-journal-survit-a-l-echec.test.ts`,
`le-journal-ne-perd-rien.test.ts`) :

- la trace d'une opération refusée ou annulée (rollback) reste : le journal
  écrit par sa propre connexion, jamais dans la transaction métier ;
- (trace, étape, clé) ne s'inscrit qu'une fois ; un renvoi ou un rejeu ajoute à
  `repetitions` — la première inscription vaut ;
- la mémoire est bornée (`JOURNAL_FILE_MAX`) ; au-delà, ou base injoignable, les
  événements partent dans le fichier d'attente (`JOURNAL_ATTENTE`, volume
  `journal_attente` en production), rejoué au démarrage et toutes les
  `JOURNAL_REJEU_MS` ;
- SIGTERM et SIGINT vident la file, en base ou sur disque, avant l'arrêt ;
- ce qui est réellement perdu (disque inutilisable, ligne illisible, lot refusé
  par la base) est compté et dit par une étape `perte` (`nombre`, `raison`) ;
- le `detail` ne garde que les clés autorisées par l'étape, des scalaires (une
  chaîne coupée à 200 caractères), 2 048 octets au plus.

Pas garanti :

- un arrêt brutal (SIGKILL, panne de la machine) perd ce que la file tenait en
  mémoire : au plus `JOURNAL_INTERVALLE_MS` (1 s) d'événements. Ce qui était
  déjà sur disque revient ;
- l'étape `affiche` et les étapes du téléphone ne sont pas encore émises (lots
  suivants) : aujourd'hui, `http`, `rpc`, `perte`, `tache` et la chaîne de
  lecture (ci-dessous) le sont ;
- un client qui réutiliserait l'identifiant de trace d'un autre y ajouterait
  ses étapes (sans pouvoir y poser un dossier qui n'est pas le sien) ;
- la rétention purge une trace parente avant ses enfants si elle est plus
  ancienne : l'enfant reste, sa parente est nommée sans être lisible.

## La chaîne de lecture d'une pièce

Migration `20261118140000_la_lecture_d_une_piece_se_suit.sql` ; code dans
`apps/api/src/malica/lecture/etapes-de-lecture.ts`. Chaque étape porte la
pièce ; sa clé est (pièce, passe) — `premiere`, `rattrapage`, `relecture` —,
si bien qu'une passe rejouée sous la même trace compte une répétition.

| Étape         | Où                                                                      | Ce que `detail` porte                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload`      | `stockage.ts`, `POST /pieces/:id/contenu`                               | `statut` (`scellee`, `deja_scellee`, `remplacee`, `trop_grosse`, `panne`), `octets`, `type_contenu`, `doublon_de`. Ni les octets ni leur empreinte.                                                           |
| `ocr`         | `read-flow.ts` (chaque passe) ; `refus` quand la base refuse la lecture | `passe`, `lecteur`, `modele`, `modele_designation`, `jetons` (leur nombre), `latence_ms`, `paddle_tente`, `motif` (refus), `erreur` (nom de l'erreur, jamais son message).                                    |
| `extraction`  | `read-flow.ts`                                                          | Ce que la lecture PROPOSE (sa désignation relue dans le plan, avant le sudoku) : `contrat`, `qualite`, `devise`, `base_ht`, `tva`, `ttc`, `droits`, `ttc_par_lettres`, `incoherence`.                         |
| `sudoku`      | `sudoku.ts` (`verdict`), tracé par `read-flow.ts`                       | `mode`, `issue`, `designee`, `regle` (`lettres:<champ>` ou `variante:<nom>`), `raison`, les montants prouvés, `lettres` (le montant lu en lettres), `preuve_lettres`, `ecart_ttc` (proposé − prouvé).         |
| `rattrapage`  | `read-flow.ts` (synchrone ou différé)                                   | `declenche`, `raison` (`lecture_parfaite`, `piece_prouvee`, `sans_autre_lecteur`, `contrat_partiel`, `montants_incoherents`, …, `abstention_<motif>` la nuit), `differe`, `qualite_avant`/`apres`, `retenue`. |
| `persistance` | `read-flow.ts`                                                          | Les montants ENREGISTRÉS et `extraction_id` (la ligne de `capture.extractions`, référencée) ; en échec, `erreur` et `code_refus`.                                                                             |
| `jugement`    | `scan/analyse.ts` (`capture.analyser`, la lecture, le rejeu)            | `chemin` (`analyse`, `rejeu`), `analyse_id`, `extraction_id`, `verdict`, `etat`, les montants normalisés, `change`, `essai` (rejeu à blanc, annulé ensuite).                                                  |
| `tache`       | `coureur.ts` (lecture en file), `relirePiece` (relecture de nuit)       | `nom`, `tentative`. La trace est ENFANT : de la requête qui a demandé la lecture, ou de `observabilite.trace_d_origine(piece)` — la capture — pour une relecture.                                             |

## Consulter

```sql
-- La chronologie d'une pièce, en une requête.
select debut, origine, etape, issue, duree_ms, detail, audit_ids, repetitions, trace_id, parente_id
  from observabilite.diagnostic_piece('<uuid de la pièce>');

-- La lecture d'une pièce, une question par colonne (le cas MyTek :
-- `malica/lecture/la-lecture-d-une-piece-se-suit.test.ts`). Une relecture de
-- nuit retenue a ses propres lignes (`passe = 'relecture'`, trace enfant).
select max(detail ->> 'ttc')     filter (where etape = 'extraction' and detail ->> 'passe' = 'premiere') as ttc_propose,
       max(detail ->> 'base_ht') filter (where etape = 'extraction' and detail ->> 'passe' = 'premiere') as ht_propose,
       max(detail ->> 'lettres') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere') as lettres,
       max(detail ->> 'issue')   filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere') as sudoku,
       max(detail ->> 'regle')   filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere') as regle,
       max(detail ->> 'ecart_ttc') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere') as ecart_ttc,
       bool_or((detail ->> 'declenche')::boolean) filter (where etape = 'rattrapage') as rattrapage,
       max(detail ->> 'raison')  filter (where etape = 'rattrapage') as raison_rattrapage,
       max(detail ->> 'base_ht') filter (where etape = 'persistance' and issue = 'ok') as ht_persiste,
       max(detail ->> 'ttc')     filter (where etape = 'persistance' and issue = 'ok') as ttc_persiste,
       max(detail ->> 'extraction_id') filter (where etape = 'persistance' and issue = 'ok') as extraction_id,
       max(detail ->> 'verdict') filter (where etape = 'jugement') as verdict
  from observabilite.diagnostic_piece('<uuid de la pièce>');

-- Une trace donnée (l'identifiant rendu dans l'en-tête x-malica-trace).
select debut, etape, issue, duree_ms, detail
  from observabilite.chronologie_v where trace_id = '<uuid>' order by debut;

-- Ce qu'une étape rpc a audité (superutilisateur : l'exploitation ne lit pas l'audit).
select c.debut, c.detail ->> 'methode' as methode, a.action, a.object_table, a.object_id
  from observabilite.chronologie_v c
  join audit.event_log a on a.id = any (c.audit_ids)
 where c.trace_id = '<uuid>';

-- Les refus de la dernière heure, par méthode et par clé.
select detail ->> 'depot' as depot, detail ->> 'methode' as methode,
       detail ->> 'code_refus' as refus, count(*)
  from observabilite.evenements
 where etape = 'rpc' and issue = 'refus' and debut > now() - interval '1 hour'
 group by 1, 2, 3 order by 4 desc;

-- Ce qui a été perdu.
select debut, detail from observabilite.evenements where etape = 'perte' order by debut desc;

-- Changer la rétention.
insert into observabilite.reglages (retention_jours, motif) values (180, '<décision et sa date>');
```

## Ajouter une étape (lots suivants)

1. Une migration nouvelle déclare l'étape ou ses clés — jamais une chaîne libre
   dans le code :

   ```sql
   update observabilite.etapes
      set cles_autorisees = cles_autorisees || array['montant_reconnu', 'verdict']
    where code = 'sudoku';
   ```

   Une clé ne porte jamais un secret, un jeton, une donnée de carte, une photo ni
   un texte OCR intégral ; une valeur métier citée (un montant reconnu) est
   permise.

2. Le code l'émet sous la trace en cours (`AsyncLocalStorage`, posée par
   `observabilite/requete.ts` pour toute requête HTTP) :

   ```ts
   import { consigner, mesurer, tracerUnTravail } from "./observabilite/journal.ts";
   import { noterLObjet } from "./observabilite/trace.ts";

   noterLObjet({ tenant, piece });                          // le dossier, la pièce
   consigner("affiche", "ok", { cle: `${piece}:ecran`, piece, detail: { … } });
   const lu = await mesurer("ocr", () => lire(piece), { cle: `${piece}:${tentative}` });
   await tracerUnTravail("relecture", traceDOrigine, () => relire(piece), { tenant, tentative });
   ```

   La `cle` dit ce qui est « la même étape » : un renvoi de la même clé est une
   répétition. Par défaut, c'est la clé de la requête (`x-malica-cle`, sinon
   tirée au sort).

3. Un test prouve que l'étape s'inscrit et que `diagnostic_piece` la rend.
