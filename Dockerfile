# ── Stage 1: Build Web Panel ──
FROM node:22-alpine AS web-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build/web
COPY web/package.json web/pnpm-lock.yaml* web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY web/ ./
RUN pnpm build

# ── Stage 2: Build Server ──
FROM node:22-alpine AS server-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build/server
COPY server/package.json server/pnpm-lock.yaml* server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY server/ ./
RUN pnpm build

# ── Stage 3: Runtime ──
FROM node:22-alpine AS runtime

# Install Caddy
RUN apk add --no-cache curl ca-certificates \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy \
    && chmod +x /usr/bin/caddy

# Copy server build output (dist + node_modules for runtime deps)
COPY --from=server-builder /build/server/dist /srv/server/
COPY --from=server-builder /build/server/package.json /build/server/pnpm-lock.yaml* /build/server/pnpm-workspace.yaml /srv/server/
WORKDIR /srv/server
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --prod --frozen-lockfile || pnpm install --prod

# Copy web build output
COPY --from=web-builder /build/web/dist /srv/web/dist

# Copy Caddy config and entrypoint
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
