#!/usr/bin/env bash
# Préparer un serveur neuf (Ubuntu 24.04 LTS) pour Malica Office.
#
#   bash provisionner.sh [url-du-depot]
#
# À lancer une fois, en root, sur la machine. Idempotent : se relance sans
# casser ce qui est en place. Il installe Docker, ferme tout sauf SSH, HTTP
# et HTTPS, crée l'utilisateur de déploiement et l'arborescence, et clone le
# dépôt si l'URL est donnée (la clé de lecture doit déjà être en place, voir
# docs/exploitation.md).
#
# Ce que ce script ne fait pas, et qui reste à la main : .env, la clé SSH de
# la CI dans ~malica/.ssh/authorized_keys, la clé de la Storage Box.
set -euo pipefail

UTILISATEUR=malica
RACINE=/srv/malica
DEPOT_URL="${1:-}"

[ "$(id -u)" -eq 0 ] || {
  echo "à lancer en root" >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git ufw fail2ban unattended-upgrades

# Docker, depuis le dépôt officiel : celui d'Ubuntu retarde d'une version.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

# L'utilisateur de déploiement : membre de docker, sans mot de passe, sa clé
# SSH limitée à porte-ssh.sh. Tout ce qui est à lui vit sous /srv/malica.
id "$UTILISATEUR" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$UTILISATEUR"
usermod -aG docker "$UTILISATEUR"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0750 \
  "$RACINE" "$RACINE/pieces" "$RACINE/postgres" "$RACINE/sauvegarde" "$RACINE/restauration"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0700 "/home/$UTILISATEUR/.ssh"

# Le dépôt : les fichiers d'infra viennent de git, jamais copiés à la main.
if [ -n "$DEPOT_URL" ] && [ ! -d "$RACINE/depot/.git" ]; then
  sudo -u "$UTILISATEUR" git clone --quiet "$DEPOT_URL" "$RACINE/depot"
fi

# Pare-feu : SSH, HTTP (le défi ACME et la redirection), HTTPS. Rien d'autre.
# Docker publie ses ports en passant devant ufw : seul Caddy déclare des
# `ports:` dans compose.yml, et PostgreSQL n'en publie aucun.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# fail2ban sur sshd ; mises à jour de sécurité automatiques.
systemctl enable --now fail2ban
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# SSH : clés seulement, root sans mot de passe.
sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/; s/^#?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

cat <<EOF

Serveur prêt.

Suite, en tant que $UTILISATEUR :
  1. cp $RACINE/depot/infra/env.exemple $RACINE/.env && chmod 600 $RACINE/.env, puis renseigner.
  2. La clé de la Storage Box dans $RACINE/sauvegarde/cle_ssh (mode 600).
  3. La clé publique de la CI dans ~/.ssh/authorized_keys, préfixée par
     command="$RACINE/depot/infra/porte-ssh.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
  4. $RACINE/depot/infra/deployer.sh <version>
EOF
