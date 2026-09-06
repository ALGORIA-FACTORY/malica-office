# Les sauvegardes : un dump PostgreSQL toutes les six heures, poussé chiffré
# hors site par restic avec les pièces, la rétention le dimanche, la
# vérification du dépôt le premier du mois. crond tient l'horloge.
#
# Construite par la CI (images.yml) depuis ce dossier.
FROM alpine:3.21
RUN apk add --no-cache bash postgresql17-client restic openssh-client curl tzdata
ENV TZ=Africa/Tunis
COPY sauvegarder.sh restaurer.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod 0755 /usr/local/bin/sauvegarder.sh /usr/local/bin/restaurer.sh
CMD ["crond", "-f", "-l", "6"]
