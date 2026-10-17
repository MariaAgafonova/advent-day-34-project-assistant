@echo off
node "%~dp0project-assistant\dist\cli.js" %*
exit /b %errorlevel%
