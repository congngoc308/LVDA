"""SEC-02: ≥ 30 câu SQL độc hại bị chặn; VER-03: bảng chân trị phán quyết; VER-08: cấu hình luật."""

import pytest

from lvda.catalog import get_catalog
from lvda.verifier import rules, verify

MALICIOUS = [
    "DELETE FROM raw.orders",
    "DELETE FROM mart.fct_orders WHERE 1=1",
    "UPDATE raw.orders SET order_status = 'x'",
    "INSERT INTO raw.orders VALUES ('x')",
    "INSERT INTO raw.orders SELECT * FROM raw.orders",
    "DROP TABLE raw.orders",
    "DROP SCHEMA mart CASCADE",
    "TRUNCATE raw.orders",
    "CREATE TABLE x (a int)",
    "CREATE TABLE x AS SELECT * FROM raw.orders",
    "ALTER TABLE raw.orders ADD COLUMN x int",
    "ALTER ROLE lvda_reader SUPERUSER",
    "GRANT ALL ON raw.orders TO PUBLIC",
    "COPY raw.orders TO '/tmp/x.csv'",
    "SELECT 1; DROP TABLE raw.orders",
    "SELECT 1; SELECT 2",
    "SELECT pg_sleep(10)",
    "SELECT * FROM raw.orders WHERE pg_sleep(1) IS NULL",
    "SELECT dblink('host=evil', 'select 1')",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT pg_ls_dir('.')",
    "SELECT lo_import('/etc/passwd')",
    "SELECT pg_terminate_backend(1)",
    "SELECT set_config('statement_timeout', '0', false)",
    "SELECT * FROM app.users",
    "SELECT email, password_hash FROM app.users",
    "SELECT * FROM pg_catalog.pg_authid",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM pg_user",
    "SELECT * INTO new_table FROM raw.orders",
    "SELECT * FROM raw.orders FOR UPDATE",
    "WITH d AS (DELETE FROM raw.orders RETURNING *) SELECT * FROM d",
    "VACUUM raw.orders",
    "SET ROLE lvda",
]


@pytest.fixture(scope="module")
def cat():
    return get_catalog()


def test_at_least_30_cases():
    assert len(MALICIOUS) >= 30


@pytest.mark.parametrize("sql", MALICIOUS)
def test_malicious_blocked(cat, sql):
    res = verify(sql, cat, None)
    assert res["verdict"] == "blocked" or not res["executable"], (sql, res)


def f(rule, sev):
    return {"rule": rule, "severity": sev}


@pytest.mark.parametrize("findings,certified,expected", [
    ([], True, "green"),
    ([], False, "yellow"),
    ([f("I01", "info")], True, "green"),
    ([f("V11", "low")], True, "green"),
    ([f("V08", "medium")], True, "yellow"),
    ([f("V08", "medium")], False, "yellow"),
    ([f("V02", "high")], True, "red"),
    ([f("V02", "high"), f("V08", "medium")], True, "red"),
    ([f("V05", "high")], False, "red"),
])
def test_verdict_truth_table(findings, certified, expected):
    assert rules.verdict(findings, certified) == expected


def test_rule_settings_disable_and_override():
    base = [rules.finding("V08", "medium", "x"), rules.finding("V10", "medium", "y"), rules.finding("I01", "info", "z")]
    out = rules.apply_settings(base, {"rules": {"V08": {"severity": "high"}, "V10": {"enabled": False}}})
    assert {x["rule"]: x["severity"] for x in out} == {"V08": "high", "I01": "info"}
