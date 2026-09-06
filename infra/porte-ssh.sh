#!/usr/bin/env bash
# La porte SSH de la CI : la clé de déploiement ne sait faire qu'une chose.
#
# Dans ~regalica/.ssh/authorized_keys, la clé publique de la CI est préfixée :
#   command="/srv/regalica/depot/infra/porte-ssh.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA…
#
# sshd lance alors ce script à la place de ce que le client demande, et lui
# passe la demande dans SSH_ORIGINAL_COMMAND. Seul « deployer <version> »
# passe ; tout le reste — un shell, une copie, un tunnel — est refusé.
set -euo pipefail

case "${SSH_ORIGINAL_COMMAND:-}" in
deployer\ *)
  exec /srv/regalica/depot/infra/deployer.sh "${SSH_ORIGINAL_COMMAND#deployer }"
  ;;
*)
  echo "refusé : cette clé ne sait que « deployer <version> »" >&2
  exit 1
  ;;
esac
