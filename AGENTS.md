# Règles d'architecture

Ces règles ne sont pas des conventions : chacune est exécutable, et la CI
échoue si elle est violée. Une règle qu'aucune commande ne vérifie n'est
qu'un souhait — le dépôt précédent en portait plusieurs, non exécutées.

## R1 — Le domaine ne connaît pas le monde

`packages/socle/` ne contient ni appel réseau, ni client de base, ni SDK de
modèle. Il reçoit des valeurs, il rend des valeurs. Les dépendances sortent
par les ports ; un seul fichier de composition sait quelle implémentation est
branchée.

*Vérifié par* le test de pureté, et par le fait que le paquet ne déclare
aucune de ces dépendances.

## R2 — Zéro hallucination, dès la lecture

Tout montant pointe vers le token qui le porte, ou vaut `null` accompagné
d'un drapeau. Le modèle qui désigne ne voit jamais la pièce : il reçoit le
plan de tokens et ne renvoie que des `page`/`ordinal`. Les valeurs sont
relues dans le plan, jamais dans sa réponse.

Cette chaîne ne se modifie pas sans raison impérieuse.

## R3 — Regalica appelle, ne calcule pas

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

*Vérifié par* un test qui refuse tout littéral réglementaire dans le code de
production.

## R5 — Un seul moteur, N juridictions

Passer de la Tunisie à l'UEMOA active un pack. Cela ne forke jamais le code.

## R6 — L'isolation est portée par la base, pas par l'application

Chaque table de tenant est protégée par RLS : lecture élargie aux mandats,
écriture réservée aux membres, révocation de `public` et `anon`. Aucun chemin
utilisateur n'emprunte un rôle privilégié.

La raison est structurelle : un filtre par tenant oublié dans du code
applicatif **ouvre** l'accès ; une politique RLS oubliée le **refuse**.

*Vérifié par* un test qui échoue dès qu'une table passe sous RLS de tenant
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

*Vérifié par* `knip` en CI.
