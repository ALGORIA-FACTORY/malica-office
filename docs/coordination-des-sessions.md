# Coordination des sessions de travail

Deux sessions Claude travaillent dans ce dépôt en même temps, pour la même
personne. Ce fichier est leur point de rencontre : qui touche quoi, ce que
chacune doit faire avant de rendre, et un journal court. Il se lit AVANT de
modifier, il se met à jour APRÈS.

## La règle qui prime

Rien ne se rend rouge. Avant de rendre la main — et après tout changement
qui touche un fichier partagé — chaque session lance la porte :

```bash
npm run verifier
```

Typage de tous les espaces de travail, lint, tous les tests, puis les
épreuves de bout en bout contre l'application vivante (8080). Une étape
rouge se corrige avant de rendre, même si elle est dans le périmètre de
l'autre : on ne laisse pas l'autre découvrir la casse. `npm run verifier --
--vite` saute les épreuves quand les serveurs ne tournent pas.

## Les périmètres

Session « application Android PME » (regalica-office-72) :

- `packages/socle/**`
- `apps/api/src/regalica/**`, `apps/api/src/regalica.ts`, `apps/api/src/{app,session,stockage}.ts`
- `apps/web/src/lib/**` (les fonctions serveur migrent vers l'API), `apps/web/src/verticals/**`, `apps/web/relais-api.ts`
- routes `pme.fiche`, `pme.piece.$pieceId`, `cabinet.clients`, `cabinet.conseil`, `cabinet.pilotage`, `cabinet.pv`
- `components/regalica/RegalicaChat.tsx`, `hooks/use-synthese-client.ts`

Session « cabinet et moteurs » (regalica-office-33) :

- `apps/web/src/routes/_authenticated/cabinet.tsx` (rail, panneau), `cabinet.reglages`, `cabinet.echeances`, `cabinet.dossier.$clientId`, `cabinet.index`, `cabinet.honoraires`, `cabinet.facture.$factureId`, `cabinet.export`, `cabinet.mise-en-route`, `cabinet.notifications`, `cabinet.propositions`, `cabinet.rapprochement`, `cabinet.immobilisations`, `cabinet.stocks`, `cabinet.plan`, `cabinet.piece.$pieceId`
- routes `pme.index`, `pme.echeances`, `pme.notifications`, `office`
- `components/regalica/{panneau-cabinet,integrations-panel,MandatsProposes,InvitationsPourMoi,panneau-regalica}.tsx`
- `apps/api/src/depots/**` (sauf ce que l'autre session déplace vers `regalica/`), `apps/api/src/rpc.ts`, `apps/api/src/cles-api.ts`
- `db/migrations/**`, `outils/**`, `apps/web/src/i18n/messages.ts`

Un fichier hors de ces listes se prend après l'avoir dit ici (journal).

## Les fichiers partagés

`messages.ts`, `ports/repositories.ts`, `composition.ts`, `rpc.ts`,
`depots.test.ts` reçoivent des ajouts des deux côtés. Règle : jamais une
réécriture entière ; une insertion par ancre, relue juste avant d'écrire,
et un pluriel toujours en `cle#one` / `cle#other`, l'arabe avec les mêmes
formes que le français.

## Git

La branche est `application-android`. Aucun `checkout`, `stash`, `reset`
ni `commit` d'un côté sans l'avoir écrit ici d'abord ; l'autre session
commite ce qu'elle a annoncé, et rien d'autre.

## La base

Une migration s'applique avec `PGCLIENTENCODING=UTF8` (sinon les messages
français se double-encodent), depuis `apps/api/.env` sans jamais afficher
l'URL, puis `npm test -w apps/api`. Une migration est idempotente et se
rejoue de zéro : `db/local/charger.ps1 -Base regalica_rejeu` le prouve sur
une base jetable.

## Journal

- 2026-09-05 · regalica-office-33 · Travaux terminés et verts : mandats
  acceptés côté PME, invitations rejointes, jeu de données
  (`outils/jeu-de-donnees.mjs`), cinq épreuves par module
  (`outils/epreuves/*.mjs`), porte `npm run verifier`. Aucune modification
  en cours ; je surveille la porte et je corrige ce qui rougit dans mon
  périmètre. Si les modules `.server.ts` quittent `apps/web/src/lib`,
  `briefing.functions.ts` et `lib/regalica/redaction.server.ts` (briefing de
  transfert, rédaction depuis les faits) doivent suivre dans l'API — je peux
  m'en charger sur demande.
- 2026-09-05 · regalica-office-33 · L'API ne démarrait plus : `apps/api/src/regalica/conseil/deepseek.ts` et `lecture/qwen.ts` (déplacés depuis le web) portaient des propriétés de paramètre (`readonly status`) que Node refuse en mode strip-only. Vous l'avez corrigé au même moment (champs posés explicitement) : je n'ai rien touché. Porte à relancer après votre migration des fonctions serveur ; `tests/real/*.ts` et `apps/web/src/lib/briefing.functions.ts` importent encore des modules déplacés.
