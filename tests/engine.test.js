// Run with:  node --test tests/engine.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const engine = require(path.join(__dirname, "..", "demo", "engine.js"));
const dataset = require(path.join(__dirname, "..", "demo", "data", "synthetic_dataset.json"));

const rules = engine.compileZoneRules(dataset.zone_rules);
const classify = (location, bin) => {
  const hit = engine.classifyInventoryRow({ part_no: "X", location, bin, qty: 10 }, rules);
  return hit ? hit.zone_id : null;
};

function miniDataset(inventoryRows) {
  return {
    meta: { default_start_date: "2026-11-16", default_end_date: "2026-11-16" },
    zone_rules: dataset.zone_rules,
    programs: [{ code: "PRG-A", name: "Model A" }],
    finished_products: [{ product_id: "FG-A", name: "Unit A", program_code: "PRG-A" }],
    materials: [{ part_no: "P1", description: "Bracket", mat_type: "ROH1", supplier: "Supplier 001",
                  line_loc: "LINE-01", primary_program_code: "PRG-A", primary_program_name: "Model A",
                  standard_pack: 100 }],
    bom_edges: [{ parent_id: "FG-A", component_id: "SUB-1", qty_per: 1 },
                { parent_id: "SUB-1", component_id: "P1", qty_per: 2 }],
    production_schedule: [{ date: "2026-11-16", product_id: "FG-A", program_code: "PRG-A",
                            plan_qty: 100, actual_qty: 20 }],
    inventory_rows: inventoryRows.map((r, i) => ({ row_id: `R${i}`, part_no: "P1", lot: `L${i}`,
                                                   gr_date: r.lot_date, ...r })),
  };
}

test("zone rules: North rack first, South rack second, picked South pallet = in transit", () => {
  assert.equal(classify("WH-NORTH", "N03-02-3"), "MAIN_RACK");
  assert.equal(classify("WH-SOUTH", "S07-11-1"), "REMOTE_RACK");
  assert.equal(classify("WH-NORTH", "S07-11-1"), "IN_TRANSIT");
  assert.equal(classify("WH-RCV", "N-STG-01"), "GR_PENDING");
  assert.equal(classify("WH-NORTH", "LSF-A01"), "LINE_SIDE_FLOOR");
  assert.equal(classify("WH-NORTH", "LCB-12"), "LINE_CART_BUFFER");
  assert.equal(classify("WH-OTHER", "N03-02-3"), null);
});

test("every pallet of the shared plant falls into a defined zone", () => {
  for (const row of dataset.inventory_rows) {
    const hit = engine.classifyInventoryRow(row, rules);
    assert.ok(hit && hit.zone_id !== "UNASSIGNED", `unclassified: ${row.location} ${row.bin}`);
  }
});

test("requirement = (plan - actual) exploded through the multi-level BOM", () => {
  const out = engine.computePullingList(miniDataset([
    { location: "WH-NORTH", bin: "N01-01-1", lot_date: "2026-10-01", qty: 100 },
  ]));
  assert.equal(out.rows[0].required_qty, 160);          // (100 - 20) x 1 x 2
});

test("North stock is used before South stock even when the South lot is older", () => {
  const out = engine.computePullingList(miniDataset([
    { location: "WH-SOUTH", bin: "S01-01-1", lot_date: "2026-08-01", qty: 100 },
    { location: "WH-NORTH", bin: "N01-01-1", lot_date: "2026-10-01", qty: 100 },
    { location: "WH-NORTH", bin: "N01-02-1", lot_date: "2026-09-01", qty: 100 },
  ]));
  const row = out.rows[0];
  assert.deepEqual(row.allocated_boxes.map((b) => b.bin), ["N01-02-1", "N01-01-1"]);   // FIFO inside North
  assert.equal(row.remote_flag, "-");
  assert.equal(row.shortage_qty, 0);
});

test("South covers only the balance; line-side stock is deducted; cart buffer counts as zero", () => {
  const out = engine.computePullingList(miniDataset([
    { location: "WH-NORTH", bin: "LSF-A01", lot_date: "2026-11-15", qty: 30 },
    { location: "WH-NORTH", bin: "LCB-10", lot_date: "2026-11-15", qty: 500 },
    { location: "WH-NORTH", bin: "N01-01-1", lot_date: "2026-10-01", qty: 100 },
    { location: "WH-SOUTH", bin: "S01-01-1", lot_date: "2026-08-01", qty: 100 },
    { location: "WH-SOUTH", bin: "S01-02-1", lot_date: "2026-08-02", qty: 100 },
  ]));
  const row = out.rows[0];
  assert.equal(row.prepared_qty, 30);
  assert.equal(row.net_pull_qty, 130);
  assert.deepEqual(row.allocated_boxes.map((b) => b.bin), ["N01-01-1", "S01-01-1"]);
  assert.equal(row.remote_flag, "Y");
  assert.equal(out.ignoredCartBufferQty, 500);
});

test("shortage is reported when both facilities cannot cover the requirement", () => {
  const out = engine.computePullingList(miniDataset([
    { location: "WH-NORTH", bin: "N01-01-1", lot_date: "2026-10-01", qty: 100 },
  ]));
  assert.equal(out.rows[0].shortage_qty, 60);
});

test("shared dataset: default window gives North-only parts and South-assisted parts", () => {
  const out = engine.computePullingList(dataset, {});
  assert.equal(out.rows.length, dataset.materials.length);
  assert.ok(out.rows.some((r) => r.net_pull_qty > 0 && r.remote_flag === "-"));
  assert.ok(out.rows.some((r) => r.remote_flag === "Y"));
  for (const r of out.rows) {
    assert.equal(r.net_pull_qty, Math.max(0, r.required_qty - r.prepared_qty));
    assert.ok(r.allocated_qty + r.shortage_qty >= r.net_pull_qty);
  }
});
