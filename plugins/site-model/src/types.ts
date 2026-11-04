// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Mandatory legal disclaimer that must appear on every screen and report.
 * Rule: "Planning aid, not a certified lift plan."
 */
export const REQUIRED_DISCLAIMER = "Planning aid, not a certified lift plan.";

/**
 * 2D point in metres (X = east, Y = north).
 */
export interface Point2D {
    x: number;
    y: number;
}

/**
 * Circular Arc segment in 2D.
 */
export interface ArcSegment2D {
    center: Point2D;
    radius: number;
    startAngleRad: number;
    endAngleRad: number;
}

/**
 * Line segment in 2D.
 */
export interface LineSegment2D {
    start: Point2D;
    end: Point2D;
}

/**
 * Boundary element: either a straight line or a circular arc.
 */
export type BoundaryElement = { type: "line"; segment: LineSegment2D } | { type: "arc"; arc: ArcSegment2D };

/**
 * Plot boundary definition.
 */
export interface PlotBoundary {
    layer: string;
    width_m: number;
    depth_m: number;
    ne_corner_arc_r?: number;
    elements: BoundaryElement[];
    /** Closed polyline vertices in counter-clockwise order approximating arcs if sampled */
    polygon: Point2D[];
    area_m2: number;
}

/**
 * Building or structure footprint on site.
 */
export interface BuildingFootprint {
    id: string;
    layer: string;
    label: string;
    polygon: Point2D[];
    height_m: number;
    source: string; // Source document or "INDICATIVE"
    isNeighbour?: boolean;
    neighbourRule?: "no_oversail" | "oversail_by_permission";
}

/**
 * No-go exclusion zone (e.g. heritage well or underground tank).
 */
export interface NoGoZone {
    id: string;
    label?: string;
    center: Point2D;
    radius_m: number;
    source: string;
}

/**
 * Public road or access way boundary.
 */
export interface RoadZone {
    layer: string;
    y_from_m: number;
    y_to_m: number;
    rule: string;
}

/**
 * Overhead power line hazard.
 */
export interface PowerLineZone {
    layer: string;
    x_m: number;
    voltage_kv: number;
    clearance_m: number;
    clearance_note: string;
}

/**
 * Supply/material laydown zone (e.g. rebar yard, formwork store).
 */
export interface SupplyZone {
    id: string;
    layer: string;
    label: string;
    polygon: Point2D[];
    height_m: number;
}

/**
 * Lift pick item definition.
 */
export interface PickItem {
    id: string;
    what: string;
    load_t: number;
    from: string;
    from_xy: [number, number];
    to_xy: [number, number];
}

/**
 * Full Site Model project schema (v1).
 * Both Tower Crane Planner and Mobile Crane Planner read and write this shared format.
 */
export interface SiteProject {
    schema_version: "1.0";
    name: string;
    disclaimer: string;
    units: "m";
    origin: string;
    boundary: PlotBoundary;
    buildings: Record<string, BuildingFootprint>;
    supply_zones: Record<string, SupplyZone>;
    no_go_zones: NoGoZone[];
    road?: RoadZone;
    power_line?: PowerLineZone;
    no_oversail: string[];
    oversail_by_permission: string[];
    picks: PickItem[];
}

/**
 * Unit conversion: metres to millimetres (CAD kernel boundary).
 * Rule: Chili3D internal is mm, site data is metres.
 */
export function metresToMm(m: number): number {
    return m * 1000;
}

/**
 * Unit conversion: millimetres to metres (Reporting / UI boundary).
 */
export function mmToMetres(mm: number): number {
    return mm / 1000;
}
