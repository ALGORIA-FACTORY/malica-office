# La Tour — conception

*19 octobre 2026. Pour ALGORIA Factory uniquement, avec une vue restreinte
pour le design partner.*

---

## Le principe qui commande tout le reste

**La tour voit des compteurs, jamais des papiers.**

C'est une décision commerciale avant d'être technique. Le produit se vend sur
une phrase — *« le cabinet ne lit jamais ce qui ne lui a pas été transmis »* —
et son espace privé est présenté comme invisible de tous. Si l'éditeur, lui,
lit tout, la phrase est fausse, et elle est fausse de la pire façon : celle qui
ne se voit pas.

C'est aussi une position juridique. Une PME tunisienne conserve dix ans de
pièces chez un tiers ; ce tiers doit pouvoir démontrer qu'il n'y accède pas.
Et face à une administration, *« voici l'inventaire horodaté, nous n'avons pas
accès au contenu »* fait d'ALGORIA un tiers de confiance, là où *« nous avons
tout lu et voici ce que nous avons trouvé »* en fait un acteur du dossier.

### Le défaut trouvé en chemin

`app.is_platform()` figurait dans **58 politiques**, sur toutes les tables de
tenant sans distinction. Un opérateur d'ALGORIA pouvait lire les factures d'une
PME, ses écritures, et — depuis le correctif de l'espace privé — le coffre
personnel de n'importe quel collaborateur. Personne n'avait écrit ce
comportement : c'était le défaut d'un `or` posé pour l'exploitation et étendu à
tout parce que le helper est unique.

Deux niveaux maintenant, et un seul chemin entre eux :

| | portée |
|---|---|
| `app.is_platform()` | compteurs, métadonnées, journal d'audit. **Jamais un contenu.** |
| `app.plateforme_requise(tenant)` | vrai **uniquement** sous réquisition ouverte, approuvée à deux signatures, dans sa fenêtre. Se referme seule. |

> **Mesuré.** Un opérateur de la plateforme interroge `capture.pieces` sur un
> client : **0 ligne**. La même session lit `plateforme.clients_v` : **1 ligne**.

Une exception nommée : `agents.conversations` n'a jamais porté `is_platform` —
elle filtre déjà par personne. La règle y était bonne avant nous ; on ne l'a
pas touchée, et la réquisition ne s'y applique pas non plus. Une conversation
n'est pas une pièce comptable.

---

## Ce que la tour fait

### Suspendre, reprendre

La règle commerciale tient : **perdre sa licence n'arrête pas la caméra.** La
suspension arrête l'œil — `lecture_autorisee` rend `licence_suspendue` — et la
capture continue. Les pièces s'empilent, non lues, et rien n'est perdu.

Une suspension est l'acte le plus lourd de la relation : elle arrête l'outil de
travail d'un client. Elle laisse donc une trace qui dit **qui, quand, pourquoi,
et ce qui a été tenté avant** (`plateforme.interventions`, en ajout seul).
Une reprise est une écriture nouvelle, jamais l'effacement de la suspension —
et elle rend le nombre de pièces en attente, qui est le premier chiffre que le
client demandera.

> **Mesuré.** Suspension → `licence_suspendue` sur la lecture. Reprise →
> `pieces_en_attente: 1`.

### Le volume mensuel, paramétrable à deux niveaux

- **Pour tout le monde** : `ref.offres`, versionnée par date d'effet. Changer
  65 en 80 est une ligne de migration, sans déploiement, et la facture
  d'octobre reste explicable avec la grille d'octobre.
- **Pour un client** : `plateforme.accorder_lectures(licence, n, motif)`. Un
  client qui a besoin de 200 lectures sur Solo n'oblige pas à inventer une
  offre — on pose un supplément daté et motivé sur **sa** licence.

> **Mesuré.** Solo = 120 au forfait, +80 accordés → **droit total 200**.

---

## La facturation, et les trois qu'il ne faut pas confondre

| | qui facture qui |
|---|---|
| `billing.invoices` | **la PME** à ses clients |
| `collab.factures_honoraires` | **le cabinet** à ses dossiers |
| `facturation.factures` *(nouveau)* | **ALGORIA** à ses abonnés |

Les deux premières portent `tenant_id` et vivent sous RLS de tenant. La
troisième porte `licence_id` : seuls la plateforme et le titulaire la voient —
un client doit pouvoir télécharger ses propres factures sans passer par un
courriel, c'est la première chose que son comptable lui réclamera.

**Les montants sont figés à l'émission.** C'est l'exception assumée à « rien ne
se stocke qui peut se calculer » : si la grille change en mars, la facture de
février doit continuer à dire ce qu'elle disait. R7, appliqué à nos propres
ventes.

**La fiscalité vient du référentiel** (R4). Le taux est lu dans
`ref.tva_rates` (code `TVA19`, une *fraction* : 0,190000 et non 19) et le
timbre dans `ref.socle_params` — où il n'existait pas, et que cette migration
y pose avec sa référence légale. Aucun repli : si le référentiel est muet, la
fonction lève. Un `coalesce(…, 19)` serait exactement la constante que R4
interdit, et une facture émise sous un taux supposé serait fausse sans que
personne ne le voie.

> **Mesuré.** Solo → `ALG-202610-00001`, **23,610 TND TTC** — exactement le
> chiffre publié dans la grille du 17 octobre, recalculé depuis le référentiel.

**Le flux monétaire** est `facturation.flux_mensuel_v` : par mois, facturé
contre encaissé, et l'écart. L'écart est la seule colonne qui demande une
action. L'état d'une facture se **déduit** des encaissements
(`facturation.encours_v`) — un solde recalculé ne se désaccorde jamais — et un
virement rejeté est un encaissement négatif motivé, jamais un effacement.

---

## Les réclamations

Un fil, et il **doit** se fermer. Une réclamation ouverte six semaines est un
client perdu ; une réclamation fermée sans réponse écrite est un client perdu
plus lentement. La contrainte le dit : on ne peut pas poser `close_le` sans
`issue` **et** `reponse` non vide. **Fermer n'est pas répondre.**

Seule la plateforme ferme. Un client qui pourrait clore sa propre réclamation
la clorait par lassitude, et le chiffre deviendrait faux.

Le seul indicateur qui fasse changer de comportement est le **délai de
première réponse**, calculé par `plateforme.reclamations_v`. Il ne se maquille
pas.

---

## Les réquisitions des autorités

Trois portées, et elles ne coûtent pas la même chose :

| portée | ce qui sort | ce qu'il faut |
|---|---|---|
| `metadonnees` | l'inventaire horodaté et empreinté | une signature |
| `archive` | les fichiers tels que déposés, remis au client ou à qui il désigne | une signature |
| `pieces` | la lecture du contenu par un opérateur | **deux signatures**, une fenêtre, le client prévenu |

Dans l'immense majorité des cas, une recette des finances ne veut pas lire les
factures : elle veut savoir qu'elles existent, quand elles sont entrées, qui
les a déposées, et que personne ne les a réécrites. C'est de la métadonnée, et
le dépôt l'a déjà — `audit.event_log`, les empreintes SHA-256, les dates de
transmission.

`plateforme.servir_requisition` rend cet inventaire. Trois décisions dedans :

1. **L'espace privé n'y entre pas.** Une réquisition visant la société ne vise
   pas les papiers personnels de son comptable.
2. **La remise est inscrite dans le journal du CLIENT.** Il doit pouvoir
   constater, dix ans après, ce qui a été remis et à qui.
3. **Le client est prévenu par défaut.** Le silence est une décision — un
   `secret_impose` écrit par l'autorité — jamais un oubli.

> **Mesuré.** Servir sans seconde signature → refus. Après approbation →
> 1 pièce, `contenu_inclus: false`, empreinte rendue.

---

## Le moteur de notifications

L'écran de fin de capture promet : *« Je dis ce que ça coûte, une fois, et je
me tais. »* **« Une fois » est une règle technique, pas une intention.** Sans
elle, le premier incident enverra quatorze fois la même relance à un dirigeant
en déplacement — et ce dirigeant coupera les notifications, définitivement, et
pour tout le produit.

Quatre verrous, dans cet ordre, chacun disant non pour une raison différente :

| | refuse quand |
|---|---|
| **le droit** | le destinataire n'est plus membre du tenant concerné |
| **la cadence** | il a choisi *à l'échéance seulement* / *chaque matin* / *jamais*. « Jamais » veut dire jamais, y compris pour une échéance fiscale |
| **le silence** | 21 h → 7 h, **dans son fuseau**, pas celui du serveur |
| **le doublon** | la même chose, au même sujet, a déjà été remise dans la fenêtre |

> **Mesuré.** 1er envoi : posté. Même sujet : `doublon`. Autre mois : posté.
> Pendant le silence : `silence` — **mais le centre de notifications a reçu la
> ligne**. Cadence *jamais* : `cadence`. Siège révoqué : `droit_perdu`.

Deux points de conception méritent d'être dits :

**Le silence diffère le bruit, pas l'information.** Ce qui est retenu à 23 h
arrive quand même dans le centre de notifications de l'application. Et un
envoi abandonné ne compte pas comme un doublon : retenu à 23 h, il peut
repartir à 8 h.

**La décision et la remise sont deux faits.** Première écriture : `notif.envois`
portait `etat` et le travailleur devait le mettre à jour — le déclencheur R7 l'a
refusé au premier essai, et il avait raison. Un registre en ajout seul ne peut
pas noter sa propre remise. La correction n'est pas de lever R7 pour la
commodité d'un worker : c'est de séparer la **décision de poster** (une fois)
de la **remise** (tentée une fois, dix fois), et de déduire l'état. Même motif
que `facturation.encours_v`.

**Les gabarits sont des données** (R8 par analogie), versionnés par date
d'effet : on corrige une faute sans déploiement, on traduit en arabe sans
toucher au code, et une relance d'octobre reste explicable avec le texte
d'octobre.

> Un piège s'est refermé pendant l'écriture : les gabarits datés du jour de la
> migration ne sont **pas encore en vigueur** le jour où elle est jouée sur un
> poste, et `notif.poster` lève « aucun gabarit ». Ils sont datés du premier du
> mois, et la raison est notée dans la migration.

---

## Les e-mails

**Clairs, alors que l'application est sombre.** L'app est sombre parce que la
caméra s'ouvre souvent et qu'un écran blanc qui bascule au noir éblouit. Un
e-mail n'a pas ce problème : il arrive dans une boîte presque toujours claire,
et Gmail comme Outlook inversent d'autorité les fonds sombres. Un e-mail noir
n'arrive pas noir — il arrive gris sale. C'est le **même vert d'accent** qui
fait le lien, pas le fond.

Un squelette, six gabarits, produits par `design/emails/construire.py` :
invitation, plafond atteint, échéance, réponse du cabinet, facture, annonce.
Écrire six fois le même squelette de tableaux imbriqués, c'est six occasions de
le casser.

Ce qui est tenu : 600 px et 100 % en dessous · tout le CSS en attribut `style`
· une pile de polices qui finit sur Arial, parce qu'Inter ne se charge pas dans
Outlook · un préheader rempli · des boutons en cellule de tableau, 44 px,
jamais une image · `prefers-color-scheme` pour Apple Mail, les autres restant
clairs · **aucune image externe** — le logo est du texte, et une image bloquée
par Outlook ne doit jamais emporter le sens.

> **Vérifié** à 680 et 360 px sur les six : aucun débordement, aucune erreur.

---

## L'écran

`ecrans/malica-tour.html` — six vues : vue d'ensemble, clients, facturation,
réclamations, réquisitions, vue partenaire.

**La tour reprend Edition One**, la doctrine du cabinet, intacte : monochrome,
claire, coins nets, élévation par bordures. C'est un outil dense, sur grand
écran, devant des chiffres — exactement ce pour quoi cette doctrine a été
écrite. On n'invente pas un troisième langage. Seule la couleur reste un
signal, avec le même sens que dans l'app.

> **Vérifié** à 320, 360, 390, 768, 1024, 1280, 1440 et 1920 px sur les six
> vues : aucun débordement.

Deux choix d'écran qui portent une idée :

**La colonne qui compte, dans la liste des clients, est « dernier dépôt ».**
Un client qui consomme son forfait va bien ; un client qui n'a rien déposé
depuis trois semaines s'en va, et il s'en va sans rien dire.

**Les barres du flux sont côte à côte, jamais empilées.** Empilées, elles se
lisent comme une seule barre en deux segments, et l'écart — le seul chiffre qui
demande une action — devient invisible.

---

## La vue du design partner

Mondher voit **ses dossiers, et rien d'autre** : ses onze clients, les pièces
reçues, ce qui l'attend, le temps gagné. Pas les autres cabinets, pas le
chiffre d'affaires d'ALGORIA, pas les offres souscrites, pas les impayés.

Techniquement, ce n'est **pas un rôle de plus** : il voit ses dossiers parce
qu'`app.engaged_orgs()` les lui rend, exactement comme dans le SaaS cabinet, et
il n'est pas dans `app.platform_operators`. Aucune règle nouvelle, aucun risque
nouveau.

C'est aussi une position : un partenaire de conception n'est pas un associé, et
le lui montrer par l'écran vaut mieux que le lui écrire dans un contrat.

---

## Ce que cette conception ne fait pas

- **Le travailleur qui pousse** vers APNs et FCM n'est pas écrit. La base
  décide et journalise ; l'envoi lui-même est un service à part, qui lit
  `notif.envois_v` où `etat = 'a_remettre'` et inscrit par `notif.remettre`.
- **Le PDF de facture** n'est pas généré : la facture existe en base, son PDF
  est un rendu. Le squelette e-mail et le gabarit `facture` sont prêts.
- **L'export d'archive** sous réquisition (`portee = 'archive'`) renvoie
  aujourd'hui l'inventaire ; la constitution du paquet de fichiers reste à
  écrire, et elle devra passer par le coffre.
- **La relance automatique des impayés** n'est pas branchée : les gabarits et
  `facturation.encours_v` existent, l'ordonnanceur non.
