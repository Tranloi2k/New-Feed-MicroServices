#!/bin/bash

echo "📦 Installing dependencies for all services..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

services=("shared" "api-gateway" "auth-service" "post-service" "comment-service" "media-service")

for service in "${services[@]}"; do
  echo -e "\n${BLUE}📦 Installing $service...${NC}"
  cd $service
  npm install
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ $service dependencies installed${NC}"
  else
    echo -e "${RED}❌ Failed to install $service dependencies${NC}"
  fi
  cd ..
done

echo -e "\n${GREEN}✅ All dependencies installed!${NC}"
echo -e "\nNext steps:"
echo "1. Copy .env.example to .env in each service and configure"
echo "2. Run migrations: ./migrate-all.sh"
echo "3. Start with Docker: docker-compose up -d"
echo "   OR start locally: ./start.sh"
