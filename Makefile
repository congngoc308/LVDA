PY ?= python
BACKEND := backend

.PHONY: up db seed api web test lint typecheck cov eval eval-verifier eval-agent mcp check

up:            ## whole stack in Docker: http://localhost:5179
	docker compose up -d --build

db:
	docker compose up -d --wait db

seed: db       ## create schemas, synthetic Olist data, metrics, demo users
	cd $(BACKEND) && $(PY) -m lvda.seed.bootstrap

api:
	cd $(BACKEND) && $(PY) -m uvicorn lvda.main:app --port 8020

web:
	cd frontend && npm run dev

test:
	cd $(BACKEND) && $(PY) -m pytest -q

lint:
	cd $(BACKEND) && ruff check .

typecheck:
	cd $(BACKEND) && mypy lvda/verifier lvda/sqlscope.py lvda/catalog.py lvda/db.py

cov:           ## NFR-04: verifier coverage gate
	cd $(BACKEND) && $(PY) -m pytest -q --cov=lvda/verifier --cov-report=term --cov-fail-under=80

eval: seed     ## NFR-03: one command reproduces every number in EVAL.md
	cd $(BACKEND) && $(PY) -m lvda.evaluation all

eval-verifier:
	cd $(BACKEND) && $(PY) -m lvda.evaluation verifier

eval-agent:
	cd $(BACKEND) && $(PY) -m lvda.evaluation agent

mcp:
	cd $(BACKEND) && $(PY) mcp_server.py --http

check: lint typecheck cov
