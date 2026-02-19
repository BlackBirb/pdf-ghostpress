FROM node:25-alpine AS env

WORKDIR /srv

RUN npm install -g pnpm

# --- Early cache of only prod deps
FROM env AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# --- Build with full deps
FROM env AS builder

COPY --from=deps /srv/package.json /srv/pnpm-lock.yaml /srv/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Runtime
FROM node:25-alpine AS runner

ARG PORT=3000

ENV PORT=$PORT

RUN apk add --no-cache ghostscript

WORKDIR /srv

ENV NODE_ENV=production
ENV JWT_ENABLE=false

COPY --from=deps /srv/package.json /srv/pnpm-lock.yaml /srv/pnpm-workspace.yaml ./
COPY --from=deps /srv/node_modules ./node_modules
COPY --from=builder /srv/dist ./dist

VOLUME [ "/srv/certs" ]

EXPOSE $PORT

CMD [ "node", "/srv/dist/index.js" ]
