# Malica Office en conteneurs

Tous les services dans Docker ; la base est la base `malica` du serveur partagé `pg-shared` (réseau `pg-shared-net`), comme les autres applications.

```
docker/
  compose.yml          api, web, caddy, migrate + profils ocr et sauvegarde
  dockerfiles/         api, web, ocr, sauvegarde (un Dockerfile par service)
  env/                 un fichier .env par service (*.env.example suivis, *.env jamais)
  scripts/             init-env.sh, bootstrap-db.sh, migrate.sh
```

| Service | Rôle | Image / Dockerfile |
|---|---|---|
| `caddy` | point d'entrée, `127.0.0.1:8090` (`MALICA_PORT`) ; routes dans `infra/caddy/Caddyfile` | `caddy:2.9` |
| `web` | site (rendu serveur), port interne 8080 | `dockerfiles/web.Dockerfile` |
| `api` | API Express, port interne 3000 | `dockerfiles/api.Dockerfile` |
| `migrate` | migrations, une fois puis s'arrête (même image que l'API) | `dockerfiles/api.Dockerfile` |
| `ocr` | second lecteur, profil `ocr`, 2 Go | `dockerfiles/ocr.Dockerfile` |
| `sauvegarde` | dump + restic, profil `sauvegarde` | `dockerfiles/sauvegarde.Dockerfile` |

## Démarrer

Pré-requis : `~/pg-shared` tourne (`docker compose up -d --wait`).

```bash
docker/scripts/init-env.sh        # crée env/*.env, génère les secrets (jamais affichés, jamais écrasés)
docker/scripts/bootstrap-db.sh    # une fois : base, rôles et extensions sur pg-shared
docker/scripts/migrate.sh         # joue les migrations (à relancer à chaque nouvelle migration)
docker compose -f docker/compose.yml up -d --build
```

Renseignez ensuite les clés des modèles (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `BREVO_API_KEY`) dans `env/api.env`, puis `docker compose -f docker/compose.yml up -d api`. Sans clé, l'application démarre mais la lecture des pièces et le courriel sont indisponibles.

Profils : `docker compose -f docker/compose.yml --profile ocr --profile sauvegarde up -d`. Pour l'OCR, mettre `OCR_URL=http://ocr:8000` dans `env/api.env`.

## Ce que le serveur partagé impose

- Les migrations créent des rôles globaux (`anon`, `authenticated`, `service_role`, `portier`, `greffier`, `malica_exploitation`, `malica_api`) : `bootstrap-db.sh` les crée avec le superutilisateur de pg-shared, par `docker exec`. Aucun secret de superutilisateur n'entre dans un fichier de Malica.
- Le propriétaire `malica` n'est ni superutilisateur ni `CREATEROLE`. Il a `BYPASSRLS` (les tables sont sous RLS forcée, les migrations sèment des référentiels) et l'option ADMIN sur `authenticated` seul, sans en hériter.
- `migrate.sh` accorde `CREATE` aux rôles `portier`, `greffier` et `malica_exploitation` le temps des migrations (`alter … owner to` l'exige), puis le retire.
- L'API se connecte en `malica_api` : membre d'`authenticated`, soumis à la RLS.

## Limites connues

- Les Dockerfiles d'`infra/` restent ceux de la CI et du déploiement (`images.yml`) : ceux de `docker/dockerfiles/` en reprennent le contenu pour l'environnement local. Une évolution à faire aux deux endroits tant que la CI n'est pas repointée.
- `restaurer.sh` (sauvegarde) crée une base : il exige un superutilisateur, absent du conteneur. Restaurer avec `pg_restore` depuis pg-shared.
- Pas de TLS en local (`DOMAINE=:80`). Avec un vrai domaine : `DOMAINE=…` dans `env/caddy.env` et ports 80/443 publiés.
