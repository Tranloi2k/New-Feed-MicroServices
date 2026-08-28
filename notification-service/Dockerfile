FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 3005

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm start"]
