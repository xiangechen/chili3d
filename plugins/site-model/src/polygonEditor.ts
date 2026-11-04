// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { calculatePolygonArea } from "./dxfParser";
import { type Point2D, REQUIRED_DISCLAIMER } from "./types";

/**
 * Supported kinds of site features that can be interactively drawn or edited.
 */
export type SiteFeatureKind = "building" | "road" | "power_line" | "no_go";

/**
 * Interactive site feature with geometric polygon and domain-specific properties.
 */
export interface SiteFeature {
    id: string;
    kind: SiteFeatureKind;
    label: string;
    polygon: Point2D[];
    area_m2: number;
    height_m?: number;
    clearance_m?: number;
    source: string;
    disclaimer: string;
}

/**
 * Creates a new SiteFeature from polygon vertices, calculating area and assigning default metadata.
 */
export function createSiteFeature(options: {
    id: string;
    kind: SiteFeatureKind;
    label: string;
    polygon: Point2D[];
    height_m?: number;
    clearance_m?: number;
    source?: string;
}): Result<SiteFeature, string> {
    if (!options.polygon || options.polygon.length < 3) {
        return Result.err("A polygon must have at least 3 vertices.");
    }

    for (let i = 0; i < options.polygon.length; i++) {
        const pt = options.polygon[i];
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            return Result.err(`Vertex at index ${i} has non-finite coordinates.`);
        }
    }

    const area_m2 = calculatePolygonArea(options.polygon);

    return Result.ok({
        id: options.id,
        kind: options.kind,
        label: options.label,
        polygon: options.polygon.map((p) => ({ ...p })),
        area_m2,
        height_m: options.height_m,
        clearance_m: options.clearance_m,
        source: options.source ?? "INDICATIVE",
        disclaimer: REQUIRED_DISCLAIMER,
    });
}

/**
 * Clones a site feature and moves the vertex at the specified index to a new coordinate,
 * updating the area automatically.
 *
 * Hand-worked calculation reference (Task S6 vertex edit):
 * - Original 10 x 10 m rectangle: (0,0), (10,0), (10,10), (0,10) -> Area = 100 m^2
 * - Edit P2 from (10, 10) to (12, 10) -> forms a right trapezoid:
 *   Base 1 = 10 m, Base 2 = 12 m, Height = 10 m
 *   Trapezoid Area = ((10 + 12) / 2) * 10 = 110.0 m^2
 */
export function movePolygonVertex(
    feature: SiteFeature,
    vertexIndex: number,
    newPos: Point2D,
): Result<SiteFeature, string> {
    if (vertexIndex < 0 || vertexIndex >= feature.polygon.length) {
        return Result.err(
            `Invalid vertex index ${vertexIndex}; polygon has ${feature.polygon.length} vertices.`,
        );
    }

    if (!Number.isFinite(newPos.x) || !Number.isFinite(newPos.y)) {
        return Result.err("New vertex position must have finite coordinates.");
    }

    const newPolygon = feature.polygon.map((p, idx) => (idx === vertexIndex ? { ...newPos } : { ...p }));
    const area_m2 = calculatePolygonArea(newPolygon);

    return Result.ok({
        ...feature,
        polygon: newPolygon,
        area_m2,
    });
}

/**
 * Inserts a new vertex into the polygon after the specified index.
 */
export function insertPolygonVertex(
    feature: SiteFeature,
    afterIndex: number,
    newPos: Point2D,
): Result<SiteFeature, string> {
    if (afterIndex < -1 || afterIndex >= feature.polygon.length) {
        return Result.err(`Invalid insertion index ${afterIndex}.`);
    }

    if (!Number.isFinite(newPos.x) || !Number.isFinite(newPos.y)) {
        return Result.err("Inserted vertex position must have finite coordinates.");
    }

    const newPolygon = [...feature.polygon];
    newPolygon.splice(afterIndex + 1, 0, { ...newPos });
    const area_m2 = calculatePolygonArea(newPolygon);

    return Result.ok({
        ...feature,
        polygon: newPolygon,
        area_m2,
    });
}

/**
 * Removes a vertex from the polygon if it has more than 3 vertices remaining.
 */
export function removePolygonVertex(feature: SiteFeature, vertexIndex: number): Result<SiteFeature, string> {
    if (feature.polygon.length <= 3) {
        return Result.err("Cannot delete vertex: a polygon must have at least 3 vertices.");
    }

    if (vertexIndex < 0 || vertexIndex >= feature.polygon.length) {
        return Result.err(`Invalid vertex index ${vertexIndex}.`);
    }

    const newPolygon = feature.polygon.filter((_, idx) => idx !== vertexIndex);
    const area_m2 = calculatePolygonArea(newPolygon);

    return Result.ok({
        ...feature,
        polygon: newPolygon,
        area_m2,
    });
}

/**
 * Command action interface for editor undo/redo history.
 */
export interface EditorAction {
    name: string;
    execute: () => void;
    undo: () => void;
}

/**
 * Interactive site model polygon editor managing features and an undo/redo stack.
 */
export class SitePolygonEditor {
    private _features: Map<string, SiteFeature> = new Map();
    private _undoStack: EditorAction[] = [];
    private _redoStack: EditorAction[] = [];

    get features(): readonly SiteFeature[] {
        return Array.from(this._features.values());
    }

    getFeature(id: string): SiteFeature | undefined {
        return this._features.get(id);
    }

    canUndo(): boolean {
        return this._undoStack.length > 0;
    }

    canRedo(): boolean {
        return this._redoStack.length > 0;
    }

    /**
     * Executes an action, pushes it onto the undo stack, and clears the redo stack.
     */
    executeAction(action: EditorAction): void {
        action.execute();
        this._undoStack.push(action);
        this._redoStack = [];
    }

    undo(): boolean {
        const action = this._undoStack.pop();
        if (!action) return false;
        action.undo();
        this._redoStack.push(action);
        return true;
    }

    redo(): boolean {
        const action = this._redoStack.pop();
        if (!action) return false;
        action.execute();
        this._undoStack.push(action);
        return true;
    }

    /**
     * Adds a new feature with undo support.
     */
    addFeature(feature: SiteFeature): void {
        const action: EditorAction = {
            name: `Add ${feature.kind} (${feature.id})`,
            execute: () => {
                this._features.set(feature.id, feature);
            },
            undo: () => {
                this._features.delete(feature.id);
            },
        };
        this.executeAction(action);
    }

    /**
     * Removes an existing feature with undo support.
     */
    removeFeature(id: string): Result<void, string> {
        const existing = this._features.get(id);
        if (!existing) {
            return Result.err(`Feature '${id}' not found.`);
        }

        const action: EditorAction = {
            name: `Remove ${existing.kind} (${id})`,
            execute: () => {
                this._features.delete(id);
            },
            undo: () => {
                this._features.set(id, existing);
            },
        };
        this.executeAction(action);
        return Result.ok(undefined);
    }

    /**
     * Moves a vertex of a feature with undo/redo support.
     */
    moveVertex(id: string, vertexIndex: number, newPos: Point2D): Result<SiteFeature, string> {
        const feature = this._features.get(id);
        if (!feature) {
            return Result.err(`Feature '${id}' not found.`);
        }

        const oldPos = feature.polygon[vertexIndex];
        if (!oldPos) {
            return Result.err(`Vertex index ${vertexIndex} is out of bounds.`);
        }

        const movedRes = movePolygonVertex(feature, vertexIndex, newPos);
        if (!movedRes.isOk) return movedRes;
        const updated = movedRes.value;

        const action: EditorAction = {
            name: `Move vertex ${vertexIndex} of ${id}`,
            execute: () => {
                this._features.set(id, updated);
            },
            undo: () => {
                this._features.set(id, feature);
            },
        };
        this.executeAction(action);
        return Result.ok(updated);
    }
}
