# Le site — rendu côté serveur par nitro. Il ne détient aucun secret : les
# clés des modèles sont dans l'API.
#
# Contexte de construction : la RACINE du dépôt (voir compose.yml).
FROM node:22-bookworm-slim AS construction
WORKDIR /srv
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/socle/package.json packages/socle/
RUN npm ci
COPY packages/socle ./packages/socle
COPY apps/web ./apps/web
# Le navigateur parle à l'origine publique — la même que la page, puisque Caddy
# y route `/rpc`, `/auth/*` et `/pieces` vers l'API. « / » le dit : une valeur
# vide ferait lever le site avant la première requête.
ENV VITE_API_URL="/"
RUN npm run build -w @malica/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=construction /srv/apps/web/.output ./.output
RUN chown -R node:node /srv
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:8080/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
