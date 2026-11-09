# L'API (Express + pg) — Node 22 sur Debian : @napi-rs/canvas (la lecture par
# bandes) veut la glibc, et Alpine ne l'a pas. La même image joue aussi les
# migrations (service `migrate`, commande `node db/migrer.mjs`).
#
# Contexte de construction : la RACINE du dépôt (voir compose.yml).

# Le sudoku : le moteur Rust, compilé en WebAssembly. Aucun binaire natif
# n'entre dans l'image — le .wasm tourne dans Node, comme dans la WebView.
FROM rust:1.97-bookworm AS sudoku
WORKDIR /srv/packages/sudoku
RUN rustup target add wasm32-unknown-unknown
COPY packages/sudoku/Cargo.toml packages/sudoku/Cargo.lock ./
COPY packages/sudoku/src ./src
RUN cargo build --release --locked --target wasm32-unknown-unknown

FROM node:22-bookworm-slim AS dependances
WORKDIR /srv
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/socle/package.json packages/socle/
COPY packages/sudoku/package.json packages/sudoku/
RUN npm ci --omit=dev --workspace @malica/api --workspace @malica/socle --workspace @malica/sudoku --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=dependances /srv/node_modules ./node_modules
COPY package.json ./
COPY packages/socle ./packages/socle
COPY packages/sudoku/package.json ./packages/sudoku/
COPY packages/sudoku/ts ./packages/sudoku/ts
COPY --from=sudoku /srv/packages/sudoku/target/wasm32-unknown-unknown/release/malica_sudoku.wasm ./packages/sudoku/
COPY apps/api ./apps/api
COPY db ./db
# Rien ne tourne en root : le stockage des pièces et le fichier d'attente du
# journal appartiennent à `node` ; un volume neuf monté dessus en hérite.
RUN mkdir -p /pieces /journal && chown -R node:node /pieces /journal /srv
USER node
WORKDIR /srv/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--experimental-strip-types", "src/server.ts"]
