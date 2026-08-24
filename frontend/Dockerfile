FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build && echo "Build completed" && ls -la .next/ && test -f .next/standalone/server.js && echo "server.js exists" || (echo "server.js NOT FOUND" && exit 1)

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Verify server.js exists in the final image
RUN test -f /app/server.js && echo "OK: server.js present in runner" || (echo "ERROR: server.js missing from runner" && exit 1)
EXPOSE 3000
ENV PORT=3000
# Override node:20-slim's docker-entrypoint.sh to avoid shell-form CMD mangling.
# Using ENTRYPOINT with exec-form ensures CMD args are passed directly to node.
ENTRYPOINT ["node", "server.js"]
CMD []
