# Les quatre exécutions qui manquaient

*19 octobre 2026. Code dans `code/`, éprouvé contre la base réelle.*

Une commande les rejoue toutes :

```bash
DATABASE_URL="postgresql://…/malica_local" \
  node --experimental-strip-types code/essai-executions.ts
```

---

## 1 · Le PDF d'une facture — `code/facturation/pdf-facture.ts`

**Sans aucune dépendance.** Une librairie PDF pèse de six à quarante
mégaoctets pour produire une page de texte et deux filets ; ce fichier en fait
250 lignes et produit un PDF 1.4 que tous les lecteurs ouvrent depuis vingt
ans. R9 : une librairie de cette taille pour ce besoin serait du mort dans le
dépôt.

Deux pièges rencontrés, et tenus :

**Le PDF de base n'est pas en UTF-8.** Les polices Helvetica sont en WinAnsi :
« é » s'y écrit sur un octet, pas deux. Sans la table de conversion,
« échéance » s'affiche « Ã©chÃ©ance » — ce qu'on remarque sur une facture et
nulle part ailleurs.

**« le 1er novembre », pas « le 1 novembre ».** C'est la seule irrégularité de
la date en français, et une facture qui l'ignore se remarque.

Le module **met en page, il ne compte pas**. Les montants arrivent figés depuis
`facturation.factures` et les lignes depuis `facturation.facture_lignes`. Il
n'a donc aucun test d'arithmétique, seulement un test d'octets.

> **Mesuré.** `ALG-202610-00006` — 29,000 + 16,000 = 45,000 HT, TVA 8,550,
> timbre 1,000, **54,550 TTC**. **3 007 octets.** Rendu et relu à l'écran.

> **Reste ouvert** : l'arabe. Les polices de base du PDF ne le portent pas ;
> une facture en arabe demandera une police embarquée, donc une librairie ou
> cent lignes de plus. Ce choix se reverra sur une mesure, pas sur une
> préférence — aujourd'hui la facture d'ALGORIA est en français.

## 2 · L'ordonnanceur des impayés — `code/facturation/ordonnanceur.ts`

Quatre marches, dont les jours viennent du référentiel (R4) :
`rappel` J+3 · `relance` J+10 · `avis_de_suspension` J+20 · `suspension` J+30.
« Trente jours » est une politique commerciale, elle changera, et elle ne vit
pas dans un `if`.

**Chaque marche n'est franchie qu'une fois** : la clé de dédoublonnage est le
couple *facture + palier*, jamais le jour.

**L'ordre compte** : on suspend **avant** de poster le message de suspension.
Si la suspension échoue, le client ne reçoit pas un message qui lui annonce un
état qu'il n'a pas — c'est la seule façon de perdre sa confiance entièrement,
et d'un coup.

Le ton monte sans jamais devenir comminatoire. Un client en retard de trente
jours est le plus souvent débordé, pas mauvais payeur, et le message de
suspension tient la promesse du produit : *« Continuez à photographier :
{{en_attente}} pièces vous attendent déjà, et je les lirai toutes dès le
règlement. »*

> **Mesuré.** J+4 → `rappel`. J+12 → `relance`. J+22 → `avis_de_suspension`.
> J+33 → `suspension`, licence suspendue. **Seconde passe au même palier :
> 0 postée, 1 déjà dite.**

### La faute que cette épreuve a trouvée

Première écriture : le dédoublonnage de `notif.poster` ne regardait que les
envois **remis**. Un ordonnanceur qui tourne toutes les heures reposait donc la
même relance vingt-quatre fois avant que le travailleur n'en ait poussé une
seule — et le client recevait vingt-quatre courriels d'un coup. C'est
exactement la boucle que *« une fois, et je me tais »* existe pour empêcher.

La correction : un envoi **décidé mais pas encore poussé** compte comme déjà
dit. Un envoi **abandonné** (silence de 23 h, cadence) ne compte pas — retenu à
23 h, la même chose doit pouvoir repartir à 8 h.

## 3 · Le travailleur qui pousse — `code/notif/travailleur.ts`

**Il ne décide rien.** Les quatre verrous sont dans la base ; ce module lit ce
qui est à remettre, appelle le service du téléphone, inscrit ce qui s'est
passé. Le service de push est un **port** (R1) : en production il parle à FCM
et à APNs, dans les épreuves il compte les appels — c'est la seule raison pour
laquelle il peut être testé du tout.

Trois résultats, et le troisième est le plus important : `refuse` n'est pas une
panne, c'est une information. Le jeton est mort, `notif.remettre` le révoque
dans la foulée — un appareil disparu qu'on continue d'appeler fait monter le
taux d'échec chez APNs et finit par faire refuser tout le domaine.

Recul exponentiel, 1 → 32 minutes, six tentatives. Un échec à 3 h du matin n'a
aucune raison d'être réessayé à 3 h 01, et mille échecs réessayés ensemble sont
un déni de service qu'on s'inflige.

Un envoi n'arrête jamais les autres : ce qui lève, c'est ce qui empêche de
continuer — la base injoignable, par exemple.

> **Mesuré.** Passe 1 : 5 lus, 1 échoué (503 simulé), 4 remis. Passe 2 à
> +5 min : l'échoué repasse, **remis après 1 tentative**.

## 4 · Le paquet d'archive — `code/plateforme/archive.ts`

Un zip **sans compression** (méthode « stored »), écrit à la main. Les pièces
sont des JPEG et des PDF déjà compressés ; les comprimer à nouveau coûte du
temps et ne gagne rien. Et un zip stocké se relit avec n'importe quoi — **y
compris un script de dix lignes écrit par la partie adverse**, ce qui est tout
l'intérêt.

Ce qui rend le paquet opposable :

**Un `MANIFESTE.txt` en tête**, lisible par un humain, qui porte pour chaque
fichier son empreinte SHA-256 **telle qu'elle était en base au dépôt** — pas
recalculée à la constitution. Si les deux divergent, le manifeste **le dit**.
Un paquet qui tait une divergence n'est pas un paquet d'archive, c'est une
déclaration, et elle serait fausse.

**L'empreinte du paquet entier**, inscrite dans `plateforme.archives` et portée
au procès-verbal de remise. N'importe qui la recalcule, y compris contre nous.
C'est la différence entre *« faites-nous confiance »* et *« vérifiez »*.

Les dates MS-DOS du zip sont figées au 1er janvier 1980 : la date qui fait foi
est celle du manifeste et de la base, pas celle qu'un système de fichiers aura
réécrite en chemin.

> **Mesuré.** 3 pièces + manifeste, 1 869 octets, `unzip -t` : *No errors
> detected*. Une pièce volontairement altérée → **le manifeste la signale**,
> avec les deux empreintes côte à côte.

---

## Où ce code va dans le dépôt

| ici | là-bas |
|---|---|
| `code/facturation/pdf-facture.ts` | `apps/api/src/facturation/` |
| `code/facturation/ordonnanceur.ts` | `apps/api/src/facturation/` |
| `code/notif/travailleur.ts` | `apps/api/src/notif/` |
| `code/plateforme/archive.ts` | `apps/api/src/plateforme/` |
| `code/essai-executions.ts` | à découper en épreuves `node:test`, une par règle |

Les quatre modules sont **purs au sens de R1** : aucun n'ouvre de socket,
aucun ne lit l'horloge sans qu'on le lui passe. Ce sont leurs adaptateurs —
FCM, APNs, le coffre — qui touchent le monde, et ils se branchent au montage.

## Ce qu'il reste, et qui n'est pas du code

- **Les clés APNs et FCM**, et le compte expéditeur du courriel. Le port est
  écrit, l'adaptateur de production attend des secrets.
- **L'ordonnanceur doit être appelé.** Une fois par jour pour les relances,
  une fois par minute pour les pushs. C'est une ligne de cron ou un conteneur
  de plus dans `infra/compose.yml`, selon ce que l'exploitant préfère.
- **Le coffre doit rendre les octets** d'une pièce pour la constitution de
  l'archive. La fonction les prend en argument ; le lecteur de coffre existe
  déjà côté API et reste à brancher.
