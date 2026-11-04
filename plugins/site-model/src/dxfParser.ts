// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import DxfParser from "dxf-parser";
import {
    type ArcSegment2D,
    type BoundaryElement,
    type BuildingFootprint,
    type LineSegment2D,
    type NoGoZone,
    type PickItem,
    type PlotBoundary,
    type Point2D,
    type PowerLineZone,
    REQUIRED_DISCLAIMER,
    type RoadZone,
    type SiteProject,
    type SupplyZone,
} from "./types";

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

/**
 * Shoelace formula: area of a closed 2-D polygon.
 * Points do NOT need to repeat the first vertex at the end.
 */
export function calculatePolygonArea(points: Point2D[]): number {
    const n = points.length;
    if (n < 3) return 0;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

/**
 * Exact area of a rectangle with one corner replaced by a circular fillet.
 * Used only for the hand-calculation reference in tests — the acceptance test
 * compares the shoelace result against this value; it is never used inside
 * parseDxfToSite itself.
 *
 * Rect = width * depth
 * Cutout = R² − (π R²/4)   (square corner minus the quarter-circle)
 */
export function calculateExactFilletedRectArea(width: number, depth: number, filletRadius: number): number {
    const rectArea = width * depth;
    const cornerCutout = filletRadius * filletRadius - (Math.PI * filletRadius * filletRadius) / 4;
    return rectArea - cornerCutout;
}

/**
 * Samples an arc into discrete points along its circumference.
 * Angles are supplied in radians, CCW convention.
 */
export function sampleArc(arc: ArcSegment2D, segments = 32): Point2D[] {
    const points: Point2D[] = [];
    const start = arc.startAngleRad;
    let end = arc.endAngleRad;
    if (end <= start) {
        end += 2 * Math.PI;
    }
    const step = (end - start) / segments;
    for (let i = 0; i <= segments; i++) {
        const theta = start + i * step;
        points.push({
            x: arc.center.x + arc.radius * Math.cos(theta),
            y: arc.center.y + arc.radius * Math.sin(theta),
        });
    }
    return points;
}

// ---------------------------------------------------------------------------
// Boundary chaining
// ---------------------------------------------------------------------------

const EPS = 1e-6;

function ptEq(a: Point2D, b: Point2D): boolean {
    return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/**
 * Given an unordered list of LINE segments and an optional ARC, build a
 * single closed polyline (vertex list) by chaining endpoint-to-endpoint.
 *
 * The arc is inserted at the correct position in the chain when the tail
 * reaches its start point.
 */
function chainBoundary(
    lines: LineSegment2D[],
    arc: ArcSegment2D | undefined,
): { polygon: Point2D[]; neRadius: number; elements: BoundaryElement[] } {
    if (lines.length === 0) {
        throw new Error("Boundary loop does not close: no boundary lines found.");
    }

    const elements: BoundaryElement[] = [];
    const remaining = lines.map((l) => ({ seg: l, used: false }));

    remaining[0].used = true;
    elements.push({ type: "line", segment: remaining[0].seg });
    const polygon: Point2D[] = [{ ...remaining[0].seg.start }, { ...remaining[0].seg.end }];
    let tail = polygon[polygon.length - 1];

    // Compute arc endpoints (if arc exists)
    const arcStartPt: Point2D | undefined = arc
        ? {
              x: arc.center.x + arc.radius * Math.cos(arc.startAngleRad),
              y: arc.center.y + arc.radius * Math.sin(arc.startAngleRad),
          }
        : undefined;
    const arcEndPt: Point2D | undefined = arc
        ? {
              x: arc.center.x + arc.radius * Math.cos(arc.endAngleRad),
              y: arc.center.y + arc.radius * Math.sin(arc.endAngleRad),
          }
        : undefined;
    let arcInserted = false;

    function tryInsertArc(): void {
        if (!arc || !arcStartPt || !arcEndPt || arcInserted) return;
        if (ptEq(tail, arcStartPt)) {
            // Forward (CCW) traversal
            arcInserted = true;
            elements.push({ type: "arc", arc });
            const samples = sampleArc(arc, 32);
            // samples[0] ≈ tail; skip it
            for (let i = 1; i < samples.length; i++) {
                polygon.push({ ...samples[i] });
            }
            tail = polygon[polygon.length - 1];
        } else if (ptEq(tail, arcEndPt)) {
            // Reverse (CW) traversal
            arcInserted = true;
            elements.push({ type: "arc", arc });
            const samples = sampleArc(arc, 32).reverse();
            for (let i = 1; i < samples.length; i++) {
                polygon.push({ ...samples[i] });
            }
            tail = polygon[polygon.length - 1];
        }
    }

    tryInsertArc();

    for (let safety = 0; safety < 100; safety++) {
        let found = false;
        for (const entry of remaining) {
            if (entry.used) continue;
            if (ptEq(tail, entry.seg.start)) {
                entry.used = true;
                elements.push({ type: "line", segment: entry.seg });
                polygon.push({ ...entry.seg.end });
                tail = polygon[polygon.length - 1];
                found = true;
                break;
            }
            if (ptEq(tail, entry.seg.end)) {
                const flipped: LineSegment2D = { start: { ...entry.seg.end }, end: { ...entry.seg.start } };
                entry.used = true;
                elements.push({ type: "line", segment: flipped });
                polygon.push({ ...flipped.end });
                tail = polygon[polygon.length - 1];
                found = true;
                break;
            }
        }
        if (!found) break;
        tryInsertArc();
        if (ptEq(tail, polygon[0])) break;
    }

    // Verify closure: endpoints must meet and all segments must be consumed
    const isClosed = ptEq(tail, polygon[0]);
    const allUsed = remaining.every((r) => r.used);
    const arcChecked = arc ? arcInserted : true;

    if (!isClosed || !allUsed || !arcChecked || polygon.length < 4) {
        throw new Error("Boundary loop does not close: endpoints do not meet.");
    }

    return { polygon, neRadius: arc?.radius ?? 0, elements };
}

// ---------------------------------------------------------------------------
// Label → ID mapping (coordinate-independent)
// ---------------------------------------------------------------------------

/**
 * Derive a stable slug ID from a DXF ANNOTATION label.
 * Uses label text, not coordinates — so the ID is preserved after any
 * geometric transformation (shift, rotation, scale) of the DXF.
 */
function labelToId(label: string): string {
    const l = label.trim().toLowerCase();
    if (l.startsWith("tower a")) return "tower_a";
    if (l.startsWith("tower b")) return "tower_b";
    if (l.startsWith("podium")) return "podium";
    if (l.startsWith("site office")) return "site_office";
    if (l.includes("residential")) return "nb_east";
    if (l.includes("school")) return "nb_north";
    if (l.includes("rebar yard") || l.startsWith("s1 rebar")) return "rebar_yard";
    if (l.includes("formwork") || l.startsWith("s2 formwork")) return "formwork";
    if (l.includes("pump") || l.includes("bucket fill") || l.startsWith("s3")) return "pump";
    if (l.startsWith("gate")) return "gate";
    // Fallback: slugify
    return l
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 32);
}

/** Extract height_m from a label like "TOWER A  G+24  75.0 m" → 75 */
function heightFromLabel(label: string): number | undefined {
    const m = label.match(/(\d+(?:\.\d+)?)\s*m\b/i);
    return m ? parseFloat(m[1]) : undefined;
}

function neighbourRule(label: string): "no_oversail" | "oversail_by_permission" {
    return label.toUpperCase().includes("NO OVERSAIL") ? "no_oversail" : "oversail_by_permission";
}

/** Layers that represent physical areas with footprint polygons */
const BUILDING_LAYERS = new Set(["BUILDING_PROPOSED", "TEMP_WORKS", "NEIGHBOUR", "SUPPLY_ZONE"]);

/** Labels for non-building TEMP_WORKS polygons (gates, hoardings etc.) */
const NON_BUILDING_TEMP_LABELS = new Set(["gate", "hoarding", "fencing", "site_hoarding"]);

// ---------------------------------------------------------------------------
// Parser options
// ---------------------------------------------------------------------------

export interface ParseDxfOptions {
    /** Override heights for named buildings (key = id, value = height in m). */
    buildingHeights?: Record<string, number>;
    disclaimer?: string;
    picks?: PickItem[];
}

// ---------------------------------------------------------------------------
// Main parser — production-level, no hard-coded coordinates
// ---------------------------------------------------------------------------

/**
 * Parse a DXF string into a SiteProject.
 *
 * Design contract:
 * - ALL geometry comes from the DXF entities — no coordinates are hard-coded.
 * - Building IDs are derived from ANNOTATION TEXT labels immediately following
 *   each LWPOLYLINE, not from coordinate comparisons.  Any geometrically
 *   shifted or scaled DXF produces a valid result with identical IDs.
 * - Boundary polygon is built by chaining LINE endpoints and splicing in the
 *   arc sample points; area is the shoelace result on that polygon.
 * - Road bounds (y_from / y_to) are read from ROAD layer horizontal LINE ys.
 * - Power-line x position is read from the POWER_LINE layer vertical LINE.
 */
export function parseDxfToSite(dxfContent: string, options?: ParseDxfOptions): SiteProject {
    const parser = new DxfParser();
    const dxf = parser.parseSync(dxfContent);

    if (!dxf?.entities) {
        throw new Error("Invalid DXF file: no entities found.");
    }

    const allEntities = dxf.entities as any[];

    // -----------------------------------------------------------------------
    // Pre-pass: pair each building-layer LWPOLYLINE with the ANNOTATION TEXT
    // that immediately follows it.  Pattern in sample-site.dxf:
    //   LWPOLYLINE (BUILDING_PROPOSED) → TEXT (ANNOTATION) "TOWER A  G+24  75.0 m"
    // -----------------------------------------------------------------------
    type LabelledPoly = { layer: string; verts: Point2D[]; label: string };
    const labelledPolys: LabelledPoly[] = [];

    for (let i = 0; i < allEntities.length; i++) {
        const e = allEntities[i];
        const layer = (e.layer ?? "").toUpperCase();

        if (e.type !== "LWPOLYLINE" || !e.vertices || e.vertices.length < 3) continue;
        if (!BUILDING_LAYERS.has(layer)) continue;

        const verts: Point2D[] = e.vertices.map((v: { x: number; y: number }) => ({ x: v.x, y: v.y }));

        // Find the next ANNOTATION TEXT (skip non-annotation non-LWPOLYLINE entities in between)
        let label = "";
        for (let j = i + 1; j < allEntities.length; j++) {
            const next = allEntities[j];
            const nl = (next.layer ?? "").toUpperCase();
            if (nl === "ANNOTATION" && next.type === "TEXT") {
                label = (next.text ?? next.value ?? "").trim();
                break;
            }
            // Stop if we hit another building-layer LWPOLYLINE (annotation was missing)
            if (next.type === "LWPOLYLINE" && BUILDING_LAYERS.has(nl)) break;
        }

        labelledPolys.push({ layer, verts, label });
    }

    // -----------------------------------------------------------------------
    // Pass 1: parse boundary geometry, no-go zones, road, power-line
    // -----------------------------------------------------------------------
    const boundaryLines: LineSegment2D[] = [];
    let boundaryArc: ArcSegment2D | undefined;
    const noGoZones: NoGoZone[] = [];
    const roadYs: number[] = [];
    let powerLineX: number | undefined;

    for (const e of allEntities) {
        const layer = (e.layer ?? "").toUpperCase();

        if (layer === "SITE_BOUNDARY") {
            if (e.type === "LINE" && e.vertices?.length >= 2) {
                boundaryLines.push({
                    start: { x: e.vertices[0].x, y: e.vertices[0].y },
                    end: { x: e.vertices[1].x, y: e.vertices[1].y },
                });
            } else if (e.type === "ARC" && e.center != null && e.radius != null) {
                // dxf-parser 1.1.2 returns angles already in RADIANS
                boundaryArc = {
                    center: { x: e.center.x, y: e.center.y },
                    radius: e.radius,
                    startAngleRad: e.startAngle ?? 0,
                    endAngleRad: e.endAngle ?? Math.PI / 2,
                };
            }
        }

        if (layer === "NO_GO" && e.type === "CIRCLE" && e.center != null) {
            noGoZones.push({
                id: `nogo_${Math.round(e.center.x)}_${Math.round(e.center.y)}`,
                label: "Heritage Well (No-Go)",
                center: { x: e.center.x, y: e.center.y },
                radius_m: e.radius,
                source: "INDICATIVE heritage survey",
            });
        }

        if (layer === "ANNOTATION" && e.type === "TEXT") {
            const txt = (e.text ?? e.value ?? "").toUpperCase();
            if ((txt.includes("HERITAGE WELL") || txt.includes("NO-GO")) && noGoZones.length > 0) {
                noGoZones[noGoZones.length - 1].id = "well";
                noGoZones[noGoZones.length - 1].label = "Heritage Well (No-Go)";
            }
        }

        if (layer === "ROAD" && e.type === "LINE" && e.vertices?.length >= 2) {
            const y0: number = e.vertices[0].y;
            const y1: number = e.vertices[1].y;
            if (Math.abs(y0 - y1) < EPS && !roadYs.includes(y0)) {
                roadYs.push(y0);
            }
        }

        if (layer === "POWER_LINE" && e.type === "LINE" && e.vertices?.length >= 2) {
            const x0: number = e.vertices[0].x;
            const x1: number = e.vertices[1].x;
            if (Math.abs(x0 - x1) < EPS) {
                powerLineX = x0;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Pass 2: convert labelled polys → buildings / supply zones
    // -----------------------------------------------------------------------
    const buildings: Record<string, BuildingFootprint> = {};
    const supplyZones: Record<string, SupplyZone> = {};
    const noOversailIds: string[] = [];
    const oversailByPermissionIds: string[] = [];

    for (const { layer, verts, label } of labelledPolys) {
        const id = labelToId(label);
        const rawHeight = heightFromLabel(label);
        const height = options?.buildingHeights?.[id] ?? rawHeight ?? 10.0;

        if (layer === "SUPPLY_ZONE") {
            supplyZones[id] = { id, layer, label, polygon: verts, height_m: 0 };
            continue;
        }

        if (layer === "NEIGHBOUR") {
            const rule = neighbourRule(label);
            buildings[id] = {
                id,
                layer,
                label,
                polygon: verts,
                height_m: height,
                source: "INDICATIVE sample site specifications",
                isNeighbour: true,
                neighbourRule: rule,
            };
            if (rule === "no_oversail") noOversailIds.push(id);
            else oversailByPermissionIds.push(id);
            continue;
        }

        // BUILDING_PROPOSED or TEMP_WORKS
        // Skip non-building TEMP_WORKS items (gate, fencing, etc.)
        if (layer === "TEMP_WORKS" && NON_BUILDING_TEMP_LABELS.has(id)) continue;

        buildings[id] = {
            id,
            layer,
            label,
            polygon: verts,
            height_m: height,
            source: "INDICATIVE sample site specifications",
            isNeighbour: false,
        };
    }

    // -----------------------------------------------------------------------
    // Build boundary closed polygon from chained segments
    // -----------------------------------------------------------------------
    const { polygon: rawPolygon, neRadius, elements } = chainBoundary(boundaryLines, boundaryArc);

    // Bounding box for width/depth metadata (derived from DXF coordinates)
    const xs = rawPolygon.map((p) => p.x);
    const ys = rawPolygon.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width_m = Math.round((maxX - minX) * 1e6) / 1e6;
    const depth_m = Math.round((maxY - minY) * 1e6) / 1e6;

    // Area from shoelace on the actual DXF polygon — NOT from the formula
    const area_m2 = calculatePolygonArea(rawPolygon);

    const boundary: PlotBoundary = {
        layer: "SITE_BOUNDARY",
        width_m,
        depth_m,
        ne_corner_arc_r: neRadius > 0 ? neRadius : undefined,
        elements,
        polygon: rawPolygon,
        area_m2,
    };

    // -----------------------------------------------------------------------
    // Road zone
    // -----------------------------------------------------------------------
    let roadZone: RoadZone | undefined;
    if (roadYs.length >= 2) {
        roadYs.sort((a, b) => a - b);
        roadZone = {
            layer: "ROAD",
            y_from_m: roadYs[0],
            y_to_m: roadYs[roadYs.length - 1],
            rule: "no load over carriageway",
        };
    }

    // -----------------------------------------------------------------------
    // Power-line zone
    // -----------------------------------------------------------------------
    let powerLineZone: PowerLineZone | undefined;
    if (powerLineX !== undefined) {
        powerLineZone = {
            layer: "POWER_LINE",
            x_m: powerLineX,
            voltage_kv: 22,
            clearance_m: 6.0,
            clearance_note: "INDICATIVE sample value; real figure from local electricity authority",
        };
    }

    return {
        schema_version: "1.0",
        name: "DGOC sample site (synthetic)",
        disclaimer: options?.disclaimer ?? REQUIRED_DISCLAIMER,
        units: "m",
        origin: `SW corner of plot = (${Math.round(minX)},${Math.round(minY)}); +x east, +y north`,
        boundary,
        buildings,
        supply_zones: supplyZones,
        no_go_zones: noGoZones,
        road: roadZone,
        power_line: powerLineZone,
        no_oversail: noOversailIds,
        oversail_by_permission: oversailByPermissionIds,
        picks: options?.picks ?? [],
    };
}
