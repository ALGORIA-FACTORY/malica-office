# Le site — rendu côté serveur par nitro. Il ne détient aucun secret : les
# clés des modèles sont dans l'API.
#
# Construit depuis la racine du dépôt :
#   docker build -f infra/web.Dockerfile -t malica-web .
FROM node:22-bookworm-slim AS construction
WORKDIR /srv
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/socle/package.json packages/socle/
RUN npm ci
COPY packages/socle ./packages/socle
COPY apps/web ./apps/web
# L'adresse de l'API vue du serveur est celle du réseau interne ; le
# navigateur, lui, parle à l'origine publique — relative, donc sans adresse.
ENV VITE_API_URL=""
RUN npm run build -w @malica/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=construction /srv/apps/web/.output ./.output
RUN chown -R node:node /srv
USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
