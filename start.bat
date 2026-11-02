@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Đặt mật khẩu để bảo vệ trang Cài đặt (tài khoản mặc định: admin)
if "%APP_PASSWORD%"=="" set APP_PASSWORD=doi-mat-khau-nay
if "%PORT%"=="" set PORT=3100

where node >nul 2>nul || (
  echo [LOI] Chua cai Node.js. Tai ban 22 LTS tai https://nodejs.org
  pause
  exit /b 1
)

REM --experimental-strip-types: cho phep Node 22.6 - 22.17 chay truc tiep file .ts
REM (Node >= 22.18 da bat san, co nay van chay binh thuong)
node --experimental-strip-types --disable-warning=ExperimentalWarning src\server.ts
if errorlevel 1 (
  echo.
  echo [LOI] Server dung bat thuong. Neu loi "bad option" hoac "Unknown file extension .ts":
  echo        Node qua cu, can Node.js 22.6 tro len. Phien ban hien tai:
  node -v
)
pause
