FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# Full production deps (pg for migrations, discord.js for the button listener) under the traced standalone output
COPY --from=proddeps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/migrations ./migrations
COPY --from=build --chown=app:app /app/scripts ./scripts
USER app
EXPOSE 3000
# Apply pending SQL migrations, then start the server (which also runs the Discord button listener)
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
