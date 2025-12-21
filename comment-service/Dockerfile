FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --production
RUN npx prisma generate

COPY . .

EXPOSE 3004

# For development: use db push (no migration files needed)
# For production: use migrate deploy with migration files
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/app.js"]
