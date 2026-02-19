# --- Early cache of only prod deps
FROM node:25-alpine AS deps

WORKDIR /srv

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# --- Build with full deps
FROM node:25-alpine AS builder

WORKDIR /srv

RUN npm install -g pnpm

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

COPY --from=deps /srv/package.json /srv/pnpm-lock.yaml /srv/pnpm-workspace.yaml ./
COPY --from=deps /srv/node_modules ./node_modules
COPY --from=builder /srv/dist ./dist

EXPOSE $PORT

CMD [ "node", "/srv/dist/index.js" ]
