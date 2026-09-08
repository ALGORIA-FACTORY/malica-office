# L'API — Node 22 sur Debian : @napi-rs/canvas (la lecture par bandes) veut la
# glibc, et Alpine ne l'a pas.
#
# Construite depuis la racine du dépôt :
#   docker build -f infra/api.Dockerfile -t malica-api .
FROM node:22-bookworm-slim AS dependances
WORKDIR /srv
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/socle/package.json packages/socle/
RUN npm ci --omit=dev --workspace @malica/api --workspace @malica/socle --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=dependances /srv/node_modules ./node_modules
COPY package.json ./
COPY packages/socle ./packages/socle
COPY apps/api ./apps/api
COPY db ./db
# Rien ne tourne en root : le stockage des pièces appartient à `node`.
RUN mkdir -p /pieces && chown -R node:node /pieces /srv
USER node
WORKDIR /srv/apps/api
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/server.ts"]
