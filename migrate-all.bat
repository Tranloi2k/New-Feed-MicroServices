@echo off
echo Running database migrations for all services...

REM Auth Service
echo.
echo [Auth Service] Running migrations...
cd auth-service
if exist .env (
  call npx prisma migrate dev --name init
  echo [OK] Auth Service migrations completed
) else (
  echo [ERROR] .env file not found in auth-service
)
cd ..

REM Post Service
echo.
echo [Post Service] Running migrations...
cd post-service
if exist .env (
  call npx prisma migrate dev --name init
  echo [OK] Post Service migrations completed
) else (
  echo [ERROR] .env file not found in post-service
)
cd ..

REM Comment Service
echo.
echo [Comment Service] Running migrations...
cd comment-service
if exist .env (
  call npx prisma migrate dev --name init
  echo [OK] Comment Service migrations completed
) else (
  echo [ERROR] .env file not found in comment-service
)
cd ..

REM Media Service
echo.
echo [Media Service] Running migrations...
cd media-service
if exist .env (
  call npx prisma migrate dev --name init
  echo [OK] Media Service migrations completed
) else (
  echo [ERROR] .env file not found in media-service
)
cd ..

echo.
echo All migrations completed!
pause
