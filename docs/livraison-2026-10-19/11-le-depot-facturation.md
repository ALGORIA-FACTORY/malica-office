# Le dépôt `facturation` — ce qui manque pour que l'abonnement existe à l'écran

*17 octobre 2026. Écrit après mesure, pas après lecture.*

> **FAIT le 17 octobre au soir**, commits `ecc1025`, `9745771` et `f963be3`. Le
> dépôt `facturation` existe : `monForfait`, `sieges`, `organisations`,
> `inviterSiege`, `libererPlace`. Le contrat est passé de 195 à 200 méthodes,
> cinq lignes exactement.
>
> **Deux méthodes de ce document ne sont PAS livrées**, et volontairement :
> `cabinet.documents` et `cabinet.accuserReception`. `coffre.objects` n'a ni
> libellé, ni catégorie, ni exercice, ni action attendue ; rien n'indique qu'un
> objet vient du cabinet, et **rien n'y écrit jamais**. Les livrer exigerait
> d'inventer un schéma produit — table de dépôts, journal d'accusé, vocabulaire
> des catégories — ce qui ne se fait pas au détour d'une tâche de contrat. Voir
> `10-ce-qui-reste-ouvert.md`.
>
> Et trois choses ont été trouvées en exécutant ce que ce document demandait,
> qu'aucune lecture n'avait vues : la fonction d'invitation qu'il cite n'existe
> pas ; le plafond de sièges refusait à l'ACCEPTATION et non à l'invitation,
> donc une licence pleine distribuait des invitations qui échouent plus tard ;
> et le cabinet **ne pouvait pas répondre du tout** à une demande sur une pièce,
> le seul chemin qui fonctionnait étant l'auto-accord du dirigeant.

Ce qui suit est le constat tel qu'il a été écrit, conservé pour la trace.

## Le constat, et il est net

`contrat/rpc.json` porte vingt-et-un dépôts :

```
acces banque capture charges collab conseil conversations corpus exports
honoraires identite immo integrations journal office parametrage
referentiel signalements stocks supervision tiers
```

**`facturation` n'y est pas.** Les quatorze migrations des 18 et 19 octobre ont
posé `facturation.licences`, `facturation.lectures`, `facturation.offres`,
`lecture_autorisee`, `lecture_consommer`, `consommation_v`, `droits_v` — et
**rien de tout cela n'est atteignable depuis un écran.**

La conséquence est précise, et elle vide la grille tarifaire de son sens :

- le compteur « Lectures restantes 23 » de l'accueil n'a pas de source ;
- le « 6 lectures sur 23 » de la capture non plus ;
- les cartes verrouillées **Mes sièges · Team** et **Mes sociétés · Premium**
  ne savent pas quel forfait verrouille quoi ;
- l'écran de paramètres ne peut ni afficher le forfait, ni compter les sièges,
  ni proposer d'en ajouter un.

Autrement dit : **neuf cent quatre-vingt-seize règles de CSS et dix écrans
dessinés reposent sur un dépôt qui n'existe pas.** C'est le premier travail,
avant toute conversion d'écran.

Le Proxy client (`creerDepotHttp`) accepte n'importe quel nom de méthode à la
compilation — l'erreur n'apparaît qu'à l'exécution, chez le dirigeant. Les
écrans en cours de conversion affichent donc « — » et **n'inventent aucun
appel**. C'est délibéré, et c'est ce qui rend ce document urgent plutôt que
confortable.

## Les sept méthodes

Elles sont déjà spécifiées, avec leur forme de retour et leur source, dans
`docs/livraison-2026-10-19/05-cablage-ecran-par-ecran.md`, section « Les sept
méthodes à créer ». Je ne les recopie pas : ce document-là fait foi.

En deux mots, par ordre de blocage :

1. **`facturation.monForfait()`** — débloque à lui seul l'accueil, la capture et
   les cartes verrouillées. S'il n'y en avait qu'un, c'est celui-là.
2. **`facturation.sieges()`** et **`facturation.organisations()`** — les
   paramètres, et la vue Premium par organisation.
3. **`facturation.inviterSiege()`** et **`facturation.libererPlace()`** — les
   deux écritures. Le plafond mord **dans la base**, par le déclencheur
   `memberships_place_disponible`, jamais dans la méthode : une vérification
   côté API serait une seconde vérité, et c'est R6 qui l'interdit.
4. **`cabinet.documents()`** et **`cabinet.accuserReception()`** — la table
   `coffre.objects` existe, le dépôt non.

## Trois choses à ne pas rater

**Le contrat est gelé.** `contrat.test.ts` échoue sur toute divergence. Un
nouveau dépôt se relève par `npm run contrat` — et `contrat/rpc.json` est la
seule source de vérité des noms. Un nom approximatif dans un écran coûte une
erreur chez le dirigeant, pas à la compilation.

**L'erreur doit arriver jusqu'au composant.** Quand `lecture_consommer` refuse
parce que le plafond est atteint, l'écran doit pouvoir dire *« il vous reste 0
lecture »* et non *« erreur inconnue »*. Trace le chemin de l'erreur depuis
PostgreSQL jusqu'à React et nomme l'endroit où elle se perd aujourd'hui : une
`restrict_violation` ou un `42501` qui remonte brut est un écran muet.

**Les vues sont `security_invoker` depuis `0d671d3`.** Les exposer par RPC ne
rouvre donc pas la fuite entre clients — mais toute vue AJOUTÉE pour ce dépôt
doit l'être aussi, et l'épreuve d'architecture qui existe désormais le
vérifiera.

## Ce que ce document ne tranche pas

Deux arbitrages commerciaux attendent le dirigeant, et ils sont consignés dans
`10-ce-qui-reste-ouvert.md` : la lecture d'un expert comptée sur la licence du
client (A-1), et l'opérateur de plateforme laissé sous le plafond du client
(A-2). Les deux sont tranchés par défaut et n'empêchent pas ce travail.
