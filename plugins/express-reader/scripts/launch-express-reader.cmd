@echo off
setlocal

if defined CODEX_MCP_NODE_PATH (
  "%CODEX_MCP_NODE_PATH%" "%~dp0..\dist\server.cjs"
  exit /b %ERRORLEVEL%
)

node "%~dp0..\dist\server.cjs"
exit /b %ERRORLEVEL%
