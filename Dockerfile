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
# `pnpm build` compiles with server/tsconfig.build.json, which excludes
# *.test.ts and src/testing/**, so unit tests never ship in the image (before
# this, dist/*.test.js was copied into runtime). The trailing check fails the
# build loudly if that config ever regresses.
RUN pnpm build \
    && test ! -d dist/testing \
    && ! find dist -name '*.test.js' -print -quit | grep -q .

# ── Stage 3: Runtime ──
FROM node:22-alpine AS runtime

# tini is PID 1: it reaps zombies and forwards signals (see entrypoint.sh).
# caddy comes from the Alpine repo. CADDY_VERSION is intentionally not pinned by
# default: the available version tracks the Alpine release of the node:22-alpine
# base image, and hard-coding one breaks the build whenever that base image
# moves for no security benefit. For a byte-reproducible rebuild pass e.g.
# --build-arg CADDY_VERSION=2.x.y-r0 (the exact version is visible in the build
# log / `apk info -vv caddy`); the base image tag remains the real pinned input.
# libcap provides setcap so the unprivileged user can bind :80/:443.
ARG CADDY_VERSION=
RUN apk add --no-cache ca-certificates tini libcap "caddy${CADDY_VERSION:+=$CADDY_VERSION}" \
    && setcap cap_net_bind_service=+ep "$(command -v caddy)"

# Server: production dependencies only
COPY --from=server-builder /build/server/dist /srv/server/
COPY --from=server-builder /build/server/package.json /build/server/pnpm-lock.yaml* /build/server/pnpm-workspace.yaml /srv/server/
WORKDIR /srv/server
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && (pnpm install --prod --frozen-lockfile || pnpm install --prod)

# Web: static assets served by Caddy
COPY --from=web-builder /build/web/dist /srv/web/dist

# Caddy config and entrypoint
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Unprivileged runtime user (uid 10001). /srv/caddy holds Caddy's data/config
# dirs (needed only when in-container TLS is enabled) and is writable by it.
RUN adduser -D -h /srv/caddy -u 10001 app \
    && mkdir -p /srv/caddy/data /srv/caddy/config \
    && chown -R app:app /srv

ENV XDG_DATA_HOME=/srv/caddy/data \
    XDG_CONFIG_HOME=/srv/caddy/config \
    HOME=/srv/caddy

EXPOSE 80 443
STOPSIGNAL SIGTERM
USER app

# Liveness: the API must answer /api/health, not just "the process is running".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT_HTTP || 41601) + '/api/health').then(r => r.json()).then(j => process.exit(j.status === 'ok' ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "-g", "--", "/entrypoint.sh"]
