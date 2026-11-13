"""
Optional Reference FastAPI Backend for Cross-Facility Material Pulling List Demo.
Loads the synthetic dataset into an in-memory SQLite database on startup and exposes:
  - GET /api/health
  - GET /api/zone-rules
  - GET /api/inventory?warehouse=ALL
  - GET /demo/* (static demo files)
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = REPO_ROOT / "demo"
DATASET_PATH = DEMO_DIR / "data" / "synthetic_dataset.json"
SQL_PATH = Path(__file__).resolve().parent / "example_query.sql"

app = FastAPI(
    title="Cross-Facility Material Pulling List API (Synthetic Demo)",
    version="1.0.0",
)


def _create_memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE inventory_snapshot (
            row_id TEXT PRIMARY KEY,
            MATNR TEXT NOT NULL,
            LGORT TEXT NOT NULL,
            BIN_CODE TEXT NOT NULL,
            CHARG TEXT NOT NULL,
            LOT_DATE TEXT NOT NULL,
            GRDAT TEXT NOT NULL,
            LABST INTEGER NOT NULL
        )
        """
    )
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    conn.executemany(
        """
        INSERT INTO inventory_snapshot (row_id, MATNR, LGORT, BIN_CODE, CHARG, LOT_DATE, GRDAT, LABST)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                r["row_id"],
                r["part_no"],
                r["location"],
                r["bin"],
                r["lot"],
                r["lot_date"],
                r["gr_date"],
                int(r["qty"]),
            )
            for r in payload["inventory_rows"]
        ],
    )
    conn.commit()
    return conn


DB_CONN = _create_memory_db()


@app.get("/")
def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/demo/index.html")


@app.get("/api/health")
def health() -> Dict[str, Any]:
    cnt = DB_CONN.execute("SELECT COUNT(*) FROM inventory_snapshot").fetchone()[0]
    return {"status": "ok", "synthetic_inventory_rows": cnt}


@app.get("/api/zone-rules")
def get_zone_rules() -> Dict[str, Any]:
    rules_file = DEMO_DIR / "config" / "zone_rules.json"
    return json.loads(rules_file.read_text(encoding="utf-8"))


@app.get("/api/candidates")
def get_ranked_candidates(
    part_no: str | None = Query(default=None, description="Optional part filter e.g. PART-0001")
) -> List[Dict[str, Any]]:
    sql = SQL_PATH.read_text(encoding="utf-8").strip().rstrip(";")
    rows = [dict(r) for r in DB_CONN.execute(sql).fetchall()]
    if part_no:
        rows = [r for r in rows if r["part_no"] == part_no]
    return rows


app.mount("/demo", StaticFiles(directory=str(DEMO_DIR), html=True), name="demo")

