#!/usr/bin/env python3
"""Build the pulling-list demo dataset from the 3D Warehouse Visualizer's plant.

Both demos show the same synthetic plant (https://github.com/Miaou360/3d-warehouse-visualizer):
Facility North is next to the assembly lines, Facility South is the second building. This script reads that
repository's published data bundles (rack pallets, parts, BOM, weekly customer forecast) and writes the dataset
the sequencing engine uses, so every pallet on the pulling list is a pallet you can find in the 3D racks.

    python tools/build_from_warehouse.py --source ../3d-warehouse-visualizer/demo/data
    python tools/build_from_warehouse.py            # reads the published GitHub Pages bundles

What is taken over as is: parts, suppliers, pallet quantities, the multi-level BOM, the forecast (spread over the
production days of each week) and every pallet with its bay, level, lot and receipt date.
What is added here (seeded, so the output is the same on every run): stock already at the line (prepared stock
and cart buffers are outside the warehouse model), the production actuals of the first day, and the system flag
of a few South pallets that were picked for transfer (their warehouse is already North, the bin is still South).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any

PAGES_SOURCE = "https://miaou360.github.io/3d-warehouse-visualizer/demo/data"
SOURCE_REPO = "https://github.com/Miaou360/3d-warehouse-visualizer"
SEED = 20261116
SCHEDULE_WEEKS = 2
WH_NORTH, WH_SOUTH, WH_RCV = "WH-NORTH", "WH-SOUTH", "WH-RCV"
PREPARED_SHARE = 0.34          # share of parts with stock already at the line
CART_BUFFER_SHARE = 0.10       # share of parts with a point-of-use cart buffer
TRANSFER_PICK_SHARE = 0.012    # share of South rack pallets already picked for transfer to North
FIRST_DAY_DONE = 0.4           # share of the first day's plan already built at the snapshot


def read_bundle(source: str, name: str) -> dict[str, Any]:
    """Load one `window.X = {...};` data bundle from a folder or a URL."""
    if source.startswith("http"):
        with urllib.request.urlopen(f"{source.rstrip('/')}/{name}", timeout=30) as resp:  # noqa: S310
            text = resp.read().decode("utf-8")
    else:
        text = (Path(source) / name).read_text(encoding="utf-8")
    start = text.rindex("] = {") + 4 if '"] = {' in text else text.index("{")
    return json.loads(text[start:text.rindex("}") + 1])


def zone_rules() -> dict[str, Any]:
    rack = "[0-9]{2}-[0-9]{2}-[1-5]$"
    return {
        "version": "2.0.0",
        "description": "Zone classification and FIFO allocation rules for the two-facility plant of the "
                       "3D Warehouse Visualizer (Facility North at the lines, Facility South as second source).",
        "target_warehouses": [WH_NORTH, WH_SOUTH, WH_RCV],
        "allocation_sort_keys": ["facility_priority", "lot_date", "gr_date", "bin"],
        "deduct_in_transit_from_net_required": False,
        "rules": [
            {"zone_id": "LINE_CART_BUFFER", "label": "Line Cart Buffer", "warehouse_pattern": f"^{WH_NORTH}$",
             "bin_pattern": "^(LCB|BUF)-[0-9]{2,3}$", "treatment": "EXCLUDED_ZERO", "facility_priority": None,
             "badge_color": "hidden",
             "description": "Point-of-use feeder carts that must stay full as a safety buffer; treated as zero."},
            {"zone_id": "LINE_SIDE_FLOOR", "label": "Line-side Floor (Prepared)", "warehouse_pattern": f"^{WH_NORTH}$",
             "bin_pattern": "^LSF-[A-Z][0-9]{2}$", "treatment": "PREPARED_READY", "facility_priority": None,
             "badge_color": "gray",
             "description": "Material already pulled to the assembly floor; deducted from the gross requirement."},
            {"zone_id": "QUALITY_HOLD", "label": "Quality Hold", "warehouse_pattern": f"^({WH_NORTH}|{WH_SOUTH})$",
             "bin_pattern": "^[NS]-QH-[0-9]{2}$", "treatment": "REFERENCE_ONLY", "facility_priority": None,
             "badge_color": "slate",
             "description": "Pallets on the quality-hold rack: shown for reference, never allocated."},
            {"zone_id": "IN_TRANSIT", "label": "In Transit (South -> North)", "warehouse_pattern": f"^{WH_NORTH}$",
             "bin_pattern": f"^S{rack}", "treatment": "ALLOCATE_REMOTE_GROUP", "facility_priority": 2,
             "badge_color": "green",
             "description": "Picked from a South rack: the system warehouse is already North while the bin still "
                            "shows the South location. Kept on the list so the pallet is not requested twice."},
            {"zone_id": "GR_PENDING", "label": "GR Pending (Dock)", "warehouse_pattern": f"^{WH_RCV}$",
             "bin_pattern": "^[NS]-STG-[0-9]{2}$", "treatment": "ALLOCATE_REMOTE_GROUP", "facility_priority": 2,
             "badge_color": "blue",
             "description": "Received on the dock staging lanes, waiting for put-away."},
            {"zone_id": "REMOTE_RACK", "label": "South Rack", "warehouse_pattern": f"^{WH_SOUTH}$",
             "bin_pattern": f"^S{rack}", "treatment": "ALLOCATE_REMOTE_GROUP", "facility_priority": 2,
             "badge_color": "yellow",
             "description": "Facility South racks: second source, needs a cross-facility transfer."},
            {"zone_id": "MAIN_RACK", "label": "North Rack", "warehouse_pattern": f"^{WH_NORTH}$",
             "bin_pattern": f"^N{rack}", "treatment": "ALLOCATE_MAIN_GROUP", "facility_priority": 1,
             "badge_color": "default",
             "description": "Facility North racks next to the lines: first source."},
        ],
    }


def stable(part_no: str, salt: str) -> float:
    """Deterministic 0..1 value per part, independent of iteration order."""
    return int(hashlib.sha256(f"{SEED}:{salt}:{part_no}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def build(source: str) -> dict[str, Any]:
    planning = read_bundle(source, "planning.js")
    facilities = {"north": read_bundle(source, "facility_north.js"), "south": read_bundle(source, "facility_south.js")}
    rng = random.Random(SEED)
    snapshot = date.fromisoformat(planning["snapshot_date"])
    weeks = planning["weeks"][:SCHEDULE_WEEKS]

    programs = [{"code": f"PRG-{m['fg_part'].split('-')[-1]}", "name": m["model"]} for m in planning["models"]]
    code_of = {m["fg_part"]: f"PRG-{m['fg_part'].split('-')[-1]}" for m in planning["models"]}
    name_of = {m["fg_part"]: m["model"] for m in planning["models"]}

    # daily plan: the weekly customer forecast spread over the production days of the week
    schedule: list[dict[str, Any]] = []
    daily_base: dict[str, int] = {}
    for m in planning["models"]:
        fg = m["fg_part"]
        for w in weeks:
            days = w["prod_days"]
            if not days:
                continue
            qty = planning["forecast"][fg][w["index"]]
            per_day, extra = divmod(int(qty), len(days))
            for k, wd in enumerate(days):
                d = date.fromisoformat(w["start"]) + timedelta(days=wd - 1)
                plan = per_day + (1 if k < extra else 0)
                actual = int(round(plan * FIRST_DAY_DONE / 10.0)) * 10 if d == snapshot else 0
                schedule.append({"date": d.isoformat(), "product_id": fg, "product_name": m["description"],
                                 "program_code": code_of[fg], "plan_qty": plan, "actual_qty": min(plan, actual)})
                daily_base.setdefault(fg, plan)
    schedule.sort(key=lambda r: (r["date"], r["product_id"]))
    finished = [{"product_id": m["fg_part"], "name": m["description"], "program_code": code_of[m["fg_part"]],
                 "daily_base": daily_base.get(m["fg_part"], 0)} for m in planning["models"]]

    bom_edges = [{"parent_id": b["parent"], "component_id": b["child"], "qty_per": b["qty"]} for b in planning["bom"]]
    parents: dict[str, list[str]] = {}
    for b in planning["bom"]:
        parents.setdefault(b["child"], []).append(b["parent"])

    def first_fg(part_no: str) -> str:
        seen, todo = set(), [part_no]
        while todo:
            cur = todo.pop(0)
            if cur in name_of:
                return cur
            for p in sorted(parents.get(cur, [])):
                if p not in seen:
                    seen.add(p)
                    todo.append(p)
        return planning["models"][0]["fg_part"]

    materials = []
    for i, p in enumerate(planning["parts"]):
        fg = first_fg(p["part_no"])
        materials.append({"part_no": p["part_no"], "description": p["description"], "mat_type": p["material_type"],
                          "supplier": p["supplier_name"], "line_loc": f"LINE-{(i % 6) + 1:02d}",
                          "primary_program_code": code_of[fg], "primary_program_name": name_of[fg],
                          "standard_pack": p["pallet_qty"]})
    known = {m["part_no"] for m in materials}

    rows: list[dict[str, Any]] = []

    def add(part_no: str, location: str, bin_code: str, lot: str, gr: str, qty: int) -> None:
        rows.append({"row_id": "", "part_no": part_no, "location": location, "bin": bin_code, "lot": lot,
                     "lot_date": gr, "gr_date": gr, "qty": int(qty)})

    south_rack_rows: list[int] = []
    for key, wh in (("north", WH_NORTH), ("south", WH_SOUTH)):
        for bay in facilities[key]["bays"]:
            for it in bay["items"]:
                if it["part_no"] not in known:
                    continue
                if bay["zone"] == "Staging":
                    add(it["part_no"], WH_RCV, bay["bay_id"], it["lot_no"], it["gr_date"], it["qty"])
                elif bay["zone"] == "Special":
                    add(it["part_no"], wh, bay["bay_id"], it["lot_no"], it["gr_date"], it["qty"])
                else:
                    add(it["part_no"], wh, f"{bay['bay_id']}-{it['level']}", it["lot_no"], it["gr_date"], it["qty"])
                    if key == "south":
                        south_rack_rows.append(len(rows) - 1)
    for idx in rng.sample(south_rack_rows, max(1, int(len(south_rack_rows) * TRANSFER_PICK_SHARE))):
        rows[idx]["location"] = WH_NORTH                      # picked for transfer: warehouse flipped, bin unchanged

    # stock at the line (not part of the warehouse model)
    lsf = lcb = 0
    for p in planning["parts"]:
        pn, pack = p["part_no"], p["pallet_qty"]
        if stable(pn, "prepared") < PREPARED_SHARE:
            for k in range(1 + int(stable(pn, "prepared-n") * 2)):
                lsf += 1
                qty = max(1, int(pack * (0.25 + 0.6 * stable(pn, f"prepared-q{k}"))))
                add(pn, WH_NORTH, f"LSF-{'ABCDEF'[lsf % 6]}{(lsf // 6) % 40 + 1:02d}", f"SYN-LS-{lsf:05d}",
                    (snapshot - timedelta(days=1 + k)).isoformat(), qty)
        if stable(pn, "cart") < CART_BUFFER_SHARE:
            lcb += 1
            add(pn, WH_NORTH, f"LCB-{lcb % 90 + 10:02d}", f"SYN-CB-{lcb:05d}",
                (snapshot - timedelta(days=2)).isoformat(), max(1, int(pack * 0.3)))
    for i, r in enumerate(rows, 1):
        r["row_id"] = f"INV-{i:05d}"

    prod_dates = sorted({r["date"] for r in schedule})
    return {
        "meta": {
            "seed": SEED,
            "generated_on": snapshot.isoformat(),
            "default_start_date": prod_dates[0],
            "default_end_date": prod_dates[min(3, len(prod_dates) - 1)],
            "schedule_min_date": prod_dates[0],
            "schedule_max_date": prod_dates[-1],
            "source": {"repository": SOURCE_REPO, "snapshot_date": planning["snapshot_date"],
                       "seed": planning.get("seed"), "rack_positions": planning.get("capacity_positions")},
            "synthetic_notice": "100% synthetic: the plant, parts, BOM, forecast and pallets come from the "
                                "3D Warehouse Visualizer demo data; zero real operational records.",
        },
        "zone_rules": zone_rules(),
        "programs": programs,
        "finished_products": finished,
        "materials": materials,
        "bom_edges": bom_edges,
        "production_schedule": schedule,
        "inventory_rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", default=PAGES_SOURCE,
                        help="folder or URL with planning.js, facility_north.js, facility_south.js "
                             "(default: the published 3D Warehouse Visualizer demo data)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    payload = build(args.source)
    data_dir = root / "demo" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "synthetic_dataset.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    banner = "/* Auto-generated by tools/build_from_warehouse.py from the 3D Warehouse Visualizer demo data. 100% synthetic. */\n"
    (data_dir / "synthetic_bundle.js").write_text(
        banner + "window.PULLING_DEMO_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8", newline="\n")
    (root / "demo" / "config" / "zone_rules.json").write_text(
        json.dumps(payload["zone_rules"], indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(payload['materials'])} parts, {len(payload['bom_edges'])} BOM edges, "
          f"{len(payload['production_schedule'])} schedule rows, {len(payload['inventory_rows'])} pallets "
          f"(snapshot {payload['meta']['generated_on']})")


if __name__ == "__main__":
    main()
