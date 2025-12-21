@echo off
echo Installing dependencies for all services...

set services=shared api-gateway auth-service post-service comment-service media-service

for %%s in (%services%) do (
  echo.
  echo [%%s] Installing dependencies...
  cd %%s
  call npm install
  if %ERRORLEVEL% EQU 0 (
    echo [OK] %%s dependencies installed
  ) else (
    echo [ERROR] Failed to install %%s dependencies
  )
  cd ..
)

echo.
echo All dependencies installed!
echo.
echo Next steps:
echo 1. Copy .env.example to .env in each service and configure
echo 2. Run migrations: migrate-all.bat
echo 3. Start with Docker: docker-compose up -d
echo    OR start locally: start.bat
pause
