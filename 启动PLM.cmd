@echo off
cd /d "%~dp0"
set RAYON_NUM_THREADS=1
node scripts/run-framework.mjs dev --port 5180
pause
