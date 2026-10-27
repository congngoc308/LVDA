"""Truy xuất ngữ cảnh cho agent (AGT-02): bảng/cột liên quan, định nghĩa chỉ số, truy vấn mẫu đã duyệt.

Index BM25 trên mô tả tiếng Việt của bảng/cột và định nghĩa chỉ số (bỏ dấu, unigram + bigram).
Tất định và chạy tại chỗ; chỗ cắm embedding (BGE-M3, pgvector) khi có model thật là hàm `_score`.
"""

from __future__ import annotations

import math
import re
from collections import Counter

import sqlglot
import yaml
from sqlglot import exp

from lvda import config, db
from lvda.agent.nlu import DIMENSIONS, normalize_question, strip_accents

DIM_TABLE = {"customer_state": "mart.fct_orders", "category": "mart.fct_order_items", "payment_type": "mart.fct_payments",
             "seller_state": "mart.dim_sellers", "month": None}


def tokens(text: str) -> list[str]:
    words = [w for w in re.split(r"[^a-z0-9]+", strip_accents(text)) if len(w) > 1]
    return words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]


def tables_of(sql: str) -> list[str]:
    return sorted({f"{t.db}.{t.name}" for t in sqlglot.parse_one(sql, read="postgres").find_all(exp.Table) if t.db})


class Index:
    def __init__(self, database_id: int):
        from lvda.metrics import list_metrics

        meta = yaml.safe_load(config.SCHEMA_YML.read_text(encoding="utf-8"))
        desc = meta.get("descriptions") or {}
        rows = db.fetch_all("SELECT column_name, description FROM app.column_descriptions WHERE database_id = %s", (database_id,))
        approved = {r["column_name"]: r["description"] for r in rows}
        deprecated = set(meta.get("deprecated", []))
        self.docs: list[dict] = []
        for table, cols in desc.items():
            if table in deprecated:
                continue
            parts = [table.replace("_", " "), approved.get(table, cols.get("_table", ""))]
            for col, text in cols.items():
                if col != "_table":
                    parts += [col.replace("_", " "), approved.get(f"{table}.{col}", text)]
            self.docs.append({"kind": "table", "id": table, "text": " ".join(parts)})
        self.metrics = {m["id"]: m for m in list_metrics(database_id) if m["status"] != "deprecated"}
        for m in self.metrics.values():
            text = " ".join([m["name_vi"], *m.get("synonyms", []), m.get("description", "")])
            self.docs.append({"kind": "metric", "id": m["id"], "text": text, "tables": tables_of(m["canonical_sql"])})
        self.tf = [Counter(tokens(d["text"])) for d in self.docs]
        n = len(self.docs)
        df = Counter(t for tf in self.tf for t in tf)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.avg = sum(sum(tf.values()) for tf in self.tf) / max(n, 1)
        self.database_id = database_id

    def _score(self, q: list[str], i: int, k1: float = 1.4, b: float = 0.75) -> float:
        tf, length = self.tf[i], sum(self.tf[i].values())
        return sum(self.idf.get(t, 0) * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * length / self.avg)) for t in q if t in tf)

    def search(self, question: str, interp: dict | None = None, k: int = 5) -> dict:
        q = tokens(question)
        scores: Counter = Counter()
        why: dict[str, str] = {}
        for i, d in enumerate(self.docs):
            s = self._score(q, i)
            if s <= 0:
                continue
            if d["kind"] == "table":
                scores[d["id"]] += s
                why.setdefault(d["id"], "khớp mô tả bảng/cột")
            else:
                for t in d["tables"]:
                    scores[t] += s * 0.8
                    why.setdefault(t, f"bảng của chỉ số {d['id']}")
        metric = self.metrics.get((interp or {}).get("metric_id") or "")
        if metric:
            for t in tables_of(metric["canonical_sql"]):
                scores[t] += 100
                why[t] = f"bảng trong định nghĩa {metric['id']}"
        dim_table = DIM_TABLE.get((interp or {}).get("dimension") or "")
        if dim_table:
            scores[dim_table] += 50
            why[dim_table] = f"chứa chiều “{DIMENSIONS[interp['dimension']]['label']}”"
        top = [{"table": t, "score": round(s, 2), "why": why.get(t, "")} for t, s in scores.most_common(k)]
        return {"tables": top, "metric": metric, "examples": self.examples(question)}

    def examples(self, question: str, k: int = 3) -> list[dict]:
        rows = db.fetch_all("SELECT question, sql, metric_id FROM app.verified_queries WHERE database_id = %s AND active",
                            (self.database_id,))
        qn = set(normalize_question(question).split())
        scored = []
        for r in rows:
            other = set(normalize_question(r["question"]).split())
            if qn and other:
                scored.append((len(qn & other) / len(qn | other), r))
        return [{"question": r["question"], "sql": r["sql"], "similarity": round(s, 2)}
                for s, r in sorted(scored, key=lambda x: -x[0])[:k] if s >= 0.3]


_cache: dict[int, Index] = {}


def get_index(database_id: int, refresh: bool = False) -> Index:
    if refresh or database_id not in _cache:
        _cache[database_id] = Index(database_id)
    return _cache[database_id]
