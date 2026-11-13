-- =============================================================================
-- Generic Reference SQL: Zone Classification & LOT-FIFO Rack Candidate Query
-- Uses generic table `inventory_snapshot` with standard ERP column aliases
-- (`MATNR` = Part No, `LGORT` = Storage Location, `LABST` = Unrestricted Qty,
--  `CHARG` = Batch/LOT, `GRDAT` = Goods Receipt Date).
-- Warehouse codes and bins are those of the synthetic two-facility plant
-- (Facility North / Facility South) shared with the 3D Warehouse Visualizer.
-- =============================================================================

WITH classified_stock AS (
    SELECT
        s.MATNR                                        AS part_no,
        s.LGORT                                        AS location,
        COALESCE(TRIM(s.BIN_CODE), '')                 AS bin,
        s.CHARG                                        AS lot,
        s.LOT_DATE                                     AS lot_date,
        s.GRDAT                                        AS gr_date,
        s.LABST                                        AS qty,
        CASE
            -- 1. Feeder carts next to stations: safety buffer -> excluded (0)
            WHEN s.LGORT = 'WH-NORTH'
             AND (s.BIN_CODE LIKE 'LCB-%' OR s.BIN_CODE LIKE 'BUF-%')
            THEN 'LINE_CART_BUFFER'

            -- 2. Assembly line floor: already pulled -> Prepared Qty
            WHEN s.LGORT = 'WH-NORTH'
             AND s.BIN_CODE LIKE 'LSF-%'
            THEN 'LINE_SIDE_FLOOR'

            -- 3. Quality-hold rack -> reference only, never allocated
            WHEN s.BIN_CODE LIKE 'N-QH-%' OR s.BIN_CODE LIKE 'S-QH-%'
            THEN 'QUALITY_HOLD'

            -- 4. Dock staging lanes awaiting rack put-away -> Blue
            WHEN s.LGORT = 'WH-RCV'
            THEN 'GR_PENDING'

            -- 5. Picked from a South rack (warehouse already North, bin still South) -> Green guard
            WHEN s.LGORT = 'WH-NORTH' AND s.BIN_CODE LIKE 'S__-__-_'
            THEN 'IN_TRANSIT'

            -- 6. Facility South rack -> Yellow cross-facility pull target
            WHEN s.LGORT = 'WH-SOUTH' AND s.BIN_CODE LIKE 'S__-__-_'
            THEN 'REMOTE_RACK'

            -- 7. Facility North rack (next to the lines) -> Priority 1
            WHEN s.LGORT = 'WH-NORTH' AND s.BIN_CODE LIKE 'N__-__-_'
            THEN 'MAIN_RACK'

            ELSE 'UNASSIGNED'
        END                                            AS zone_id
    FROM inventory_snapshot s
    WHERE s.LABST > 0
      AND s.LGORT IN ('WH-NORTH', 'WH-SOUTH', 'WH-RCV')
)
SELECT
    part_no,
    location,
    bin                                            AS display_bin,
    lot,
    lot_date,
    gr_date,
    qty,
    zone_id,
    CASE
        WHEN zone_id = 'MAIN_RACK' THEN 1
        WHEN zone_id IN ('REMOTE_RACK', 'IN_TRANSIT', 'GR_PENDING') THEN 2
        ELSE 99
    END AS facility_priority
FROM classified_stock
WHERE zone_id IN ('MAIN_RACK', 'REMOTE_RACK', 'IN_TRANSIT', 'GR_PENDING')
ORDER BY
    part_no ASC,
    facility_priority ASC,
    lot_date ASC,
    gr_date ASC,
    display_bin ASC;

