/* ==========================================================================
   Cross-Facility Material Pulling List (Demo) — Pure Allocation Engine
   100% Synthetic Rules:
     1. Remaining Prod = max(0, Plan - Actual) over selected date range
     2. Multi-Level BOM Explosion -> Material Gross Required (+ Buffer)
     3. Line Cart Buffer -> 0 (excluded); Line-side Floor -> Prepared Qty (ready)
     4. Net Pull Needed = max(0, Required - Prepared) [In Transit NOT deducted]
     5. Candidate Priority:
          Group 1: Facility North rack (next to the lines, default)
          Group 2: South group = Facility South rack (Yellow) + In Transit (Green) + GR Pending (Blue)
        Tie-breakers within group: LOT Date (FIFO) -> GR Date -> Bin Name
   ========================================================================== */

(function (globalScope) {
  "use strict";

  function compileZoneRules(zoneConfig) {
    const targetSet = new Set((zoneConfig && zoneConfig.target_warehouses) || []);
    const compiled = ((zoneConfig && zoneConfig.rules) || []).map((r) => ({
      zone_id: r.zone_id,
      label: r.label,
      warehouse_re: new RegExp(r.warehouse_pattern),
      bin_re: new RegExp(r.bin_pattern),
      treatment: r.treatment,
      facility_priority: r.facility_priority,
      badge_color: r.badge_color || "default",
      description: r.description || "",
    }));
    return {
      targetSet,
      sortKeys: (zoneConfig && zoneConfig.allocation_sort_keys) || [
        "facility_priority",
        "lot_date",
        "gr_date",
        "bin",
      ],
      compiled,
    };
  }

  function classifyInventoryRow(row, rulePack) {
    if (!row || !(Number(row.qty) > 0)) {
      return null;
    }
    const loc = String(row.location || "").trim();
    if (rulePack.targetSet.size > 0 && !rulePack.targetSet.has(loc)) {
      return null;
    }
    const rawBin = String(row.bin || "").trim();
    for (let i = 0; i < rulePack.compiled.length; i += 1) {
      const rule = rulePack.compiled[i];
      if (rule.warehouse_re.test(loc) && rule.bin_re.test(rawBin)) {
        let displayBin = rawBin;
        if (!displayBin) {
          displayBin = rule.zone_id === "GR_PENDING" ? "GR-PEND" : "UNASSIGNED";
        }
        return {
          ...row,
          qty: Number(row.qty),
          bin: rawBin,
          display_bin: displayBin,
          zone_id: rule.zone_id,
          zone_label: rule.label,
          treatment: rule.treatment,
          facility_priority: rule.facility_priority,
          badge_color: rule.badge_color,
        };
      }
    }
    return {
      ...row,
      qty: Number(row.qty),
      bin: rawBin,
      display_bin: rawBin || "UNASSIGNED",
      zone_id: "UNASSIGNED",
      zone_label: "Unassigned",
      treatment: "REFERENCE_ONLY",
      facility_priority: null,
      badge_color: "slate",
    };
  }

  function explodeMultiLevelBom(finishedProducts, bomEdges) {
    const childrenByParent = new Map();
    (bomEdges || []).forEach((edge) => {
      const p = edge.parent_id;
      if (!childrenByParent.has(p)) {
        childrenByParent.set(p, []);
      }
      childrenByParent.get(p).push({
        component_id: edge.component_id,
        qty_per: Number(edge.qty_per) || 0,
      });
    });

    // Returns Map<part_no, Array<{ product_id, product_name, program_code, usage_per_fg, max_depth }>>
    const partUsageByFg = new Map();

    (finishedProducts || []).forEach((fg) => {
      const fgAcc = new Map();

      function walk(parentId, multiplier, depth) {
        if (depth > 8) return;
        const kids = childrenByParent.get(parentId) || [];
        kids.forEach((k) => {
          const nextMult = multiplier * k.qty_per;
          const prev = fgAcc.get(k.component_id) || { usage: 0, maxDepth: depth };
          fgAcc.set(k.component_id, {
            usage: prev.usage + nextMult,
            maxDepth: Math.max(prev.maxDepth, depth),
          });
          walk(k.component_id, nextMult, depth + 1);
        });
      }

      walk(fg.product_id, 1, 1);

      fgAcc.forEach((info, partNo) => {
        if (!partUsageByFg.has(partNo)) {
          partUsageByFg.set(partNo, []);
        }
        partUsageByFg.get(partNo).push({
          product_id: fg.product_id,
          product_name: fg.name,
          program_code: fg.program_code,
          usage_per_fg: info.usage,
          bom_level: info.maxDepth,
        });
      });
    });

    return partUsageByFg;
  }

  function compareCandidateBoxes(a, b, sortKeys) {
    const keys = sortKeys && sortKeys.length
      ? sortKeys
      : ["facility_priority", "lot_date", "gr_date", "bin"];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === "facility_priority") {
        const pa = a.facility_priority ?? 99;
        const pb = b.facility_priority ?? 99;
        if (pa !== pb) return pa - pb;
      } else if (key === "lot_date") {
        const la = String(a.lot_date || a.lot || "");
        const lb = String(b.lot_date || b.lot || "");
        if (la !== lb) return la < lb ? -1 : 1;
      } else if (key === "gr_date") {
        const ga = String(a.gr_date || "");
        const gb = String(b.gr_date || "");
        if (ga !== gb) return ga < gb ? -1 : 1;
      } else if (key === "bin") {
        const ba = String(a.display_bin || "");
        const bb = String(b.display_bin || "");
        if (ba !== bb) return ba.localeCompare(bb, "en", { numeric: true });
      }
    }
    return String(a.row_id || "").localeCompare(String(b.row_id || ""));
  }

  function computePullingList(dataset, options) {
    const opts = options || {};
    const startDate = opts.startDate || dataset.meta.default_start_date;
    const endDate = opts.endDate || dataset.meta.default_end_date;
    const bufferQty = Math.max(0, Math.floor(Number(opts.bufferQty) || 0));
    const grDateCutoff = opts.grDateCutoff ? String(opts.grDateCutoff).trim() : "";
    const warehouseScope = opts.warehouseFilter && opts.warehouseFilter !== "ALL"
      ? String(opts.warehouseFilter)
      : "";

    const rulePack = compileZoneRules(dataset.zone_rules);
    const sortKeys = opts.sortKeys || rulePack.sortKeys;

    // 1. Aggregate FG plan, actual, and remaining qty within [startDate, endDate]
    const fgTotals = new Map();
    (dataset.finished_products || []).forEach((fg) => {
      fgTotals.set(fg.product_id, { plan: 0, actual: 0, remaining: 0 });
    });

    (dataset.production_schedule || []).forEach((s) => {
      if (s.date >= startDate && s.date <= endDate) {
        const slot = fgTotals.get(s.product_id);
        if (slot) {
          slot.plan += Number(s.plan_qty) || 0;
          slot.actual += Number(s.actual_qty) || 0;
        }
      }
    });
    fgTotals.forEach((slot) => {
      slot.remaining = Math.max(0, slot.plan - slot.actual);
    });

    // 2. Explode multi-level BOM
    const partUsageByFg = explodeMultiLevelBom(dataset.finished_products, dataset.bom_edges);

    // 3. Classify all inventory rows by part_no
    const byPart = new Map();
    let ignoredCartBufferBoxes = 0;
    let ignoredCartBufferQty = 0;

    (dataset.inventory_rows || []).forEach((rawRow) => {
      const cls = classifyInventoryRow(rawRow, rulePack);
      if (!cls) return;

      if (!byPart.has(cls.part_no)) {
        byPart.set(cls.part_no, {
          cartBufferBoxes: 0,
          cartBufferQty: 0,
          floorBoxes: [],
          candidates: [],
          referenceOnly: [],
        });
      }
      const bucket = byPart.get(cls.part_no);

      if (cls.treatment === "EXCLUDED_ZERO") {
        bucket.cartBufferBoxes += 1;
        bucket.cartBufferQty += cls.qty;
        ignoredCartBufferBoxes += 1;
        ignoredCartBufferQty += cls.qty;
        return;
      }

      if (cls.treatment === "PREPARED_READY") {
        bucket.floorBoxes.push(cls);
        return;
      }

      // Optional GR-date or warehouse filter applies to candidate rack/transit/dock rows
      if (grDateCutoff && String(cls.gr_date || "") > grDateCutoff) {
        return;
      }
      if (warehouseScope && cls.location !== warehouseScope) {
        return;
      }

      if (
        cls.treatment === "ALLOCATE_MAIN_GROUP" ||
        cls.treatment === "ALLOCATE_REMOTE_GROUP"
      ) {
        bucket.candidates.push(cls);
      } else {
        bucket.referenceOnly.push(cls);
      }
    });

    // 4. Compute material-by-material pulling plan
    let maxAllocatedSlots = 0;
    const rows = (dataset.materials || []).map((mat, idx) => {
      const usages = partUsageByFg.get(mat.part_no) || [];
      let planQty = 0;
      let actualQty = 0;
      let baseRequiredQty = 0;

      const bomBreakdown = usages.map((u) => {
        const fgStat = fgTotals.get(u.product_id) || { plan: 0, actual: 0, remaining: 0 };
        const grossPlan = fgStat.plan * u.usage_per_fg;
        const grossActual = fgStat.actual * u.usage_per_fg;
        const netReq = fgStat.remaining * u.usage_per_fg;
        planQty += grossPlan;
        actualQty += grossActual;
        baseRequiredQty += netReq;
        return {
          product_id: u.product_id,
          product_name: u.product_name,
          program_code: u.program_code,
          bom_level: u.bom_level,
          fg_plan: fgStat.plan,
          fg_actual: fgStat.actual,
          fg_remaining: fgStat.remaining,
          usage_per_fg: u.usage_per_fg,
          component_required: netReq,
        };
      });

      const requiredQty = baseRequiredQty > 0 ? baseRequiredQty + bufferQty : 0;

      const invBucket = byPart.get(mat.part_no) || {
        cartBufferBoxes: 0,
        cartBufferQty: 0,
        floorBoxes: [],
        candidates: [],
        referenceOnly: [],
      };

      const preparedQty = invBucket.floorBoxes.reduce((acc, b) => acc + b.qty, 0);
      // Confirmed rule (08:46): In Transit is NOT subtracted from Required Qty;
      // only Line-side Floor (`preparedQty`) is deducted.
      const netPullQty = Math.max(0, requiredQty - preparedQty);

      const sortedCandidates = invBucket.candidates
        .slice()
        .sort((a, b) => compareCandidateBoxes(a, b, sortKeys));

      const allocatedBoxes = [];
      const standbyBoxes = [];
      let cumAllocated = 0;

      sortedCandidates.forEach((box) => {
        if (cumAllocated < netPullQty) {
          cumAllocated += box.qty;
          const overQty = cumAllocated > netPullQty ? cumAllocated - netPullQty : 0;
          allocatedBoxes.push({
            ...box,
            slot_index: allocatedBoxes.length + 1,
            cum_qty: cumAllocated,
            over_qty: overQty,
            cell_text: `${box.display_bin} (${box.qty})`,
          });
        } else {
          standbyBoxes.push(box);
        }
      });

      if (allocatedBoxes.length > maxAllocatedSlots) {
        maxAllocatedSlots = allocatedBoxes.length;
      }

      const shortageQty = Math.max(0, netPullQty - cumAllocated);

      let mainAllocBoxes = 0;
      let remoteRackAllocBoxes = 0;
      let transitAllocBoxes = 0;
      let grPendingAllocBoxes = 0;

      allocatedBoxes.forEach((b) => {
        if (b.zone_id === "MAIN_RACK") mainAllocBoxes += 1;
        else if (b.zone_id === "REMOTE_RACK") remoteRackAllocBoxes += 1;
        else if (b.zone_id === "IN_TRANSIT") transitAllocBoxes += 1;
        else if (b.zone_id === "GR_PENDING") grPendingAllocBoxes += 1;
      });

      const hasRemoteGroupAlloc =
        remoteRackAllocBoxes + transitAllocBoxes + grPendingAllocBoxes > 0;

      const programList = Array.from(
        new Set(usages.map((u) => u.program_code).filter(Boolean))
      );
      const programDisplay = programList.length
        ? programList.join(", ")
        : `${mat.primary_program_code}`;

      return {
        no: idx + 1,
        part_no: mat.part_no,
        description: mat.description,
        supplier: mat.supplier,
        line_loc: mat.line_loc,
        mat_type: mat.mat_type,
        program_display: programDisplay,
        primary_program_name: mat.primary_program_name,
        standard_pack: mat.standard_pack,
        plan_qty: planQty,
        actual_qty: actualQty,
        base_required_qty: baseRequiredQty,
        buffer_qty: baseRequiredQty > 0 ? bufferQty : 0,
        required_qty: requiredQty,
        prepared_qty: preparedQty,
        net_pull_qty: netPullQty,
        allocated_qty: cumAllocated,
        over_allocated_qty: Math.max(0, cumAllocated - netPullQty),
        shortage_qty: shortageQty,
        remote_flag: hasRemoteGroupAlloc ? "Y" : "-",
        has_remote_rack: remoteRackAllocBoxes > 0,
        has_in_transit: transitAllocBoxes > 0,
        has_gr_pending: grPendingAllocBoxes > 0,
        counts: {
          main_alloc: mainAllocBoxes,
          remote_rack_alloc: remoteRackAllocBoxes,
          in_transit_alloc: transitAllocBoxes,
          gr_pending_alloc: grPendingAllocBoxes,
          standby_boxes: standbyBoxes.length,
          floor_boxes: invBucket.floorBoxes.length,
          cart_buffer_ignored_boxes: invBucket.cartBufferBoxes,
          cart_buffer_ignored_qty: invBucket.cartBufferQty,
        },
        allocated_boxes: allocatedBoxes,
        standby_boxes: standbyBoxes,
        floor_boxes: invBucket.floorBoxes,
        reference_boxes: invBucket.referenceOnly,
        bom_breakdown: bomBreakdown,
      };
    });

    return {
      startDate,
      endDate,
      bufferQty,
      maxAllocatedSlots,
      ignoredCartBufferBoxes,
      ignoredCartBufferQty,
      rows,
    };
  }

  const exported = {
    compileZoneRules,
    classifyInventoryRow,
    explodeMultiLevelBom,
    compareCandidateBoxes,
    computePullingList,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
  globalScope.PullingEngine = exported;
})(typeof window !== "undefined" ? window : globalThis);

