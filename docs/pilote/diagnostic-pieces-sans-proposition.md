# Pièces reçues sans écriture proposée — diagnostic (13 novembre 2026)

Constat G1 de la recette du 13 novembre : depuis ~9 h 30, aucune pièce reçue
sur le staging n'a d'écriture proposée. **Cause INCONNUE.** Cette note donne les
commandes qui départagent les trois hypothèses. **Rien ci-dessous n'a été joué
sur le staging** (cette session n'y a pas accès) : chaque résultat attendu est
INCERTAIN jusqu'à ce qu'une personne l'ait relevé et inscrit ici.

## Ce que dit le code (lu, pas exécuté sur le staging)

- La proposition n'est pas un travail planifié : `office.propositionDePiece`
  la calcule à la demande, depuis l'analyse de la lecture
  (`apps/api/src/scan/proposition.ts`).
- Sans lecture (`capture.extractions`), pas d'analyse, donc pas de proposition.
- La lecture passe par la file durable `fabrique.travaux` (nature
  `lecture_piece`), prise **sous l'identité d'un membre**, sans démon
  (`apps/api/src/malica/lecture/coureur.ts`) : un travail abandonné n'est repris
  qu'au prochain appel d'un membre du dossier.
- `/sante/profonde` ne contrôle que la base et le stockage ; l'OCR est « dit,
  jamais exigé ».

## Seuil d'alerte (nouveau)

`ref.socle_params`, code `fabrique.seuil.travail.proposition_attente_min`
(minutes ; 10 au départ, **INCERTAIN**, à revoir sur mesures). Surcharge par
cabinet : `parametrage.fabrique_seuils`. Se lit en base, jamais dans le code.

## Où l'alerte se lit

1. **La tour / un opérateur** (sans superutilisateur, sans lire de pièce) :
   `select * from plateforme.lectures_en_souffrance_v;` — par dossier, état et
   motif du dernier travail de lecture non terminé depuis plus que le seuil.
   `alerte = false` pour `refuse` (refus métier, visible quand même).
2. **Le lundi / sur le serveur** : `db/pilote/tableau-de-bord.sql`, bloc
   « pièces sans proposition » : y compris les pièces dont la lecture n'a
   jamais été demandée (`aucun_travail`). Zéro ligne = rien à signaler.

Non fait : l'affichage dans l'écran de la tour (méthode de dépôt, port, contrat
RPC, composant) — à décider ; la vue est prête à être lue.

## Hypothèse 1 — OCR / second lecteur injoignable

Précédent : tunnel `OCR_URL` du 29 octobre (`docs/exploitation.md`, section
« Le retour d'ONNX »).

```bash
curl -s https://<domaine>/sante/profonde | jq .
```

Lire le champ `ocr` : s'il dit injoignable, c'est l'hypothèse 1. INCERTAIN : la
forme exacte du champ (`apps/api/src/app.ts`, `/sante/profonde`).

```bash
# Depuis l'hôte de l'API : le lecteur répond-il ? (OCR_URL est dans le .env du serveur)
docker compose --project-directory /srv/malica/depot/infra --env-file /srv/malica/.env \
  exec -T api sh -c 'wget -qO- --timeout=5 "$OCR_URL/sante" || echo INJOIGNABLE'
```

Le chemin de santé du lecteur est `/sante` (`infra/ocr/service.py`, repris par
`infra/compose.yml`). Et le journal des exécutions :

```sql
select agent, model, status, left(error, 120) as erreur, count(*), max(created_at)
  from agents.agent_runs
 where created_at > now() - interval '6 hours'
 group by 1, 2, 3, 4 order by max(created_at) desc;
```

Attendu si hypothèse 1 : des `status` en échec avec une erreur réseau depuis
~9 h 30, ou **aucune ligne** depuis cette heure (rien n'est même tenté).

## Hypothèse 2 — travaux de lecture bloqués ou abandonnés

```sql
select etat, dernier_motif, tentatives, count(*), min(demande_le), max(demande_le)
  from fabrique.etat_des_travaux_v
 where nature = 'lecture_piece' and demande_le > now() - interval '24 hours'
 group by 1, 2, 3 order by 1;
```

`a_faire` ou `abandonne` en nombre = la file ne tourne pas (personne ne l'a
relancée) ; `epuise` / `en_panne` / `en_erreur` = elle tourne et échoue (voir
`dernier_motif`). Le journal de l'API, au même instant :

```bash
docker compose --project-directory /srv/malica/depot/infra --env-file /srv/malica/.env \
  logs --since 6h api | grep -E "\[coureur\]|lecture" | tail -50
```

## Hypothèse 3 — pièces refusées en amont

```sql
-- L'état de lecture et le motif des pièces récentes, comme l'écran les lit.
select p.id, p.created_at, p.status, t.etat as lecture_etat, t.dernier_motif as lecture_motif
  from capture.pieces p
  left join lateral (
    select e.etat, e.dernier_motif from fabrique.etat_des_travaux_v e
     where e.piece_id = p.id and e.nature = 'lecture_piece'
     order by e.demande_le desc limit 1) t on true
 where p.created_at > now() - interval '24 hours'
 order by p.created_at desc limit 50;

-- Le forfait : lectures consommées par période (une ligne par lecture rendue).
select periode, count(*) from facturation.lectures
 where consommee_le > now() - interval '48 hours' group by 1 order by 1 desc;

-- Les refus de lecture inscrits au journal.
select payload ->> 'motif' as motif, count(*), max(at)
  from audit.event_log
 where action = 'lecture.refusee' and at > now() - interval '24 hours'
 group by 1;
```

Motifs à chercher : forfait épuisé, abonnement suspendu. INCERTAIN : le nom
exact de la vue du journal (`event_log_v` dans le code ; `audit.event_log` ici
sous superutilisateur) et les valeurs de `motif`.

Cas voisin, ni panne ni refus : la lecture existe mais la date est hors de tout
pack (`propositionHorsDuReferentiel`, `raisonCode = date_hors_referentiel`) ;
la pièce a une extraction mais aucune proposition. Le bloc du tableau de bord
ne la compte pas (elle est lue) :

```sql
select count(*) from capture.analyses a
 where a.created_at > now() - interval '24 hours';
```

## Lecture des résultats

| Constat | Cause probable |
|---|---|
| `ocr` injoignable, `agent_runs` muet ou en erreur réseau | 1 |
| travaux `a_faire` / `abandonne` sans erreur | 2 (file non relancée) |
| travaux `epuise` / `en_erreur` avec motif | 1 ou 2 selon le motif |
| travaux `refuse` / `lecture.refusee` | 3 |
| analyses présentes, propositions vides | date hors référentiel |

## Épreuve de bout en bout

`apps/api/src/une-piece-recue-aboutit-a-une-proposition.test.ts` : pièce
déposée par la vraie application, lue par le vrai flux (organes payants
simulés), écriture proposée relue sous la RLS du client ; puis une lecture
muette vieillie au-delà du seuil paraît dans la vue pour un opérateur, et pas
pour le client. Elle ne prouve **pas** que le staging lit : elle prouve que la
chaîne tient et que sa panne se voit.
