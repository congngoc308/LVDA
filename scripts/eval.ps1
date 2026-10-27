# Windows equivalent of `make eval` (NFR-03): bootstrap if needed, then run every evaluation.
# Reports are written to backend/eval/results (md + json).
param([ValidateSet("all", "verifier", "agent")] [string]$Suite = "all")
$root = Split-Path -Parent $PSScriptRoot
docker compose -f "$root\docker-compose.yml" up -d --wait db
Set-Location "$root\backend"
.\.venv\Scripts\python -m lvda.seed.bootstrap
.\.venv\Scripts\python -m lvda.evaluation $Suite
