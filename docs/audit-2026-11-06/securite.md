# Audit de sécurité — 6 novembre 2026

Audit avec reproductions, sans correction. Branche `audit/securite`, partie de
`claude/mission-production-ready` (eb004c1c). Base jetable `malica_securite`
(PostgreSQL 17 local), migrée par `node db/migrer.mjs --base <url>` **sans**
`--mot-de-passe-api` : 355 migrations jouées. Les épreuves tournent sous le rôle
de connexion `malica_api`, en `set local role authenticated` avec les claims que
pose `db.ts` — jamais en superutilisateur. L'API est montée en local
(`app.listen(0)` sur `app.ts`) pour les épreuves HTTP. Aucun appel réseau vers
un tiers, ni staging ni production.

Les sociétés d'essai viennent de `monterUneSociete` (`circuit-d-essai.ts`) :
une PME (Amel et Bilel dirigeants, Sami et Sonia collaborateurs), un cabinet
(Kamel, expert) sous mandat actif. Une pièce de Sami passe par le propriétaire
au cabinet, qui l'inscrit (`priseEnCharge`) : il existe une écriture `booked`.

Aucune valeur secrète n'apparaît dans ce document : les mots de passe et clés
sont nommés par fichier et ligne, masqués.

## Constats reproduits, par gravité

### S1 — HAUTE · XSS stockée par le type de contenu d'une pièce

`capture.enregistrer` accepte n'importe quel `contentType` ; la route
`GET /pieces/:id/contenu` le rend tel quel en `Content-Type`, sans
`Content-Disposition: attachment`, sur la **même origine** que l'application
(Caddy route `/pieces/*` vers l'API ; `infra/caddy/Caddyfile:19-21`). La CSP de
Caddy ne borne pas les scripts (`Caddyfile:43`), et `nosniff` n'y peut rien : le
type est déclaré `text/html`. Un siège de la PME dépose une page ; quiconque
l'ouvre (le dirigeant, l'expert du cabinet une fois la pièce transmise) exécute
son script avec sa session : il appelle `/rpc` comme lui — chez l'expert, sur
tous ses dossiers. Un lien suffit : le cookie `SameSite=Lax` suit une
navigation de premier niveau.

- `apps/api/src/stockage.ts:388-391` (le type vient de la base, sans liste) ;
  `apps/api/src/depots/capture.ts:342` (aucune borne sur `contentType`) ;
  `db/migrations/20260830130000_capture_type_de_contenu.sql:11` (colonne `text`
  libre).
- Reproduction (`r4-http.ts`, API réelle) :
  1. `POST /rpc {"depot":"capture","methode":"enregistrer","args":[{"tenantId":<pme>,"source":"photo","vis":"entite","idempotencyKey":"xss-…","contentType":"text/html","pageCount":1}]}` sous Sami → **200**, pièce créée ;
  2. `POST /pieces/<id>/contenu` corps `<html><body><script>fetch('/rpc',…)</script>` → **201** (scellée) ;
  3. `GET /pieces/<id>/contenu` sous Sami puis sous Amel → **200**,
     `content-type: text/html`, `content-disposition: null`,
     `content-security-policy: null`, corps `<html><body><script>fetch('/rpc'…`.
  4. `contentType: "image/svg+xml"` est accepté aussi (**200**).
- Correctif minimal et universel : une liste blanche des types de pièce dans la
  porte (`image/jpeg|png|webp|heic`, `application/pdf`) et une contrainte en
  base ; au dépôt, refuser des octets dont la signature ne correspond pas au
  type ; au service (pièces **et** exports), toujours
  `Content-Disposition: attachment` hors images, plus
  `Content-Security-Policy: sandbox; default-src 'none'` et
  `X-Content-Type-Options: nosniff` sur `/pieces/*/contenu` et
  `/exports/*/contenu`.

### S2 — HAUTE · La PME lit les écritures comptables

La règle « la PME ne voit jamais les écritures » n'est pas tenue : la politique
`socle_ecritures_sel` ouvre `socle.ecritures` à `orgs_avec_droit('societe.tout_voir')`
— droit que porte le **dirigeant de PME** (`ref.droits_des_roles`) — et à tout
membre pour une pièce qu'il lit (`piece_lisible`, donc l'**auteur** de la
pièce, même collaborateur). `socle_ecriture_lignes_sel` suit. Les méthodes RPC
`office.ecrituresForPiece`, `office.ecrituresByIds`, `office.periodeLignes` ne
filtrent rien de plus (`apps/api/src/depots/office.ts:1109-1179`) et sont
servies à tout appelant. L'épreuve `la-matrice-des-droits.test.ts:137-150`
annonce « le comptable seul » mais ne vérifie que Sonia.

- Reproduction (`r1-isolation.ts`) — après `priseEnCharge` d'une pièce de Sami :
  - SQL sous identité : `select count(*) from socle.ecritures where tenant_id = <pme>`
    → **1** pour Amel, Bilel (dirigeants) et Sami (collaborateur auteur) ;
    `socle.ecriture_lignes` → **2** pour chacun.
  - `/rpc office.ecrituresForPiece(<piece>)` (origine `client`) → **1 écriture**
    pour Amel, Bilel, Sami.
  - `/rpc office.ecrituresByIds([<ecriture>])` → l'écriture et ses lignes
    (`accountCode 601, debit 100.000, taxCode EXO…`) pour les trois.
  - `/rpc office.periodeLignes(<pme>, 2026-01-01, 2026-12-31)` → **2 lignes**
    (journal ACH, comptes 601/401, montants) pour les trois.
  - `/rpc supervision.auditForPiece(<piece>)` → l'événement `ecriture.booked`
    avec l'identifiant du comptable pour les trois.
- Correctif minimal : la lecture des écritures se réserve au cabinet en base —
  `socle_ecritures_sel` et `socle_ecriture_lignes_sel` ne gardent que
  `engaged_orgs()`, la plateforme réquisitionnée et le cabinet lui-même
  (`org_kind = 'cabinet'`), plus aucune branche `member_orgs()` /
  `orgs_avec_droit()` côté PME. Ce que l'accueil de la PME consomme
  aujourd'hui (`apps/web/src/hooks/use-accueil.ts:194` appelle
  `periodeLignes`) passe par une porte d'**agrégats** (totaux par classe et par
  mois), jamais par les lignes. Ajouter Amel, Bilel et Sami à l'épreuve de la
  matrice.

### S3 — MOYENNE · Une clé d'API survit au départ de son auteur

`public.api_key_resoudre` ne vérifie que l'empreinte, la révocation et
l'archivage de l'organisation ; `app.member_orgs()` rend `api_tenant` sans
vérifier que `sub` (l'auteur) est encore membre. Un expert qui quitte le cabinet
garde l'accès par la clé qu'il a créée.

- Reproduction (`r5-cles.ts`) : l'expert crée une clé
  `["ecritures.lire","pieces.deposer"]` sur son cabinet (**200**) ; on retire son
  adhésion (`delete from identity.memberships …` → 0 adhésion restante) ;
  `capture.enregistrer` **par la clé** → **200** (pièce créée) ; le même geste
  par sa **session** → **400** `refus.geste.non_permis`.
  (Une PME ne crée pas de clé : `refus.cle_api.cabinet_seulement`, vérifié.)
- Correctif : dans `api_key_resoudre`, exiger que `created_by` soit encore membre
  du cabinet avec un rôle qui crée des clés ; à la sortie d'un membre, révoquer
  ses clés (déclencheur sur `identity.memberships`).

### S4 — MOYENNE · Le jeton d'accès ne se révoque pas

Le JWT d'accès (12 h, `apps/api/src/auth.ts` `DUREE_JETON`) n'a ni identifiant
ni liste de révocation. La déconnexion efface le cookie et révoque le jeton long ;
la réinitialisation du mot de passe révoque les jetons longs — le jeton d'accès
déjà émis reste valable jusqu'à 12 h (téléphone perdu, session volée).

- Reproduction : `POST /auth/deconnexion` avec le cookie de Bilel, puis
  `GET /moi` avec le **même** jeton en `Authorization: Bearer` → **200**.
- Correctif : un `jti` et une date `iat` comparée à
  `auth.users.sessions_invalidees_le` (posée à la déconnexion « partout » et à la
  réinitialisation) ; ou une durée d'accès courte (15 min) puisque le jeton long
  existe déjà.

### S5 — MOYENNE · Identifiants d'essai et mot de passe local dans le dépôt

- `outils/comptes-de-parcours.json:3` : le mot de passe (en clair, 17 car.) des
  comptes de parcours, dont le dirigeant `contact@sotumag.tn` que
  `docs/etat-staging.md:40` et `docs/protocole-appareils.md:29` disent présent
  **sur le staging**. Quiconque lit le dépôt ouvre ce compte de staging (non
  essayé : hors périmètre).
- `docs/prompts-claude-code-vague-1.md:59` : la valeur de `MALICA_API_PASSWORD`
  y est **identique** au mot de passe de `malica_api` de ce poste (comparaison
  faite sans affichage). Ligne 58 : un mot de passe `PGPASSWORD` (différent de
  l'actuel).
- `docs/etat-des-lieux-2026-09-11.md:251` : l'identifiant réel de la Storage Box
  de sauvegarde (`u66…`) et son port.
- CI (`ci.yml:108,141-150,168-179`, `android-e2e.yml:91-104`,
  `epreuve-reelle.yml:39-52`) : mots de passe de bases jetables et `JWT_SECRET`
  de CI en clair — déjà connus (E8), sans portée hors CI. Aucune clé privée, clé
  de fournisseur (DeepSeek, Qwen, Brevo, Sentry, AWS, Google, GitHub) ni JWT
  signé trouvé, **sur les 255 branches distantes** (balayage `git grep` par
  motif ; témoin positif vérifié).
- Correctif : retirer ces valeurs de l'arbre, tourner le mot de passe des
  comptes de parcours du staging et lire celui-ci depuis l'environnement ;
  tourner `malica_api` de ce poste ; masquer l'identifiant de la Storage Box. La
  purge de l'historique est une décision à part.

### S6 — BASSE · Du texte technique part vers l'écran

Règle produit : aucun texte technique à l'écran (R12). Trois chemins le laissent
passer :

- `apps/api/src/rpc.ts:221` : la tour lève un message français brut avec le
  code `42501` → `POST /rpc {"depot":"tour","methode":"licences"}` sous Sami →
  **400** `{"erreur":"La tour est réservée aux opérateurs d'ALGORIA."}`.
- `apps/api/src/rpc.ts:201,210` : `RpcIntrouvable` renvoie le nom reçu →
  `{"depot":"<b>x</b>"}` → **404** `{"erreur":"dépôt inconnu : <b>x</b>"}` ;
  `capture.persisterLecture` → `méthode inconnue : capture.persisterLecture`
  (et confirme qu'une méthode réservée existe, que le commentaire dit taire).
- `apps/api/src/refus.ts:176` : à défaut de clé, le message
  brut de PostgreSQL est rendu (`?? message`) pour les codes de la liste.
- Correctif : la tour lève `refus.reserve.plateforme` ; `RpcIntrouvable` rend
  une clé fixe (`refus.introuvable`) sans écho ; `refusLisible` ne rend qu'une
  clé `refus.*` et journalise le reste.

### S7 — BASSE · Oracles d'existence entre tenants

Fonctions `security definer` ouvertes à `authenticated` qui répondent sur un
identifiant d'un autre tenant (`r2-definer.ts`, 256 fonctions appelées par
l'expert et le dirigeant de A avec les identifiants de B, comparées à un uuid
inconnu, tout annulé) :

- `app.piece_connue_du_cabinet(<pièce de B>)` → `true` (inconnu → `false`) ;
- `facturation.licence_de(<pme B>)` → l'identifiant de la licence de B ;
- `jour_du_dossier(<pme B | cabinet B>)` → la date (inconnu → `refus.fuseau.non_defini`) ;
- `app.relecture_de_nuit(p_dossier)` (main, 20261130230000) : ouverte à
  `authenticated`, lit le réglage de nuit de n'importe quel dossier.

Aucune donnée métier (montant, nom, pièce) ne sort ; il faut connaître l'uuid.
Correctif : `revoke execute … from authenticated` pour les fonctions internes
appelées seulement par d'autres définisseurs, ou une garde
`p_tenant in (select app.member_orgs() union select app.engaged_orgs())`.

### S8 — BASSE · Débit, journal d'atelier, en-têtes

- Aucune limite sur `/rpc` ni `/malica` : 150 appels `/rpc` en rafale → 150 ×
  **200**. Les gestes coûteux (lectures par modèle) sont bornés par le quota,
  pas par le débit. Correctif : une limite par utilisateur sur `/rpc` et
  `/malica`.
- `POST /journal-atelier` sans identité → **204** et écriture disque, hors
  production (`app.ts`, `NODE_ENV !== "production"`). `infra/compose.yml:129`
  pose bien `production` : seul un poste ou une image mal réglée l'expose.
  Correctif : l'exiger derrière `exigerIdentite`, ou n'écouter qu'en loopback.
- `GET /sante/profonde` public : version servie (`0.2.101`) et état de l'OCR ;
  `X-Powered-By: Express` sur toutes les réponses. Correctif :
  `app.disable("x-powered-by")`, version derrière une identité ou retirée.

### S9 — BASSE · Coque Android : mise à jour à chaud non signée, jeton long en clair

- `apps/web/capacitor.config.ts` : `CapacitorUpdater.autoUpdate: true` sans
  `publicKey` : l'intégrité du JavaScript livré à chaud repose sur le seul compte
  Capgo. Correctif : chiffrement/signature de bout en bout de Capgo
  (`publicKey`), clé privée hors dépôt.
- `apps/web/src/lib/transport/jetons.ts` (`coffrePreferences`) : le jeton de
  30 jours est rangé dans `@capacitor/preferences` (SharedPreferences, en
  clair dans le bac à sable), pas dans le Keystore. `allowBackup="false"` limite
  l'exposition. Correctif : stockage chiffré adossé au Keystore.

### S10 — BASSE · Jeux d'essai : noms qui peuvent être réels

`outils/jeu-de-donnees.mjs:106` et `outils/comptes-de-parcours.json:4` :
« SOTUMAG SARL », `contact@sotumag.tn` ; aussi `bensalah.tn`, `ddt.tn`,
`medina-textile.tn`… et deux adresses `@gmail.com` (`yasmine.khemiri.design`,
`papeterie.nour`). Sotumag est le nom d'une entreprise tunisienne existante ; le
caractère réel n'est pas vérifié (pas d'appel réseau). Aucun RIB à 20 chiffres ni
CIN identifié. Correctif : domaines réservés (`.test`, `.example`) et raisons
sociales inventées, ALGORIA FACTORY seule exceptée.

### S11 — BASSE · « La coque ne vend rien » ne regarde que les noms de méthodes

`npm run build:coque:staging -w @malica/web` puis `node outils/coque-sans-commerce.mjs`
→ « 26 méthodes absentes de 182 scripts » (exit 0) ; la garde serveur
(`app.ts`, 403 pour une coque) et les logos retirés (`vite.config.ts`) tiennent.
Mais le paquet porte encore les catalogues de messages de paiement :
`assets/messages-*.js` contient « Payer en ligne » et « ClicToPay ». Aucune
bibliothèque de facturation native (`billing`, `com.android.vending`) dans
`android/`. Correctif : charger les espaces `pme.reglages.paiement.*` et
`tour.paiement.*` hors du paquet de la coque et étendre la garde aux clés de
messages.

### S12 — INFO · `/exports/*` n'est pas routé vers l'API par Caddy

`infra/caddy/Caddyfile:19-21` ne nomme pas `/exports`, que `app.ts` sert
(`GET /exports/:id/contenu`) et que l'écran appelle
(`adapters/http/journal-du-jour.ts:25`) : derrière Caddy, la requête part au
serveur web. Défaut fonctionnel ; le correctif S1 doit couvrir cette route
quand elle sera routée.

## Non reproduit — ce qui a tenu

- **Lecture entre tenants** : 193 tables portant une colonne de tenant
  (`tenant_id`, `cabinet_tenant_id`, `client_tenant_id`, `pme_org_id`…),
  lues par Amel, Bilel, Sami et l'expert de A avec un filtre sur les tenants de
  B → **0 ligne partout** (3 tables refusées par droit).
- **Écriture sans porte** : `update socle.ecritures` de B par l'expert de A,
  `update capture.pieces`, `insert into identity.memberships` dans B,
  `delete from socle.ecritures` → **refusé** (« droit refusé pour la table … »).
- **Claims forgés** : `service=relecteur_de_nuit` avec le `sub` d'une personne
  et la marque serveur → `app.service()` nul, 0 pièce de B ; `api_tenant` du
  cabinet B sous l'expert de A → 0 écriture de B. Les claims ne se posent que
  par SQL : aucune injection trouvée pour les poser. (La base croit
  `api_tenant` sans vérifier l'adhésion : c'est S3 vu de l'intérieur.)
- **Relecteur de nuit** (20261118100000, 20261118110000, 20261127290000–310000,
  et main 20261130230000) : sous ses vrais claims (`sousLeRelecteurDeNuit`), il
  ne voit que la pièce due (1), ni l'autre pièce du dossier, ni écriture, ni
  adhésion ; 282 fonctions `security definer` appelées avec la PME, le cabinet,
  la pièce due et une autre pièce → **une seule écriture réussie** :
  `lecture_refusee_inscrire(<pièce due>)` → `audit.event_log`, sur la pièce
  qu'il relit. Refus `refus.service.hors_perimetre` ×58. La migration de main
  ne change que la date de lecture du réglage (aucun droit ajouté). Limite : les
  arguments `jsonb` ont été passés vides.
- **Injection SQL** : toutes les valeurs passent par paramètres `$n` ; les
  interpolations (`office.ts:320-328`, `parametrage.ts:545`, `scan/analyse.ts:667`)
  ne portent que des constantes ou des `$n`.
- **SSRF** : `OCR_URL`, `QWEN_BASE_URL`, l'URL DeepSeek ne viennent que de
  l'environnement ; aucune URL n'est prise d'une saisie.
- **JWT** : `alg: none` → 401 ; signature retirée → 401 (jsonwebtoken 9.0.2).
- **CORS** : origine `https://evil.example` → aucun `Access-Control-Allow-Origin`.
- **Contournement du débit de connexion par `X-Forwarded-For`** : 35 essais
  avec un XFF tournant passent sur l'API **nue** (`trust proxy 1`), mais l'API
  n'est pas publiée (`infra/compose.yml` : seuls 80/443 de Caddy) et Caddy
  remplace l'en-tête venu d'un client non approuvé : non exploitable en
  production.
- **Traversée de chemin** dans `STOCKAGE_RACINE` : identifiants filtrés en uuid
  et chemin résolu contrôlé sous la racine (`stockage.ts:71-89`) ; taille
  bornée à 40 Mo par l'API et par Caddy (lecture de code, envoi de 40 Mo non
  joué).
- **Android** : seule l'activité de lancement est exportée ; `FileProvider`
  non exporté ; texte en clair autorisé dans la seule saveur `emulateur`
  (`android/app/src/emulateur/AndroidManifest.xml`) ; `debuggable` jamais posé
  en release ; `allowBackup="false"`.
- **RBAC tour** : un non-opérateur est refusé sur tout le dépôt `tour`
  (lectures comprises) — le refus est juste, son texte est S6. Les méthodes
  réservées au serveur répondent 404 au client.

## Comment rejouer

Les scripts sont restés hors du dépôt (`.audit-tmp/`, R9) ; chacun tient dans
les commandes ci-dessus. Le montage : créer `malica_securite`, jouer
`node db/migrer.mjs --base <url d'administration sur malica_securite>`, puis
lancer un script `node --experimental-strip-types` avec `DATABASE_URL`
(`malica_api`) et `DATABASE_URL_ADMIN` pointés sur `malica_securite`, qui
appelle `monterUneSociete` et parle soit en SQL sous `sousIdentite`, soit en HTTP
à `app.listen(0)`.
