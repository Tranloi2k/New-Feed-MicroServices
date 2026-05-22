#!/bin/bash

echo "🚀 Running database migrations for all services..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Auth Service
echo -e "\n📦 Auth Service - Running migrations..."
cd auth-service
if [ -f .env ]; then
  npx prisma migrate dev --name init
  echo -e "${GREEN}✅ Auth Service migrations completed${NC}"
else
  echo -e "${RED}❌ .env file not found in auth-service${NC}"
fi
cd ..

# Post Service
echo -e "\n📦 Post Service - Running migrations..."
cd post-service
if [ -f .env ]; then
  npx prisma migrate dev --name init
  echo -e "${GREEN}✅ Post Service migrations completed${NC}"
else
  echo -e "${RED}❌ .env file not found in post-service${NC}"
fi
cd ..

# Comment Service
echo -e "\n📦 Comment Service - Running migrations..."
cd comment-service
if [ -f .env ]; then
  npx prisma migrate dev --name init
  echo -e "${GREEN}✅ Comment Service migrations completed${NC}"
else
  echo -e "${RED}❌ .env file not found in comment-service${NC}"
fi
cd ..

# Notification Service
echo -e "\n📦 Notification Service - Running migrations..."
cd notification-service
if [ -f .env ]; then
  npx prisma migrate dev --name init
  echo -e "${GREEN}✅ Notification Service migrations completed${NC}"
else
  echo -e "${RED}❌ .env file not found in notification-service${NC}"
fi
cd ..

echo -e "\n${GREEN}✅ All migrations completed!${NC}"
