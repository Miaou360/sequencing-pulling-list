/* ==========================================================================
   Cross-Facility Material Pulling List (Demo) — UI Controller & Exporters
   Zero external runtime dependencies. 100% Synthetic Demo Data.
   ========================================================================== */

(function () {
  "use strict";

  const dataset = window.PULLING_DEMO_DATA;
  const Engine = window.PullingEngine;

  if (!dataset || !Engine) {
    document.body.innerHTML =
      "<p style='padding:24px;color:#fda4af;'>Failed to load synthetic dataset bundle.</p>";
    return;
  }

  const CORE_COLUMNS = [
    { key: "no", label: "No", type: "num", width: "38px", sticky: "sticky-col-1", placeholder: "#" },
    { key: "supplier", label: "Supplier", type: "text", width: "86px", placeholder: "Sup..." },
    { key: "line_loc", label: "Line Loc", type: "text", width: "66px", placeholder: "LINE" },
    { key: "mat_type", label: "Mat", type: "text", width: "54px", placeholder: "ROH" },
    { key: "program_display", label: "Program", type: "text", width: "80px", placeholder: "PRG" },
    { key: "part_no", label: "Part No", type: "text", width: "88px", placeholder: "PART" },
    { key: "description", label: "Description", type: "text", width: "168px", placeholder: "Contains..." },
    { key: "plan_qty", label: "Plan", type: "num", width: "58px", placeholder: ">=0" },
    { key: "actual_qty", label: "Actual", type: "num", width: "58px", placeholder: ">=0" },
    { key: "required_qty", label: "Req Qty", type: "num", width: "66px", placeholder: ">0" },
    { key: "prepared_qty", label: "Prep Qty", type: "num", width: "66px", placeholder: ">=0" },
    { key: "remote_flag", label: "South", type: "text", width: "58px", placeholder: "Y/-" },
    { key: "shortage_qty", label: "Shortage", type: "num", width: "64px", placeholder: ">0" },
  ];

  const state = {
    startDate: dataset.meta.default_start_date,
    endDate: dataset.meta.default_end_date,
    bufferQty: 0,
    warehouseFilter: "ALL",
    statusFilter: "ALL",
    grDateCutoff: "",
    globalSearch: "",
    columnCountSetting: "35",
    colFilters: {},
    computedPlan: null,
    filteredRows: [],
    renderedSlotCount: 22,
  };

  // DOM References
  const elStartDate = document.getElementById("planStartDate");
  const elEndDate = document.getElementById("planEndDate");
  const elBufferQty = document.getElementById("bufferQtyInput");
  const elWarehouse = document.getElementById("warehouseFilter");
  const elStatus = document.getElementById("statusFilter");
  const elGrCutoff = document.getElementById("grDateCutoff");
  const elSearch = document.getElementById("globalSearch");
  const elColSelect = document.getElementById("columnCountSelect");
  const elThead = document.getElementById("pullingThead");
  const elTbody = document.getElementById("pullingTbody");
  const elFooterText = document.getElementById("footerSummaryText");

  const elDrawer = document.getElementById("detailDrawer");
  const elBackdrop = document.getElementById("drawerBackdrop");
  const elDrawerTitle = document.getElementById("drawerTitle");
  const elDrawerSubtitle = document.getElementById("drawerSubtitle");
  const elDrawerBody = document.getElementById("drawerBody");

  function fmtInt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function escapeHtml(val) {
    return String(val ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function matchesColumnFilter(cellVal, rawExpr, colType) {
    const expr = String(rawExpr || "").trim();
    if (!expr) return true;

    const opMatch = expr.match(/^(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
    if (opMatch && colType === "num") {
      const op = opMatch[1];
      const rhs = Number(opMatch[2]);
      const lhs = Number(cellVal || 0);
      if (op === ">") return lhs > rhs;
      if (op === ">=") return lhs >= rhs;
      if (op === "<") return lhs < rhs;
      if (op === "<=") return lhs <= rhs;
      if (op === "=") return lhs === rhs;
      if (op === "!=") return lhs !== rhs;
    }

    if (expr.startsWith("=") && expr.length > 1) {
      return String(cellVal ?? "").toLowerCase() === expr.slice(1).trim().toLowerCase();
    }

    return String(cellVal ?? "")
      .toLowerCase()
      .includes(expr.toLowerCase());
  }

  function resolveSlotCount(maxAllocated) {
    if (state.columnCountSetting === "ALL") {
      return Math.max(8, maxAllocated);
    }
    const totalCols = Number(state.columnCountSetting) || 35;
    return Math.max(5, totalCols - CORE_COLUMNS.length);
  }

  function recomputePlan() {
    state.computedPlan = Engine.computePullingList(dataset, {
      startDate: state.startDate,
      endDate: state.endDate,
      bufferQty: state.bufferQty,
      warehouseFilter: state.warehouseFilter,
      grDateCutoff: state.grDateCutoff,
    });
    const nextSlotCount = resolveSlotCount(state.computedPlan.maxAllocatedSlots);
    const needHeaderRebuild =
      nextSlotCount !== state.renderedSlotCount || elThead.children.length === 0;
    state.renderedSlotCount = nextSlotCount;
    if (needHeaderRebuild) {
      renderTableHeader();
    }
    applyFiltersAndRenderBody();
  }

  function renderTableHeader() {
    const slotCount = state.renderedSlotCount;
    let titleHtml = '<tr class="header-titles">';
    let filterHtml = '<tr class="header-filters">';

    CORE_COLUMNS.forEach((col) => {
      const stickyCls = col.sticky ? ` class="${col.sticky}"` : "";
      const styleW = col.width ? ` style="width:${col.width};min-width:${col.width};max-width:${col.width};"` : "";
      titleHtml += `<th${stickyCls}${styleW}>${escapeHtml(col.label)}</th>`;
      const curVal = state.colFilters[col.key] || "";
      filterHtml += `<th${stickyCls}${styleW}>
        <input
          type="text"
          class="col-filter-input"
          size="1"
          data-col-key="${col.key}"
          data-col-type="${col.type}"
          value="${escapeHtml(curVal)}"
          placeholder="${escapeHtml(col.placeholder)}"
        />
      </th>`;
    });

    for (let s = 1; s <= slotCount; s += 1) {
      const slotKey = `slot_${s}`;
      const curVal = state.colFilters[slotKey] || "";
      titleHtml += `<th style="width:98px;min-width:98px;max-width:98px;text-align:center;">#${s}</th>`;
      filterHtml += `<th style="width:98px;min-width:98px;max-width:98px;">
        <input
          type="text"
          class="col-filter-input"
          size="1"
          data-col-key="${slotKey}"
          data-col-type="text"
          value="${escapeHtml(curVal)}"
          placeholder="Bin..."
        />
      </th>`;
    }

    titleHtml += "</tr>";
    filterHtml += "</tr>";
    elThead.innerHTML = titleHtml + filterHtml;

    elThead.querySelectorAll(".col-filter-input").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const k = e.target.getAttribute("data-col-key");
        state.colFilters[k] = e.target.value;
        applyFiltersAndRenderBody();
      });
    });
  }

  function applyFiltersAndRenderBody() {
    const allRows = (state.computedPlan && state.computedPlan.rows) || [];
    const q = state.globalSearch.trim().toLowerCase();
    const slotCount = state.renderedSlotCount;

    const filtered = allRows.filter((row) => {
      // Status dropdown filter
      if (state.statusFilter === "REMOTE_FLAG" && row.remote_flag !== "Y") return false;
      if (state.statusFilter === "REMOTE_RACK" && !row.has_remote_rack) return false;
      if (state.statusFilter === "IN_TRANSIT" && !row.has_in_transit) return false;
      if (state.statusFilter === "GR_PENDING" && !row.has_gr_pending) return false;
      if (state.statusFilter === "SHORTAGE" && !(row.shortage_qty > 0)) return false;
      if (state.statusFilter === "ACTIVE_PULL" && !(row.net_pull_qty > 0)) return false;

      // Global search
      if (q) {
        const binJoined = row.allocated_boxes.map((b) => `${b.display_bin} ${b.lot}`).join(" ");
        const hay = `${row.part_no} ${row.description} ${row.supplier} ${row.line_loc} ${row.mat_type} ${row.program_display} ${binJoined}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Per-column filters
      for (let i = 0; i < CORE_COLUMNS.length; i += 1) {
        const col = CORE_COLUMNS[i];
        const expr = state.colFilters[col.key];
        if (expr && !matchesColumnFilter(row[col.key], expr, col.type)) {
          return false;
        }
      }

      for (let s = 1; s <= slotCount; s += 1) {
        const expr = state.colFilters[`slot_${s}`];
        if (expr) {
          const box = row.allocated_boxes[s - 1];
          const textVal = box ? box.cell_text : "";
          if (!matchesColumnFilter(textVal, expr, "text")) {
            return false;
          }
        }
      }

      return true;
    });

    state.filteredRows = filtered;
    updateKpiStrip(filtered);
    renderTableBody(filtered, slotCount);
  }

  function updateKpiStrip(rows) {
    let netPullSum = 0;
    let remoteParts = 0;
    let transitBoxes = 0;
    let grPendingBoxes = 0;
    let shortageParts = 0;

    rows.forEach((r) => {
      netPullSum += r.net_pull_qty;
      if (r.remote_flag === "Y") remoteParts += 1;
      transitBoxes += r.counts.in_transit_alloc;
      grPendingBoxes += r.counts.gr_pending_alloc;
      if (r.shortage_qty > 0) shortageParts += 1;
    });

    document.getElementById("kpiTotalParts").textContent = fmtInt(rows.length);
    document.getElementById("kpiNetPullQty").textContent = fmtInt(netPullSum);
    document.getElementById("kpiRemoteParts").textContent = fmtInt(remoteParts);
    document.getElementById("kpiTransitBoxes").textContent = fmtInt(transitBoxes);
    document.getElementById("kpiGrPendingBoxes").textContent = fmtInt(grPendingBoxes);
    document.getElementById("kpiShortageParts").textContent = fmtInt(shortageParts);

    const plan = state.computedPlan;
    elFooterText.textContent =
      `Showing ${rows.length} of ${plan.rows.length} synthetic materials | ` +
      `Period: ${plan.startDate} to ${plan.endDate} | Buffer: +${fmtInt(plan.bufferQty)} | ` +
      `Ignored Line Cart Buffer: ${fmtInt(plan.ignoredCartBufferBoxes)} boxes (${fmtInt(plan.ignoredCartBufferQty)} pcs treated as 0)`;
  }

  function renderTableBody(rows, slotCount) {
    if (!rows.length) {
      const totalSpan = CORE_COLUMNS.length + slotCount;
      elTbody.innerHTML = `<tr><td colspan="${totalSpan}" style="padding:28px;text-align:center;color:#94a3b8;">
        No materials match the active filter criteria. Click <strong>Reset</strong> to restore all rows.
      </td></tr>`;
      return;
    }

    const htmlChunks = rows.map((row) => {
      const remoteCls = row.remote_flag === "Y" ? "remote-flag-cell is-remote" : "remote-flag-cell";
      const shortCls = row.shortage_qty > 0 ? "shortage-cell has-shortage" : "shortage-cell zero";

      let slotTds = "";
      for (let s = 0; s < slotCount; s += 1) {
        const box = row.allocated_boxes[s];
        if (!box) {
          slotTds += `<td class="slot-cell"></td>`;
        } else {
          const tip =
            `#${box.slot_index} [${box.zone_label}] | Warehouse: ${box.location} | ` +
            `Bin: ${box.display_bin} | LOT: ${box.lot} (FIFO ${box.lot_date}) | ` +
            `GR Date: ${box.gr_date} | Box Qty: ${box.qty} | ` +
            `Cumul: ${box.cum_qty}/${row.net_pull_qty}` +
            (box.over_qty > 0 ? ` (+${box.over_qty} box rounding)` : "");
          slotTds += `<td class="slot-cell" title="${escapeHtml(tip)}">
            <span class="slot-pill zone-${escapeHtml(box.badge_color)}">${escapeHtml(box.cell_text)}</span>
          </td>`;
        }
      }

      return `<tr data-part-no="${escapeHtml(row.part_no)}">
        <td class="sticky-col-1">${row.no}</td>
        <td>${escapeHtml(row.supplier)}</td>
        <td>${escapeHtml(row.line_loc)}</td>
        <td>${escapeHtml(row.mat_type)}</td>
        <td>${escapeHtml(row.program_display)}</td>
        <td><span class="part-link">${escapeHtml(row.part_no)}</span></td>
        <td class="desc-cell" title="${escapeHtml(row.description)}">${escapeHtml(row.description)}</td>
        <td class="num-cell">${fmtInt(row.plan_qty)}</td>
        <td class="num-cell">${fmtInt(row.actual_qty)}</td>
        <td class="num-cell num-req">${fmtInt(row.required_qty)}</td>
        <td class="num-cell num-prep">${fmtInt(row.prepared_qty)}</td>
        <td class="${remoteCls}">${escapeHtml(row.remote_flag)}</td>
        <td class="${shortCls}">${fmtInt(row.shortage_qty)}</td>
        ${slotTds}
      </tr>`;
    });

    elTbody.innerHTML = htmlChunks.join("");

    elTbody.querySelectorAll("tr[data-part-no]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const pno = tr.getAttribute("data-part-no");
        const found = state.filteredRows.find((r) => r.part_no === pno);
        if (found) openPartDrawer(found);
      });
    });
  }

  function openPartDrawer(row) {
    elDrawerTitle.textContent = `${row.part_no} — ${row.description}`;
    elDrawerSubtitle.textContent =
      `${row.supplier} • ${row.line_loc} • Mat Type: ${row.mat_type} • Programs: ${row.program_display}`;

    const bomRowsHtml = row.bom_breakdown
      .map(
        (b) => `<tr>
          <td><strong>${escapeHtml(b.product_id)}</strong><br/><span style="color:#94a3b8;font-size:10.5px;">${escapeHtml(b.product_name)}</span></td>
          <td>L${b.bom_level}</td>
          <td class="num-cell">${fmtInt(b.fg_plan)}</td>
          <td class="num-cell">${fmtInt(b.fg_actual)}</td>
          <td class="num-cell">${fmtInt(b.fg_remaining)}</td>
          <td class="num-cell">&times; ${b.usage_per_fg}</td>
          <td class="num-cell"><strong>${fmtInt(b.component_required)}</strong></td>
        </tr>`
      )
      .join("");

    const allocRowsHtml = row.allocated_boxes.length
      ? row.allocated_boxes
          .map(
            (b) => `<tr>
              <td>#${b.slot_index}</td>
              <td><span class="slot-pill zone-${escapeHtml(b.badge_color)}" style="width:auto;">${escapeHtml(b.zone_label)}</span></td>
              <td>${escapeHtml(b.location)}</td>
              <td style="font-family:var(--font-mono);font-weight:700;">${escapeHtml(b.display_bin)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(b.lot)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(b.gr_date)}</td>
              <td class="num-cell">${fmtInt(b.qty)}</td>
              <td class="num-cell">${fmtInt(b.cum_qty)}${b.over_qty > 0 ? ` <span style="color:#38bdf8;">(+${fmtInt(b.over_qty)})</span>` : ""}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="8" style="color:#94a3b8;text-align:center;padding:12px;">No rack pull required (Net Pull = 0 or no eligible stock).</td></tr>`;

    const standbyHtml = row.standby_boxes.length
      ? row.standby_boxes
          .slice(0, 8)
          .map(
            (b) => `<tr>
              <td>${escapeHtml(b.zone_label)}</td>
              <td>${escapeHtml(b.location)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(b.display_bin)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(b.lot)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(b.gr_date)}</td>
              <td class="num-cell">${fmtInt(b.qty)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="6" style="color:#64748b;text-align:center;">No standby rack boxes remaining.</td></tr>`;

    elDrawerBody.innerHTML = `
      <div class="math-equation-bar">
        <div class="math-box">
          <div class="m-lbl">Required (+${fmtInt(row.buffer_qty)} buf)</div>
          <div class="m-num">${fmtInt(row.required_qty)}</div>
        </div>
        <div class="math-box">
          <div class="m-lbl">&minus; Prepared (Line Floor)</div>
          <div class="m-num" style="color:#cbd5e1;">${fmtInt(row.prepared_qty)}</div>
        </div>
        <div class="math-box">
          <div class="m-lbl">= Net Pull Needed</div>
          <div class="m-num" style="color:#38bdf8;">${fmtInt(row.net_pull_qty)}</div>
        </div>
        <div class="math-box">
          <div class="m-lbl">Allocated / Shortage</div>
          <div class="m-num" style="color:${row.shortage_qty > 0 ? "#fda4af" : "#a7f3d0"};">
            ${fmtInt(row.allocated_qty)} / ${fmtInt(row.shortage_qty)}
          </div>
        </div>
      </div>

      <div class="mini-note">
        <strong>Zone Accounting Summary:</strong>
        Line-side Floor aggregated = <strong>${fmtInt(row.prepared_qty)} pcs</strong> (${row.counts.floor_boxes} boxes, gray).
        Line Cart Buffer ignored = <strong>${row.counts.cart_buffer_ignored_boxes} boxes (${fmtInt(row.counts.cart_buffer_ignored_qty)} pcs treated as 0)</strong>.
        In-Transit boxes are <strong>not deducted</strong> from Net Pull Needed; they appear in green inside the pull sequence to prevent duplicate pulls.
      </div>

      <div class="drawer-section">
        <h4>1. Multi-Level BOM Explosion (${escapeHtml(state.startDate)} ~ ${escapeHtml(state.endDate)})</h4>
        <table class="mini-table">
          <thead>
            <tr>
              <th>Parent FG</th><th>BOM Lvl</th><th style="text-align:right;">Plan</th>
              <th style="text-align:right;">Actual</th><th style="text-align:right;">Rem</th>
              <th style="text-align:right;">Usage</th><th style="text-align:right;">Gross Req</th>
            </tr>
          </thead>
          <tbody>${bomRowsHtml}</tbody>
        </table>
      </div>

      <div class="drawer-section">
        <h4>2. Allocated Pull Sequence (#1 .. #${row.allocated_boxes.length})</h4>
        <table class="mini-table">
          <thead>
            <tr>
              <th>#</th><th>Zone</th><th>WH</th><th>Bin</th><th>LOT (FIFO)</th><th>GR Date</th>
              <th style="text-align:right;">Qty</th><th style="text-align:right;">Cumul</th>
            </tr>
          </thead>
          <tbody>${allocRowsHtml}</tbody>
        </table>
      </div>

      <div class="drawer-section">
        <h4>3. Unallocated Standby Rack Stock (${row.standby_boxes.length} boxes)</h4>
        <table class="mini-table">
          <thead>
            <tr>
              <th>Zone</th><th>WH</th><th>Bin</th><th>LOT</th><th>GR Date</th><th style="text-align:right;">Qty</th>
            </tr>
          </thead>
          <tbody>${standbyHtml}</tbody>
        </table>
      </div>
    `;

    elDrawer.classList.add("open");
    elBackdrop.classList.add("open");
    elDrawer.setAttribute("aria-hidden", "false");
  }

  function openZoneRulesDrawer() {
    elDrawerTitle.textContent = "Configurable Regex Zone & FIFO Rules";
    elDrawerSubtitle.textContent = "Loaded from demo/config/zone_rules.json (100% synthetic patterns)";

    const rulesRows = dataset.zone_rules.rules
      .map(
        (r) => `<tr>
          <td><strong>${escapeHtml(r.label)}</strong><br/><span style="color:#64748b;font-size:10px;">${escapeHtml(r.zone_id)}</span></td>
          <td style="font-family:var(--font-mono);font-size:11px;">${escapeHtml(r.warehouse_pattern)}</td>
          <td style="font-family:var(--font-mono);font-size:11px;">${escapeHtml(r.bin_pattern)}</td>
          <td>${escapeHtml(r.treatment)}</td>
          <td>${r.facility_priority ?? "-"}</td>
        </tr>`
      )
      .join("");

    elDrawerBody.innerHTML = `
      <div class="mini-note">
        <strong>Adapter Design:</strong> All warehouse codes and bin prefixes are decoupled into regex patterns inside
        <code>demo/config/zone_rules.json</code>. Sort priority is configured via
        <code>allocation_sort_keys = ${escapeHtml(JSON.stringify(dataset.zone_rules.allocation_sort_keys))}</code>.
      </div>
      <div class="drawer-section">
        <h4>Active Zone Classification Rules</h4>
        <table class="mini-table">
          <thead>
            <tr><th>Zone</th><th>Warehouse Regex</th><th>Bin Regex</th><th>Treatment</th><th>Tier</th></tr>
          </thead>
          <tbody>${rulesRows}</tbody>
        </table>
      </div>
    `;
    elDrawer.classList.add("open");
    elBackdrop.classList.add("open");
    elDrawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    elDrawer.classList.remove("open");
    elBackdrop.classList.remove("open");
    elDrawer.setAttribute("aria-hidden", "true");
  }

  /* ========================================================================
     CSV & Zero-Dependency Native OOXML (.xlsx) Export with Color Styling
     ======================================================================== */
  function buildExportMatrix() {
    const slotCount = state.renderedSlotCount;
    const headers = CORE_COLUMNS.map((c) => c.label);
    for (let s = 1; s <= slotCount; s += 1) {
      headers.push(`#${s}`);
    }

    const dataRows = state.filteredRows.map((r) => {
      const cells = [
        { v: r.no, t: "n", style: 0 },
        { v: r.supplier, t: "s", style: 0 },
        { v: r.line_loc, t: "s", style: 0 },
        { v: r.mat_type, t: "s", style: 0 },
        { v: r.program_display, t: "s", style: 0 },
        { v: r.part_no, t: "s", style: 0 },
        { v: r.description, t: "s", style: 0 },
        { v: r.plan_qty, t: "n", style: 0 },
        { v: r.actual_qty, t: "n", style: 0 },
        { v: r.required_qty, t: "n", style: 0 },
        { v: r.prepared_qty, t: "n", style: 0 },
        { v: r.remote_flag, t: "s", style: r.remote_flag === "Y" ? 2 : 0 },
        { v: r.shortage_qty, t: "n", style: r.shortage_qty > 0 ? 5 : 0 },
      ];
      for (let s = 0; s < slotCount; s += 1) {
        const box = r.allocated_boxes[s];
        if (!box) {
          cells.push({ v: "", t: "s", style: 0 });
        } else {
          let st = 0;
          if (box.badge_color === "yellow") st = 2;
          else if (box.badge_color === "green") st = 3;
          else if (box.badge_color === "blue") st = 4;
          cells.push({ v: box.cell_text, t: "s", style: st });
        }
      }
      return cells;
    });

    return { headers, dataRows };
  }

  function downloadCsv() {
    const { headers, dataRows } = buildExportMatrix();
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(esc).join(",")];
    dataRows.forEach((row) => {
      lines.push(row.map((c) => esc(c.v)).join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `Pulling_List_${state.startDate}_${state.endDate}.csv`);
  }

  function crc32Bytes(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k += 1) {
        c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function buildStoredZip(files) {
    const enc = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((f) => {
      const nameBytes = enc.encode(f.name);
      const dataBytes = enc.encode(f.content);
      const crc = crc32Bytes(dataBytes);

      const localHdr = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHdr.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x5621, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHdr.set(nameBytes, 30);

      const centHdr = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centHdr.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x5621, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centHdr.set(nameBytes, 46);

      localParts.push(localHdr, dataBytes);
      centralParts.push(centHdr);
      offset += localHdr.length + dataBytes.length;
    });

    const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...localParts, ...centralParts, eocd], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function colIdxToLetter(idx0) {
    let n = idx0 + 1;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function downloadXlsx() {
    const { headers, dataRows } = buildExportMatrix();
    const xmlEsc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    let sheetRowsXml = `<row r="1">` +
      headers
        .map(
          (h, ci) =>
            `<c r="${colIdxToLetter(ci)}1" t="inlineStr" s="1"><is><t>${xmlEsc(h)}</t></is></c>`
        )
        .join("") +
      `</row>`;

    dataRows.forEach((cells, ri) => {
      const rNum = ri + 2;
      const rowXml = cells
        .map((c, ci) => {
          const ref = `${colIdxToLetter(ci)}${rNum}`;
          if (c.t === "n") {
            return `<c r="${ref}" s="${c.style}"><v>${Number(c.v || 0)}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr" s="${c.style}"><is><t>${xmlEsc(c.v)}</t></is></c>`;
        })
        .join("");
      sheetRowsXml += `<row r="${rNum}">${rowXml}</row>`;
    });

    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF08A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA7F3D0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFBFDBFE"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFECDD3"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

    const zipBlob = buildStoredZip([
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Pulling_List" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      },
      { name: "xl/styles.xml", content: stylesXml },
      {
        name: "xl/worksheets/sheet1.xml",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`,
      },
    ]);

    triggerDownload(zipBlob, `Pulling_List_${state.startDate}_${state.endDate}.xlsx`);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Initialize Controls & Listeners
  function init() {
    elStartDate.min = dataset.meta.schedule_min_date;
    elStartDate.max = dataset.meta.schedule_max_date;
    elEndDate.min = dataset.meta.schedule_min_date;
    elEndDate.max = dataset.meta.schedule_max_date;
    elStartDate.value = state.startDate;
    elEndDate.value = state.endDate;
    elBufferQty.value = String(state.bufferQty);

    elStartDate.addEventListener("change", () => {
      state.startDate = elStartDate.value || dataset.meta.default_start_date;
      if (state.endDate < state.startDate) {
        state.endDate = state.startDate;
        elEndDate.value = state.endDate;
      }
      recomputePlan();
    });

    elEndDate.addEventListener("change", () => {
      state.endDate = elEndDate.value || dataset.meta.default_end_date;
      if (state.endDate < state.startDate) {
        state.startDate = state.endDate;
        elStartDate.value = state.startDate;
      }
      recomputePlan();
    });

    elBufferQty.addEventListener("input", () => {
      state.bufferQty = Math.max(0, Math.floor(Number(elBufferQty.value) || 0));
      recomputePlan();
    });

    elWarehouse.addEventListener("change", () => {
      state.warehouseFilter = elWarehouse.value;
      recomputePlan();
    });

    elStatus.addEventListener("change", () => {
      state.statusFilter = elStatus.value;
      applyFiltersAndRenderBody();
    });

    elGrCutoff.addEventListener("change", () => {
      state.grDateCutoff = elGrCutoff.value || "";
      recomputePlan();
    });

    elSearch.addEventListener("input", () => {
      state.globalSearch = elSearch.value || "";
      applyFiltersAndRenderBody();
    });

    elColSelect.addEventListener("change", () => {
      state.columnCountSetting = elColSelect.value;
      recomputePlan();
    });

    document.getElementById("btnResetFilters").addEventListener("click", () => {
      state.startDate = dataset.meta.default_start_date;
      state.endDate = dataset.meta.default_end_date;
      state.bufferQty = 0;
      state.warehouseFilter = "ALL";
      state.statusFilter = "ALL";
      state.grDateCutoff = "";
      state.globalSearch = "";
      state.columnCountSetting = "35";
      state.colFilters = {};

      elStartDate.value = state.startDate;
      elEndDate.value = state.endDate;
      elBufferQty.value = "0";
      elWarehouse.value = "ALL";
      elStatus.value = "ALL";
      elGrCutoff.value = "";
      elSearch.value = "";
      elColSelect.value = "35";

      state.renderedSlotCount = -1;
      recomputePlan();
    });

    document.getElementById("btnDownloadCsv").addEventListener("click", downloadCsv);
    document.getElementById("btnDownloadXlsx").addEventListener("click", downloadXlsx);
    document.getElementById("btnZoneRules").addEventListener("click", openZoneRulesDrawer);
    document.getElementById("btnCloseDrawer").addEventListener("click", closeDrawer);
    elBackdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
    });

    recomputePlan();
  }

  init();
})();
