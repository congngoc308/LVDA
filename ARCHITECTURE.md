# ARCHITECTURE

## Components

```
Browser ──▶ web (React + Vite; nginx in Docker) ──/api──▶ FastAPI (lvda.main)
Claude Code / Cursor ──▶ mcp_server.py (stdio or HTTP :8021) ─┐
CLI `lvda verify` ─────────────────────────────────────────────┤
                                                                ▼
                      ┌──────────── lvda/ ────────────────────────────────────────────┐
                      │ llm.py              model interface: mock-large / mock-small, │
                      │                     OpenAI-compatible client, structured      │
                      │                     output + 1 retry, cache, cost, <data> tags│
                      │ agent/nlu.py        understand the question: metric, period,  │
                      │                     breakdown, top N, ambiguity, out of scope │
                      │ agent/retrieval.py  BM25 over tables, columns, metrics,       │
                      │                     verified queries                          │
                      │ agent/mock_llm.py   mock SQL writer with injected mistakes    │
                      │ agent/answer.py     answer wording + number guard             │
                      │ agent/pipeline.py   understand → retrieve → write → verify →  │
                      │                     fix (≤2) → execute → reconcile → compose  │
                      │ verifier/guard.py   one SELECT/WITH, banned functions/schemas │
                      │ verifier/fingerprint.py  lineage fingerprint (sqlglot)        │
                      │ verifier/rules.py   rules V01–V12 + notes I01–I06             │
                      │ catalog.py          Postgres columns + schema.yml + column    │
                      │                     lineage (one hop and down to source);     │
                      │                     one catalog per database, crawled from    │
                      │                     pg_views and kept as a snapshot           │
                      │ explorer.py         Data tab: domains, ranked search, capped  │
                      │                     lineage neighbourhood, trust, impact      │
                      │ dashboard.py        Evaluation dashboard: locked system cards, │
                      │                     metric cards as parameters (no SQL),      │
                      │                     dashboard agent streamed as NDJSON steps  │
                      │ sources.py          external Postgres/MySQL (read-only role), │
                      │                     incremental sync by cursor column into    │
                      │                     src_<id>, run history, scheduler thread   │
                      │ metrics.py          metric store: YAML, versions, certify,    │
                      │                     export, MetricFlow import                 │
                      │ warehouse.py        reload mart, key checks, stale metrics    │
                      │ security.py         JWT, per-database roles, audit            │
                      │ evaluation.py       labelled SQL, benchmark, judge, reports   │
                      └───────────────────────────────────────────────────────────────┘
                                                                ▼
Postgres 16:  raw  (Olist schema, 9 tables; synthetic or loaded from the Kaggle CSVs)
              mart (stg_* views → fct/dim views, backend/warehouse/mart/*.sql)
              ent_raw / ent_stg / ent_mart (500-table synthetic warehouse, catalog only)
              app  (users, members, links, audit, metrics, runs, agent logs, evaluations, catalog snapshots, dashboards,
                    sources, source_tables, sync_runs)
              src_<id> (copies of connected sources, one schema per synced database)
Role lvda_reader: SELECT on the warehouse schemas only, 10 s statement timeout, read-only transactions.
```

## Life of a question

1. **Understand** (`nlu.interpret`): match a metric by name or synonym (diacritics-insensitive), period, breakdown,
   top N. When a phrase matches several metrics ("doanh thu") it returns `alternatives` the user can switch to.
   Questions about data the warehouse does not have are refused. A condition no metric definition carries
   ("sellers with more than 10 orders") makes the question `adhoc`: the model writes its own SQL, the verifier applies
   only the general rules (no definition to compare with, I03), the verdict is at most yellow and the answer goes to
   the review queue.
2. **Retrieve** (`retrieval.Index`): BM25 picks tables and verified example queries for the prompt.
3. **Write SQL** (`llm.LLM.structured("generate_sql")`): structured output `{sql, metric_id, assumptions}`, one retry on
   schema errors. Catalog content goes inside `<data>` tags and is never treated as instructions.
4. **Verify** (`verifier.verify`): guard → `fingerprint.analyze` (qualify + scope walk: measures, filters, joins,
   group by, time column, outputs, CTE grain) → 12 rules → per-database rule settings → verdict.
5. **Fix** (≤ 2 rounds, only when red): machine-readable findings go back to the model.
6. **Execute** as `lvda_reader`. Still red after two rounds → not executed, held and queued for review.
7. **Reconcile**: run the canonical SQL with the same filters and breakdown; a gap > 0.5% raises a warning and a review item.
8. **Compose** a Vietnamese answer from the result rows; `guard_numbers` rejects any number not in the rows.
9. **Persist** `qa_runs` + `qa_attempts` + trace steps (tokens, cost, retries, cache hits); `request_id` runs through
   every log line and can be looked up on the Evaluation page.

## Design decisions

| Decision | Why |
|---|---|
| Deterministic lineage checks instead of LLM-as-judge | ~10 ms, free, stable across runs, explains every finding, findings specific enough to drive a fix |
| Fingerprint at mart-column level, traced down to raw for display | Compare at the layer the user asks about; raw explains provenance |
| Fan-out (V05) from declared relationships + CTE grain | Catches row-multiplying joins while accepting "aggregate first" or "dedupe filter" fixes |
| Red after two rounds is never executed | A wrong number should not appear as an official answer (FIX-03) |
| Per-database roles, expiring share links, links cannot certify | Fast sharing without privilege escalation (SEC-07/08) |
| PII masked for viewers at the API layer | Protects results even for hand-written SQL (SEC-05) |
| Fingerprint hash stored on certification | Detects metrics that need re-certification when the mart changes (MET-06) |
| Mock model behind the real interface | Every LLM path (retries, cache, cost, prompt wrapping) is exercised without an API key |
| Data tab loads on demand (`/explore/*`) | With hundreds of tables the browser gets one search page or one neighbourhood, never the whole catalog |
| Lineage neighbourhood capped at 14 per table, ranked by agent usage | Keeps the canvas readable; "show all" and "+N related" grow it step by step |
| External data comes in by incremental sync on a cursor column, not by querying the source live or reading its WAL/binlog | Needs only a SELECT role; the agent and verifier keep one Postgres dialect; CDC would need replication privileges and Debezium/Kafka |
| Sync re-reads `cursor >= watermark − lookback` and upserts by key, skipping unchanged rows | Late-committing transactions are not lost, re-reads are idempotent, and "updated" counts only real changes |
| Deletes detected by row-count comparison, fixed by full refresh | Incremental sync cannot see deletes; the UI says so instead of silently drifting |
| Connection strings encrypted (Fernet), write-capable roles rejected | A leaked metadata DB does not leak source credentials; LVDA can never modify a source |
| Dashboard cards store metric parameters, never SQL; rendered via canonical SQL + verifier | A card cannot drift from the certified definition, and a metric that goes stale shows a warning instead of a silently wrong number |
| Dashboard agent output goes to a tray, saved only on Save | The user decides what lands on the shared board; every agent step (and every dropped card) is visible and traceable by request_id |
| Usage and trust come from the agent's own history (`qa_runs`, first attempts) | No warehouse query log needed, and it answers the question users actually have: can I trust numbers built on this table? |
| Catalog snapshot per database, re-crawled on "Reload" | Parsing 300 views takes 1.4 s; reading the snapshot is instant |

## Extending

- **Real LLM**: set `LVDA_LLM_PROVIDER=openai` and the `LVDA_LLM_*` variables; nothing else changes.
- **Other dialects**: sqlglot supports them; the catalog needs a reader for that warehouse.
- **Power BI / stored procedures**: add lineage sources to `catalog` (post-1.0).
