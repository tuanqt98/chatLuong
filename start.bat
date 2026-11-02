@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM Đặt mật khẩu để bảo vệ trang Cài đặt (tài khoản mặc định: admin)
if "%APP_PASSWORD%"=="" set APP_PASSWORD=doi-mat-khau-nay
if "%PORT%"=="" set PORT=3100
node src\server.ts
pause
