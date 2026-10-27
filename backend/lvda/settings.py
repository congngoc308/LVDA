"""Cấu hình theo database: bật/tắt luật, đổi mức độ (VER-08); thông tin LLM (US-12)."""

from __future__ import annotations

from lvda import config, db
from lvda.verifier.rules import DEFAULT_SEVERITY, TITLES


def get_settings(database_id: int) -> dict:
    row = db.fetch_one("SELECT settings FROM app.databases WHERE id = %s", (database_id,))
    return (row or {}).get("settings") or {}


def describe(database_id: int) -> dict:
    s = get_settings(database_id)
    cfg = s.get("rules") or {}
    rules = []
    for code, default in DEFAULT_SEVERITY.items():
        c = cfg.get(code) or {}
        rules.append({"rule": code, "title": TITLES[code], "default_severity": default,
                      "enabled": c.get("enabled", True), "severity": c.get("severity", default)})
    from lvda.llm import MODELS

    return {
        "rules": rules,
        "llm": {"provider": config.LLM_PROVIDER, "model": s.get("llm_model") or config.LLM_MODEL,
                "default_model": config.LLM_MODEL, "base_url": config.LLM_BASE_URL or None,
                "models": [{"id": k, "label": v["label"], "price_in": v["price_in"], "price_out": v["price_out"]} for k, v in MODELS.items()],
                "supported": ["mock", "openai-compatible (chưa kiểm thử)"], "planned": ["openrouter", "ollama"],
                "limits": {"max_steps": config.MAX_AGENT_STEPS, "max_tokens": config.MAX_TOKENS_PER_QUESTION,
                           "max_fix_rounds": config.MAX_FIX_ROUNDS}},
        "execution": {"timeout_ms": config.STATEMENT_TIMEOUT_MS, "max_rows": config.MAX_ROWS},
    }


def save_model(database_id: int, model: str) -> dict:
    from lvda.llm import MODELS

    if model not in MODELS:
        raise ValueError(f"Model không hỗ trợ: {model}")
    s = get_settings(database_id)
    s["llm_model"] = model
    db.execute("UPDATE app.databases SET settings = %s WHERE id = %s", (db.jsonb(s), database_id))
    return s


def save_rules(database_id: int, rules: list[dict]) -> dict:
    s = get_settings(database_id)
    cfg = {}
    for r in rules:
        if r["rule"] not in DEFAULT_SEVERITY:
            continue
        entry = {}
        if r.get("enabled") is False:
            entry["enabled"] = False
        if r.get("severity") in ("high", "medium", "low") and r["severity"] != DEFAULT_SEVERITY[r["rule"]]:
            entry["severity"] = r["severity"]
        if entry:
            cfg[r["rule"]] = entry
    s["rules"] = cfg
    db.execute("UPDATE app.databases SET settings = %s WHERE id = %s", (db.jsonb(s), database_id))
    return s
