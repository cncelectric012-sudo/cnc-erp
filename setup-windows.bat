@echo off
echo === CNC Bot - Z840 Windows Server Setup ===
echo.

:: 1. Install PM2 and Windows startup helper
echo [1/4] Installing PM2...
npm install -g pm2
npm install -g pm2-windows-startup

:: 2. Stop old instance if running
pm2 delete cnc-bot 2>nul

:: 3. Start bot with PM2
echo [2/4] Starting bot...
cd /d "%~dp0"
pm2 start index.js --name cnc-bot --restart-delay=5000 --max-restarts=10

:: 4. Save PM2 process list
echo [3/4] Saving process list...
pm2 save

:: 5. Setup auto-start on Windows boot
echo [4/4] Setting up auto-start on boot...
pm2-startup install

:: 6. Disable Windows sleep
echo Disabling sleep mode...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0

echo.
echo === Setup complete! ===
echo Bot is running. Check status: pm2 status
echo View logs: pm2 logs cnc-bot
echo.
pause
