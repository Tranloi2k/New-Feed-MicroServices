FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

RUN npm ci
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY scripts ./scripts/
COPY src ./src/
COPY test ./test/

FROM build AS test
CMD ["npm", "test"]

FROM build AS migration
CMD ["sh", "-c", "npx prisma migrate deploy && npm run seed:demo"]

FROM node:24-alpine AS production-dependencies

WORKDIR /app
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm uninstall prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package*.json ./
COPY --chown=node:node src ./src/

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/app.js"]
