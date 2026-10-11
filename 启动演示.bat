@echo off
rem Finance Lab 演示站一键启动（真链路代理到团队后端 127.0.0.1:8765）
cd /d %~dp0
python serve.py --open
pause
