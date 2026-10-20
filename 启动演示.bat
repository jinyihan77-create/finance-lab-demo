@echo off
rem Finance Lab conversation workspace
cd /d %~dp0
python serve.py --port 8877 --open
pause
