# Rejouer les vérifications

Ces cinq scripts ont été exécutés le 18 octobre 2026 sur un PostgreSQL 16 neuf,
après les 139 migrations du dépôt et les 14 de `../migrations/`.

```bash
# 1. une base neuve
initdb -D /var/tmp/pg -U postgres --auth=trust -E UTF8
pg_ctl -D /var/tmp/pg -o '-p 5433 -k /var/tmp' start -w
createdb -h /var/tmp -p 5433 -U postgres malica_local

# 2. le schéma
cp ../migrations/*.sql <depot>/db/migrations/
node <depot>/db/migrer.mjs --base "postgresql://postgres@localhost:5433/malica_local"

# 3. les preuves, dans l'ordre
for f in 0*.sql; do psql -h /var/tmp -p 5433 -U postgres -d malica_local -q -f $f; done
```

**Note sur `pgvector`.** La machine d'audit n'avait pas l'extension. Les trois
index HNSW du corpus juridique ont été neutralisés et `extensions.vector` remplacé
par un domaine, le temps de la vérification. Aucun rapport avec le périmètre
audité ; sur l'image `pgvector/pgvector:pg17` du dépôt, rien à faire.

## Ce que chaque script établit

| | établit |
|---|---|
| `01` | une licence Team rend 160 lectures à 29 DT, 185 à 37 DT avec 3 sièges, et refuse la 11ᵉ place |
| `02` | les cinq scénarios publiés le 17 octobre, recalculés par `droits_v` |
| `03` | **le bogue de suppression** : refus avec le dépôt tel quel, succès avec le correctif |
| `04` | **la fuite de l'espace privé** : le dirigeant voit, puis ne voit plus |
| `05` | le plafond arrête la lecture et jamais la capture ; une relecture est gratuite |
| `07` | la plateforme voit **0 pièce** et **1 client** ; suspension, supplément (120+80=200), reprise ; réquisition refusée sans seconde signature puis servie sans contenu ; facture Solo à 23,610 TTC, encours et flux |
| `09` | **les quatre exécutions**, en TypeScript contre la base : `node --experimental-strip-types ../code/essai-executions.ts` |
| `08` | les quatre verrous de Malica : doublon, silence, cadence, droit perdu — et l'état déduit des remises |
| `06` | un établissement s'archive — le dernier ouvert refuse, celui qui porte des pièces dit combien — et une pièce corrigée après transmission revient `a_revalider`, sauf si elle est comptabilisée |
