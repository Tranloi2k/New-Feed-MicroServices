@echo off
echo Starting NewFeed Microservices...
cd microservices
docker-compose up -d
echo.
echo Services started! Check http://localhost:8080
echo RabbitMQ Management: http://localhost:15673 (admin/admin)
echo.
pause
