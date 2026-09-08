# Malica Office

Suite comptable augmentée pour les PME et leurs experts-comptables. La PME
photographie une pièce ; le Socle en tire l'écriture, la TVA et l'échéance ;
le cabinet supervise et tranche. Vertical de Factory Tower (Algoria Factory).

Marché initial : Tunisie — Système Comptable Tunisien, code TVA tunisien.
Extension prévue à l'UEMOA et à l'OHADA par packs de juridiction versionnés.

## Le principe fondateur — deux cerveaux

**Un chiffre qui lie relève du Socle ; un texte qui explique relève de
Malica.**

Le Socle est un ensemble de moteurs déterministes en TypeScript — lecture,
écriture, TVA, P&L, échéances, rapprochement, change. Mêmes entrées, même
sortie, toujours. Aucun modèle de langage n'y intervient.

Malica est la couche agentique. Elle perçoit, organise, rappelle et
explique — mais ne calcule jamais. Pour tout chiffre, elle appelle un moteur
du Socle et restitue le résultat avec sa citation.

Cette séparation n'est pas une préférence de style : c'est ce qui permet
d'être conversationnel et proactif à l'endroit précis — la comptabilité et le
fisc — où inventer un chiffre est interdit.

## Comment la lecture d'une pièce ne peut pas halluciner

La lecture se fait en deux passes, et la garantie tient à ce que la seconde
ne voit jamais la pièce.

**Passe 1 — le relevé.** Ce qui est écrit, mot par mot, avec sa boîte. Trois
chemins, un seul contrat de sortie :

| Pièce      | Relevé par                             | Coût                        |
| ---------- | -------------------------------------- | --------------------------- |
| PDF natif  | sa propre couche de texte (pdf.js)     | aucun — ni modèle ni réseau |
| PDF scanné | image extraite sans canvas, puis l'œil | un appel                    |
| Image      | l'œil (Qwen-VL-OCR)                    | un appel                    |

**Passe 2 — la désignation.** Le raisonneur reçoit le plan de tokens, jamais
l'image. Il ne renvoie que des couples `page`/`ordinal`. Aucun montant ne
traverse sa réponse : les valeurs sont relues dans le plan. Une désignation
qui ne correspond à aucun token devient un drapeau, jamais une valeur.

Halluciner un montant est donc structurellement impossible — ce n'est pas un
filtrage après coup.

## L'organisation du dépôt

```
apps/
  web/      l'application — PME et cabinet, React + Vite
  api/      Express + pg — remplace PostgREST et GoTrue
packages/
  socle/    les contrats, les moteurs, les ports et le dictionnaire — partagés
db/
  migrations/ le schéma : la source de vérité, rejouée telle quelle
  local/      la couche d'authentification et de rôles, rejouable
  corpus/     le chargement du corpus juridique, qui s'alimente à part
  dev/        le jeu d'essai : un cabinet, deux dossiers, de quoi voir
docs/       maquettes et marque
```

Un espace de travail npm, une seule règle de style à la racine. `packages/socle`
est né le jour où l'API est devenue le second consommateur des moteurs : la
lecture citée et Malica y tournent désormais, à côté de l'application. Le
paquet ne se compile pas — Node en décape les types, Vite les résout — et il ne
déclare que `decimal.js` et `zod`.

## Démarrer

Prérequis : Node.js 22 et PostgreSQL 17 (ou 16).

```bash
npm ci
npm run dev        # l'application, sur le port 8080
npm run dev:api    # l'API, sur le port 3000
```

La coque Android — le bundle embarqué, puis le projet `android/` synchronisé :

```bash
npm run coque:staging   # build:coque:staging, puis cap sync android
npm run coque:ouvrir    # Android Studio sur android/
cd android && ./gradlew assemblePiloteDebug -PversionName=0.1.0   # un APK de débogage, sans Android Studio
```

Voir [docs/coque-native.md](docs/coque-native.md) pour l'outillage (JDK 21,
SDK), et [docs/exploitation.md](docs/exploitation.md) pour les serveurs.

Copiez `.env.example` en `apps/web/.env` et `apps/api/.env`, puis renseignez
les valeurs. Aucun `.env` n'est suivi par git.

Les trois portes que la CI exécute à chaque poussée :

```bash
npm run lint       # tout le dépôt
npm run typecheck  # les deux applications
npm test           # les deux applications
```

Copiez `.env.example` en `.env` et renseignez les valeurs. Le fichier `.env`
n'est jamais suivi par git.

### Base de données locale

Le schéma se rejoue depuis les migrations du dépôt — aucune donnée client
n'est copiée depuis un environnement distant. Le référentiel fiscal, lui,
est semé par les migrations : la base locale est fonctionnelle telle quelle.

```bash
$env:PGPASSWORD = '<mot de passe local>'
powershell -File db/local/charger.ps1 -Recreate
```

Un PostgreSQL nu ne connaît ni `auth.uid()`, ni les rôles `authenticated` et
`service_role` dont dépendent les politiques RLS : `db/local/` les recrée
avec la même sémantique.

## Ce qui gouverne le code

Les règles d'architecture sont dans [AGENTS.md](AGENTS.md). Elles ne sont pas
des conventions : chacune est exécutable, et la CI échoue si elle est violée.
