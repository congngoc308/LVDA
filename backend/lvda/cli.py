"""CLI: python -m lvda.cli verify --sql "SELECT ..." [--metric gmv]   (hoặc --file q.sql)"""

import argparse
import json
import sys
from pathlib import Path

from lvda.catalog import get_catalog
from lvda.metrics import get_metric
from lvda.verifier import verify


def main() -> int:
    p = argparse.ArgumentParser(prog="lvda")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="Kiểm một câu SQL")
    src = v.add_mutually_exclusive_group(required=True)
    src.add_argument("--sql")
    src.add_argument("--file")
    v.add_argument("--metric")
    v.add_argument("--database", type=int, default=1)
    args = p.parse_args()

    sql = args.sql if args.sql else Path(args.file).read_text(encoding="utf-8")
    metric = get_metric(args.database, args.metric) if args.metric else None
    if args.metric and not metric:
        print(f"Không tìm thấy chỉ số {args.metric}", file=sys.stderr)
        return 2
    res = verify(sql, get_catalog(), metric)
    print(json.dumps({k: res[k] for k in ("verdict", "blocked_reason", "findings", "elapsed_ms")}, ensure_ascii=False, indent=2))
    return {"green": 0, "yellow": 0, "red": 1, "blocked": 1}[res["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
