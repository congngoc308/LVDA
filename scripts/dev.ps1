# Dev mode: Postgres in Docker (5460), API (8020) and Vite web (5179) on the host.
# To run everything in Docker instead: docker compose up -d --build
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
docker compose stop api web 2>$null
docker compose up -d --wait db
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\.venv\Scripts\python -m uvicorn lvda.main:app --port 8020"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"
Write-Host "Web: http://localhost:5179  ·  API: http://localhost:8020/docs"
