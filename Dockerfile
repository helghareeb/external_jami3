FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are written into the browser code at build time; Railway passes a service
# variable into a Docker build only when it is declared here. Where installed apps download the
# offline edition from (Cloudflare R2, https://files.hadith.dev/offline); unset → the site's proxy.
ARG NEXT_PUBLIC_OFFLINE_DATA_URL
ENV NEXT_PUBLIC_OFFLINE_DATA_URL=$NEXT_PUBLIC_OFFLINE_DATA_URL
RUN rm -rf .next/cache && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
