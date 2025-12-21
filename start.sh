# Quick Start Scripts

# Start all services with Docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Rebuild and restart
docker-compose up -d --build

# Clean up (remove volumes)
docker-compose down -v
