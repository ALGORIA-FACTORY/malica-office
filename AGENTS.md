# Règles d'architecture

Ces règles ne sont pas des conventions : chacune est exécutable, et la CI
échoue si elle est violée. Une règle qu'aucune commande ne vérifie n'est
qu'un souhait — le dépôt précédent en portait plusieurs, non exécutées.

## R1 — Le domaine ne connaît pas le monde

`packages/socle/` ne contient ni appel réseau, ni client de base, ni SDK de
modèle. Il reçoit des valeurs, il rend des valeurs. Les dépendances sortent
par les ports ; un seul fichier de composition sait quelle implémentation est
branchée.

_Vérifié par_ le test de pureté, et par le fait que le paquet ne déclare
aucune de ces dépendances.

## R2 — Zéro hallucination, dès la lecture

Tout montant pointe vers le token qui le porte, ou vaut `null` accompagné
d'un drapeau. Le modèle qui désigne ne voit jamais la pièce : il reçoit le
plan de tokens et ne renvoie que des `page`/`ordinal`. Les valeurs sont
relues dans le plan, jamais dans sa réponse.

Cette chaîne ne se modifie pas sans raison impérieuse.

## R3 — Malica appelle, ne calcule pas

La couche agentique n'émet aucune valeur liante. Pour tout chiffre, elle
invoque un moteur du Socle et restitue son résultat avec la citation. Le seul
artefact produit par un modèle seul est le procès-verbal de réunion, qui ne
porte aucun chiffre liant.

## R4 — Zéro constante réglementaire dans le code

Aucun taux, numéro de compte, mention obligatoire, seuil, jour d'échéance ni
code devise n'est écrit en TypeScript. Tout vit en base, versionné par date
d'effet, dans les packs de juridiction.

Corollaire : **aucun repli implicite.** Une organisation sans juridiction
renseignée lève une erreur explicite. Elle ne lit pas « tunisien » par
défaut — un référentiel silencieusement faux produit un résultat plausible,
et c'est la pire forme d'erreur.

À ne pas confondre avec R10 : un défaut LIVRÉ, visible et surchargeable, n'est
pas un repli implicite. Ce que R4 interdit, c'est la valeur qu'on ne voit pas
et qu'on ne peut pas changer.

_Vérifié par_ un test qui refuse tout littéral réglementaire dans le code de
production.

## R5 — Un seul moteur, N juridictions

Passer de la Tunisie à l'UEMOA active un pack. Cela ne forke jamais le code.

## R6 — L'isolation est portée par la base, pas par l'application

Chaque table de tenant est protégée par RLS : lecture élargie aux mandats,
écriture réservée aux membres, révocation de `public` et `anon`. Aucun chemin
utilisateur n'emprunte un rôle privilégié.

La raison est structurelle : un filtre par tenant oublié dans du code
applicatif **ouvre** l'accès ; une politique RLS oubliée le **refuse**.

_Vérifié par_ un test qui échoue dès qu'une table passe sous RLS de tenant
sans index menant par `tenant_id` — sans quoi chaque lecture parcourt la
table entière, tous tenants confondus.

## R7 — Une correction est une écriture nouvelle

Les tables d'écriture refusent toute mise à jour, par déclencheur. On ne
réécrit pas un fait comptable : on en inscrit un autre, daté. Les tenants de
test s'archivent, ils ne se suppriment pas.

## R8 — Le modèle est une donnée, pas une constante

Les noms de modèles viennent de la table qui les tarife, versionnée par date
d'effet. Changer de modèle est une ligne de migration, jamais un déploiement.
Choisir un modèle et savoir ce qu'il coûte sont la même lecture.

## R9 — Rien de mort dans le dépôt

Aucun fichier, composant ou paquet non importé. Aucun doublon d'écran, aucun
stub, aucun placeholder — un dossier vide en attente d'un futur travail est
un placeholder.

_Vérifié par_ `knip` en CI.

## R10 — Malica propose un défaut, l'expert arrête le paramétrage

Le produit livre une nomenclature, des imputations et des seuils **par défaut**.
Ce sont des valeurs de départ raisonnables, pas des vérités : elles permettent à
un cabinet de commencer le jour de son inscription, sans attendre personne.

L'expert-comptable intervient **ensuite**, au paramétrage, et c'est lui qui
arrête ce qui fait foi pour ses dossiers. Un plan comptable n'est pas une
constante universelle — deux cabinets tunisiens peuvent loger le même droit de
timbre à deux endroits, et les deux ont raison chez eux.

Trois conséquences, et la troisième est la plus contraignante :

1. **Un défaut n'est pas un blocage.** Livrer une imputation que l'expert
   changera n'est pas une faute ; ne rien livrer et attendre sa validation
   l'est, parce que le produit devient inutilisable entre-temps.

2. **Un défaut se dit.** Toute valeur réglementaire livrée par Malica est
   marquée comme telle et reste distinguable de ce que l'expert a arrêté. On
   doit pouvoir répondre à « qui a décidé ce compte » sans lire un historique.

3. **Un défaut se change sans migration.** Si l'expert doit attendre un
   déploiement pour corriger une imputation, ce n'est pas un paramétrage : c'est
   une constante avec un délai. Le paramétrage vit dans une couche par
   organisation, au-dessus du pack, et l'application résout dans cet ordre :
   ce que le cabinet a arrêté, puis le défaut du pack.

R4 n'est pas affaibli : la constante reste interdite **dans le code**. Elle est
seulement admise dans le référentiel livré, où elle est datée, versionnée et
surchargeable — c'est-à-dire là où elle cesse d'être une constante.

## R11 — Une migration donne le même référentiel, quel que soit le jour où on la joue

Le dépôt décrit une base, et une seule. La base de test et le témoin vierge
qui vérifie `ref` reposent sur cette hypothèse : deux machines qui jouent le
même dépôt à deux jours d'intervalle doivent obtenir le même référentiel.

Une migration n'écrit donc dans une donnée de référence — le schéma `ref`,
`agents.model_pricing`, `storage.buckets` — ni `current_date`, ni `now()`, ni
`current_timestamp`, ni `clock_timestamp()`, ni `random()`, ni
`gen_random_uuid()`. Une date de validité s'écrit en littéral :
`date '2026-01-01'`.

La faute a une forme cachée, et c'est la plus courante : une insertion qui
**omet** une colonne dont le défaut est daté. Rien n'est écrit, et pourtant la
date du jour entre dans le référentiel.

Ce qui reste permis : un défaut de colonne en lui-même (c'est du schéma), un
identifiant ou un horodatage laissés à leur défaut, le corps d'une fonction
(il s'exécute plus tard), et une donnée métier datée du jour.

**Défauts connus**, dans des migrations déjà appliquées, qu'on ne réécrit pas —
trouvés le 11 septembre 2026 en comparant `ref` à une base vierge
(`docs/verification-referentiel.md`) :

- `20260824132104` sème les 9 motifs de `ref.rejet_motifs` sans `valid_from`,
  dont le défaut est `current_date` ;
- `20260826163000` clôt le tarif Gemini par `effective_to = current_date` et
  date le tarif `pdf-text` du jour où on la joue.

_Vérifié par_ `db/reproductibilite.test.mjs`, dans `npm test` : il relit toutes
les migrations dans l'ordre et échoue sur toute violation autre que ces deux
exceptions, nommées une par une.

---

# Qui travaille sur ce dépôt, et qui écrit quoi

**Ceci n'est pas une règle d'architecture.** Aucune commande ne la vérifie :
c'est un protocole de travail entre deux agents, et il existe parce qu'une
collision sur l'arbre de travail fait perdre du travail déjà fait.

Deux Claude travaillent sur Malica Office, et ils ne sont pas interchangeables.

**Claude Code** — toi, si tu lis ceci depuis le terminal. Tu tiens l'arbre de
travail et tu es **le seul à y écrire**. Tu exécutes le plan de
`.superpowers/sdd/`, tu écris les épreuves, tu valides. Rien n'entre dans ce
dépôt sans passer par toi.

**Claude de la conversation** — celui avec qui le dirigeant conçoit. Il a écrit
la livraison du 18 et du 19 octobre (les 14 migrations, les quatre exécutions,
la tour, le langage visuel), et c'est **son code que tu es en train
d'éprouver**. Il lit ce dépôt en continu pendant que tu travailles.

## Ce que cela change pour toi, concrètement

**Il te relit, et il se trompe.** Les défauts que tu as trouvés dans la
livraison du 19 — le `grant usage` manquant, les vues sans `security_invoker`,
le `gardee_le` perdu par réécriture, les dix politiques sans prédicat de
tenant, la politique d'écriture qui contredisait son propre verdict — sont tous
de lui. Il les tient pour justes et il n'en conteste aucun. **Continue.** Une
livraison conçue en conversation n'a pas été exécutée ; la tienne l'est. C'est
pour cela que tu éprouves au lieu de relire.

**Réciproquement, il regarde ce qu'une épreuve ne voit pas** — un rendu, une
régression visuelle, un résidu, une incohérence entre deux documents. Il a
corrigé trois fautes de sa propre feuille `styles-pme.css` en la **rendant** à
cinq largeurs ; aucune des trois n'était visible à la lecture. Si tu trouves un
résidu qui vient de lui, supprime-le et dis-le.

## Qui a raison quand vous n'êtes pas d'accord

**Celui qui a exécuté.** Pas le plus récent, pas le plus affirmatif, pas celui
qui parle au dirigeant.

C'est une règle et pas une politesse, parce qu'elle a un relevé. Le 17 octobre,
sur les sept désaccords entre vous, **la conversation s'est trompée sept
fois** : le `grant usage on schema facturation` manquant, les dix vues sans
`security_invoker` — une fuite entre clients —, le `gardee_le` perdu par
réécriture, l'index menant, les dix politiques sans prédicat de tenant visible,
la politique d'écriture qui contredisait son propre verdict. Et sur le septième,
le `(select app.plateforme_requise(tenant_id))` qu'elle réclamait, **tu as eu
raison de ne pas la suivre** : la fonction reçoit une colonne de la ligne, elle
est corrélée, PostgreSQL ne peut pas la hisser en InitPlan. La convention du
dépôt ne portait pas sur ce cas.

Sept sur sept, et la cause n'est pas le talent : **ses preuves tournaient en
superutilisateur**, qui n'est arrêté par aucune politique. Elle vérifiait ce que
la règle dit, pas ce qu'un vrai client lit.

Donc :

1. **Une affirmation exécutée l'emporte sur une affirmation lue**, d'où qu'elle
   vienne. Une relecture, même minutieuse, même d'un modèle qui a conçu le code,
   ne vaut pas une transaction qui échoue.
2. **Tu as le droit de refuser un constat qui arrive sans reproduction.**
   « Je n'ai pas pu le reproduire » est une réponse, pas une dérobade. Exige le
   scénario : les rôles, les lignes, la commande.
3. **Si personne n'a exécuté, personne n'a encore raison.** Écrivez la commande
   qui trancherait, jouez-la, et le résultat clôt le sujet.
4. **Si vous avez tous les deux une preuve et qu'elles se contredisent**, le
   désaccord est réel : il ne se tranche pas entre vous. Il monte au dirigeant,
   avec les deux preuves côte à côte.

Des agents spécialistes — sécurité, base, UI/UX, QA — vont être lancés depuis la
conversation et produire des constats. **Ils lisent, ils n'exécutent presque
rien.** Traite-les comme des hypothèses à éprouver, pas comme des verdicts. Un
constat non reproduit qui te fait réécrire du code éprouvé est une perte nette,
et la règle 2 est là pour ça.

**L'arbre de travail est à toi.** S'il dépose un fichier non commité — cela
s'est produit avec `styles-pme.css` — vérifie-le (typecheck, build, lint,
knip), puis commite-le sous ton propre message. Ne le laisse pas traîner : un
fichier non commité dans un dépôt où deux agents travaillent est un fichier qui
disparaît.

**Ce que tu ne tranches pas seul.** Un arbitrage commercial (un prix, un
plafond, qui paie quoi) ne se décide pas au fond d'une épreuve. Tranche par
défaut pour ne pas t'arrêter, écris-le dans
`docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md`, et continue. Le
dirigeant tranche ; la conversation lui porte la question.

## Le cap, qu'aucun de vous deux ne perd de vue

L'application PME tourne **de bout en bout sur Android et sur poste de
bureau**, l'application du cabinet tourne **avec elle sans régresser**, et la
tour de contrôle d'ALGORIA Factory **les voit toutes les deux**. Tout le reste
est un moyen.
