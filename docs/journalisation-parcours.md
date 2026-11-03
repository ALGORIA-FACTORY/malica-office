# Chaque parcours se suit — la cartographie

Ce document dit, parcours par parcours, d'où part une opération, quel journal
existant la porte déjà, quelles étapes le journal d'observabilité y ajoute, la
preuve de recette, et ce qui n'est **pas** couvert. Le modèle (traces, étapes,
droits, consultation) est dans [`journalisation.md`](journalisation.md) ; il
n'est pas recopié ici. Migrations `20261118130000` (socle), `20261118140000` (lecture) et `20261118150000`
(parcours) ; code dans `apps/api/src/observabilite/` et `apps/web/src/lib/parcours/`.

## Les journaux existants, et ce qu'on y lit encore

Le journal d'observabilité **référence** ces journaux, il ne les recopie pas :

| Journal                                               | Ce qu'il porte, et qui le lit                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit.event_log`                                     | Les faits métier, dans la transaction. Une étape métier ou `rpc` réussie en cite les lignes (`audit_ids`) ; leur objet est noté par la base.                 |
| `audit.journal_client`                                | Les PANNES de l'appareil, montrées au dirigeant (réglages). Les étapes de l'appareil n'y vont pas : voir « Le canal de l'appareil ».                         |
| `audit.journal_plateforme`                            | Les gestes de la tour. L'étape `reglage` d'un geste de la tour s'y ajoute avec l'acteur, l'issue et le refus.                                                |
| `fabrique.travail_faits`                              | Chaque prise et issue d'un travail durable (lecture, relecture de nuit, génération). L'étape `tache` en est le pendant chronologique, par tentative.         |
| `fabrique.passages_de_nuit`, `fabrique.passage_faits` | Les passages de la passe de nuit et leur bilan. La trace `passe_de_nuit` les encadre.                                                                        |
| `notif.envois` (via `notif.remettre`)                 | Chaque courriel décidé et sa remise. L'étape `envoi` cite l'envoi par son identifiant (la clé), jamais l'adresse ni le texte.                                |
| `parametrage.cours_de_change_imports`                 | Chaque import de cours officiel (outil `outils/importer-les-cours.mjs`, hors API) : fichier, empreinte, opérateur. Non doublé par une trace : voir plus bas. |
| `signalements` (`signalements.deposer`)               | Ce que la personne signale depuis l'écran. Passe par `/rpc` : tracé `http` + `rpc` comme tout appel.                                                         |

## Le canal de l'appareil

Les étapes `capture`, `file_hors_ligne`, `synchronisation` et `affiche`
partent par `journal.etapes` (une méthode RPC dédiée), par lots de cinquante au
plus, et **non** par `audit.journal_client` : cette table est sous RLS du
dossier, relue par l'écran de réglages du dirigeant et sans déduplication — y
verser chaque capture la noierait et montrerait au dirigeant ce qui n'est pas
une panne. `journal.etapes` n'accepte que les étapes que la base dit émises par
l'appareil (`observabilite.etapes.emise_par_l_appareil`), pose l'acteur
lui-même, ne nomme une pièce que si l'appelant la voit (sa RLS), et ne porte
que des identifiants, la plateforme, des compteurs et, pour `affiche`, les
montants rendus.

## Servi ou affiché

L'API trace ce qu'elle **sert** (`http`, `rpc`, et les étapes de lecture du lot
suivant). L'écran trace ce qu'il **affiche** : `components/malica/affichage-signale.tsx`,
posé à côté des montants rendus, émet `affiche` une fois par rendu de valeurs
(dédoublonné sur l'appareil, puis par la base sur (trace, étape, clé)) :

- PME, fiche d'une pièce : `ttc`, `base_ht`, `tva`, `source` = `lecture` ou
  `cabinet` (les montants de l'écriture du cabinet, quand elle fait foi) ;
- Comptabilité, écriture d'une pièce : `total_debit`, `total_credit`,
  `source` = `proposee` ou `inscrite`, seulement tant que la saisie est
  inchangée (une saisie en cours n'est pas un résultat affiché) ;
- `plateforme` : `android` (coque), `pwa` (application installée), `web`.

## La matrice

| Parcours                                                         | Point d'entrée                                                                                                        | Journal existant réutilisé                            | Étapes ajoutées                                                                                                                                                                               | Preuve de recette                                                                                                                                                   | Non couvert                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Android / PWA — capture hors ligne**                           | `vidage.deposer` (`lib/hors-ligne`) : la trace naît là, rangée avec la pièce                                          | —                                                     | `capture`, `file_hors_ligne`, `synchronisation` (redites à l'arrivée)                                                                                                                         | `vidage.test.ts` « la trace suit la pièce… » (même trace et même clé à travers hors ligne et deux échecs réseau) ; API « l'appareil signale ses étapes par lots »   | Une capture abandonnée avant tout envoi n'est jamais signalée si l'application est tuée hors ligne et jamais rouverte. |
| **Android / PWA — synchronisation et upload**                    | `capture.enregistrer` (`/rpc`), `POST /pieces/:id/contenu`, `/malica/lectures/:id`                                    | `audit.event_log` (`piece.captured`)                  | `x-malica-trace` + `x-malica-cle` (`<clé>.enregistrer`, `.octets`, `.lecture`) ; `upload` émis par `stockage.ts` (lot de la lecture)                                                          | API « un renvoi de capture.enregistrer rend la même pièce, sans doublon ni d'audit ni d'étape » — défaut trouvé et corrigé : un renvoi auditait une seconde capture | —                                                                                                                      |
| **Android / PWA / web — affichage PME**                          | Fiche de la pièce (`pme.piece.$pieceId.tsx`)                                                                          | —                                                     | `affiche` (ttc, base, tva, source, plateforme)                                                                                                                                                | `affichage-signale.test.tsx`, `signaleur.test.ts` (une fois par rendu, sous la trace de la capture)                                                                 | La liste et le détail de la feuille (mêmes valeurs, même clé : dédoublonnés, pas signalés deux fois).                  |
| **PME — transfert siège → propriétaire → cabinet**               | `collab.envoyer`, `transmettreLesPieces`, `setPieceVis`, `garderPiece`                                                | `audit.event_log`                                     | `transfert` (geste, objet, pièce, issue, `audit_ids`)                                                                                                                                         | API « un geste sensible a son étape métier » (`garderPiece`)                                                                                                        | Pas d'épreuve dédiée pour `envoyer` siège → propriétaire (couvert par le référentiel, non rejoué en test).             |
| **PME — corrections, paiements, renvoi**                         | `capture.*` (dater, préciser, rattacher, paiement…, `renvoyer`, `repondreAuCabinet`)                                  | `audit.event_log`                                     | `correction`, `paiement`, `retour`                                                                                                                                                            | API « un geste refusé (rollback) garde sa trace, sa clé de refus et sa pièce » (`renvoyer` refusé)                                                                  | —                                                                                                                      |
| **Comptabilité — retour, validation, forçage, comptabilisation** | `supervision.retourner`, `office.valider`, `forcer`, `book`, `inscrireLeReglement`, `banque.*`, `honoraires.*`        | `audit.event_log`                                     | `retour`, `validation`, `forcage`, `comptabilisation`, `correction` ; `affiche` (totaux de l'écriture)                                                                                        | Référentiel vérifié contre le contrat (« chaque geste du référentiel nomme une méthode servie ») ; les deux côtés se relient par `piece_id` dans `diagnostic_piece` | Pas d'épreuve qui rejoue un retour du cabinet puis le renvoi de la PME sur la même pièce.                              |
| **Paiements, abonnement**                                        | `facturation.*` (recharge, forfait, payer, souscrire, abonnement)                                                     | `audit.event_log`                                     | `paiement`                                                                                                                                                                                    | Référentiel                                                                                                                                                         | Le retour du prestataire de paiement (s'il en arrive hors `/rpc`) n'est tracé que par `http`.                          |
| **Droits, places, invitations, clés**                            | `collab.inviter`, `facturation.inviter*`/`libererPlace`/`transmettreLicence`, `identite.*Mandat`, `integrations.*Cle` | `audit.event_log`                                     | `droits`                                                                                                                                                                                      | Référentiel                                                                                                                                                         | L'invitation par lien ne cite pas d'objet : son argument est un jeton, jamais extrait.                                 |
| **Réglages comptables et du cabinet**                            | `parametrage.*`, `identite.definirOrganisation`/`etablirFiche`                                                        | `audit.event_log`                                     | `reglage`                                                                                                                                                                                     | Référentiel                                                                                                                                                         | —                                                                                                                      |
| **Exports**                                                      | `exports.generer`, `journalDuJour.exporter` ; téléchargement `GET /exports/:id/contenu`                               | `audit.event_log`                                     | `export`                                                                                                                                                                                      | Référentiel                                                                                                                                                         | Le téléchargement lui-même n'a que son étape `http`.                                                                   |
| **Plateforme (la tour)**                                         | `tour.regler*`, `publier*`, `designerEmetteur`, jours fériés                                                          | `audit.journal_plateforme`                            | `reglage`                                                                                                                                                                                     | Référentiel                                                                                                                                                         | —                                                                                                                      |
| **Tâches — lecture du coureur, relecture de nuit**               | `coureur.ts`, `relirePiece` (`read-flow.ts`), tic de `demarrer-la-nuit.ts`                                            | `fabrique.travail_faits`, `fabrique.passages_de_nuit` | `tache` par tentative, trace dérivée de (travail, tentative), parente : la requête ou `trace_d_origine(piece)` (lot de la lecture, `20261118140000`) ; trace `passe_de_nuit` par tic (ce lot) | `la-lecture-d-une-piece-se-suit.test.ts`, `la-relecture-de-nuit.test.ts`                                                                                            | La génération de recettes (`generation_recette`) n'a pas de trace `tache`.                                             |
| **Tâches — relances et notifications**                           | `demarrerLesRelances` → `tourDeRelances`                                                                              | `notif.envois`                                        | trace `relances` par tour ; `envoi` par courriel (canal, résultat)                                                                                                                            | Requête ci-dessous ; pas d'épreuve dédiée                                                                                                                           | Aucune épreuve n'exécute un tour avec une clé d'envoi réelle.                                                          |
| **Tâches — rejeu (rejuger les pièces)**                          | `outils/rejuger-les-pieces.mjs`                                                                                       | `audit.event_log`                                     | trace `rejuger_les_pieces` par page                                                                                                                                                           | Exécuté en `--essai` sur base de test : une étape `tache` `essai_rejugees_0_changees_0`                                                                             | —                                                                                                                      |
| **Intégrations — import des cours**                              | `outils/importer-les-cours.mjs` (outil d'exploitation, hors API)                                                      | `parametrage.cours_de_change_imports`                 | aucune (le journal d'import est la trace, avec son opérateur)                                                                                                                                 | `outils/importer-les-cours.test.mjs`                                                                                                                                | Non relié aux traces : l'outil parle à la base en administrateur, pas à l'API.                                         |
| **Intégrations — clés d'API du cabinet**                         | `/rpc` sous clé (`ouParCleApi`)                                                                                       | `audit.event_log`                                     | `http`, `rpc`, étapes métier comme un appel de session (origine `api`)                                                                                                                        | Socle (lot 1)                                                                                                                                                       | —                                                                                                                      |

## L'isolation

- **Lire** : seul `malica_exploitation` (et le superutilisateur) lit le journal ;
  `anon`, `authenticated` et `malica_api` ne lisent rien (lot 1,
  `le-journal-survit-a-l-echec.test.ts`). Le rôle d'exploitation lit tout, pièces
  privées comprises : c'est voulu, c'est le support.
- **Écrire dans la trace d'un autre** : une étape dont l'acteur n'est pas celui
  de la trace (ou n'est pas admis dans son dossier) part sous une trace propre,
  dérivée de (trace, acteur), sans parente ; le bilan de `consigner` les compte
  (`traces_isolees`). Deux clients dont les étapes arrivent dans le même lot ne
  se partagent pas une trace neuve.
- **L'espace privé** : `journal.etapes` ne nomme une pièce que si l'appelant la
  voit ; un collègue du même dossier ne voit pas la pièce `personnel` de
  l'auteur. Un geste refusé n'est rattaché à sa pièce que si l'appelant la voyait
  avant l'appel.
- Épreuve : « une trace ne s'écrit pas depuis une autre organisation, ni
  l'espace privé hors de son auteur » (`chaque-parcours-se-suit.test.ts`).

## Consulter

```sql
-- Tout ce qu'une pièce a vécu : capture, file, synchronisation, upload, lecture,
-- gestes des deux côtés, tâches, affichage — en une requête.
select debut, origine, etape, issue, detail ->> 'geste' as geste, detail ->> 'code_refus' as refus,
       detail ->> 'ttc' as ttc_affiche, detail ->> 'plateforme' as plateforme, audit_ids, trace_id
  from observabilite.diagnostic_piece('<uuid de la pièce>');

-- Servi ou affiché : les montants que chaque écran a montrés pour la pièce.
select debut, origine, detail ->> 'ecran' as ecran, detail ->> 'source' as source,
       detail ->> 'ttc' as ttc, detail ->> 'base_ht' as base, detail ->> 'plateforme' as plateforme
  from observabilite.diagnostic_piece('<uuid>') where etape = 'affiche';

-- Les gestes refusés de la journée, par geste et par clé de refus.
select detail ->> 'geste' as geste, detail ->> 'code_refus' as refus, count(*)
  from observabilite.evenements
 where issue = 'refus' and detail ? 'geste' and debut > now() - interval '1 day'
 group by 1, 2 order by 3 desc;

-- Le dernier tour de relances et ses courriels.
select t.id, e.etape, e.issue, e.detail
  from observabilite.traces t join observabilite.evenements e on e.trace_id = t.id
 where t.id = (select trace_id from observabilite.evenements
                where etape = 'tache' and detail ->> 'nom' = 'relances' order by debut desc limit 1)
 order by e.debut;

-- Le référentiel : quelle méthode est quel geste.
select depot, methode, etape, geste, objet_type from observabilite.gestes order by etape, depot, methode;
```

Ajouter un geste : une migration insère sa ligne dans `observabilite.gestes`
(l'API la relit sous cinq minutes, sans redémarrage) ; l'épreuve « chaque geste
du référentiel nomme une méthode servie » refuse un geste orphelin.
