# L'API — Node 22 sur Debian : @napi-rs/canvas (la lecture par bandes) veut la
# glibc, et Alpine ne l'a pas.
#
# Construite depuis la racine du dépôt :
#   docker build -f infra/api.Dockerfile -t malica-api .

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
# Rien ne tourne en root : le stockage des pièces appartient à `node`.
RUN mkdir -p /pieces && chown -R node:node /pieces /srv
USER node
WORKDIR /srv/apps/api
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/server.ts"]
