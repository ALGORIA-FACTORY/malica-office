#!/usr/bin/env bash
# La porte SSH de la CI : la clé de déploiement ne sait faire que quatre choses.
#
# Dans ~malica/.ssh/authorized_keys, la clé publique de la CI est préfixée :
#   command="/srv/malica/depot/infra/porte-ssh.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA…
#
# sshd lance alors ce script à la place de ce que le client demande, et lui
# passe la demande dans SSH_ORIGINAL_COMMAND. Quatre formes passent ; tout le
# reste — un shell, une copie, un tunnel — est refusé.
#
#   deposer <version>    l'entrée standard porte un paquet git (bundle)
#   deployer <version>   l'entrée standard porte, ou non, un jeton de registre
#   journal <réf>[,<réf>…]  relit, en lecture seule, les pannes que l'écran a
#                        citées (« réf. 28AE8D15 ») : huit chiffres hexadécimaux
#                        chacune, vingt au plus. Rien d'autre ne s'y glisse.
#   lectures <jours>     relit, en lecture seule, les lectures de pièces qui
#                        ont échoué ces <jours> derniers (1 à 7) et leur motif
#                        technique — la note d'honoraires « illisible » du
#                        21 novembre se lisait parfaitement hors du pilote.
#
# ================================================= POURQUOI « JOURNAL » EXISTE
#
# 21 novembre 2026. Cinq pannes sur la fiche d'une pièce, au pilote ; l'écran
# donne une référence, le détail (la pile, le refus) est dans
# audit.journal_client. Le port SSH du pilote n'est ouvert qu'à la CI : sans
# cette commande, personne ne pouvait lire la panne sans ouvrir un shell. La
# référence est contrôlée ICI, avant même d'appeler le déployeur, puis une
# seconde fois derrière.
#
# ================================================ POURQUOI « DEPOSER » EXISTE
#
# 12 octobre 2026. Le dépôt est passé sous l'organisation ALGORIA-FACTORY, et
# le déploiement s'est arrêté net : le serveur n'arrivait plus à lire le code.
# Diagnostic — l'organisation INTERDIT les clés de déploiement, et GitHub le
# dit en clair dès qu'on tente d'en créer une. La clé du serveur n'était ni
# expirée ni mal transférée : elle était interdite par une règle.
#
# On a d'abord cru à un accident de déménagement. C'en était l'occasion, pas
# la cause : un serveur qui va CHERCHER le code a besoin d'un accès permanent
# au dépôt entier, et cet accès est précisément ce qu'une organisation
# raisonnable refuse.
#
# Le sens est donc inversé. La CI a déjà le code sous la main — elle vient de
# le compiler — et un accès au serveur. Elle le DÉPOSE. Le serveur ne garde
# aucune clé GitHub, et il ne peut plus lire que ce qu'on lui donne.
set -euo pipefail

case "${SSH_ORIGINAL_COMMAND:-}" in
deposer\ *)
  exec "${DEPLOYEUR:-/srv/malica/depot/infra/deployer.sh}" --deposer "${SSH_ORIGINAL_COMMAND#deposer }"
  ;;
deployer\ *)
  exec "${DEPLOYEUR:-/srv/malica/depot/infra/deployer.sh}" "${SSH_ORIGINAL_COMMAND#deployer }"
  ;;
journal\ *)
  refs="${SSH_ORIGINAL_COMMAND#journal }"
  [[ "$refs" =~ ^[0-9A-F]{8}(,[0-9A-F]{8}){0,19}$ ]] || {
    echo "refusé : « journal » attend une à vingt références de huit chiffres hexadécimaux, séparées par des virgules" >&2
    exit 1
  }
  exec "${DEPLOYEUR:-/srv/malica/depot/infra/deployer.sh}" --journal "$refs"
  ;;
lectures\ *)
  jours="${SSH_ORIGINAL_COMMAND#lectures }"
  [[ "$jours" =~ ^[1-7]$ ]] || {
    echo "refusé : « lectures » attend un nombre de jours, de 1 à 7" >&2
    exit 1
  }
  exec "${DEPLOYEUR:-/srv/malica/depot/infra/deployer.sh}" --lectures "$jours"
  ;;
*)
  echo "refusé : cette clé ne sait que « deposer <version> », « deployer <version> », « journal <réf> » et « lectures <jours> »" >&2
  exit 1
  ;;
esac
