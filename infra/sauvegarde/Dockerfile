# Les sauvegardes : un dump PostgreSQL, poussé chiffré hors site par restic
# avec les pièces, la rétention, la vérification du dépôt. crond tient
# l'horloge ; les horaires viennent du .env (demarrer.sh).
#
# Construite par la CI (images.yml) depuis ce dossier.
FROM alpine:3.21
RUN apk add --no-cache bash postgresql17-client restic openssh-client curl tzdata
ENV TZ=Africa/Tunis
COPY sauvegarder.sh restaurer.sh demarrer.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/sauvegarder.sh /usr/local/bin/restaurer.sh /usr/local/bin/demarrer.sh
CMD ["demarrer.sh"]
