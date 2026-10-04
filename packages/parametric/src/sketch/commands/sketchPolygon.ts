// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    Dimensions,
    type I18nKeys,
    type IStep,
    Precision,
    PubSub,
    property,
    type XYZ,
} from "@chili3d/core";
import { applyPointAutoConstraints } from "../autoConstraints";
import { ConstraintKind, toUV, toWorld } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { centerRef, joinLoop, lineRefs } from "../solverEntities";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/**
 * Which point the second pick defines. Inscribed: the pick is a vertex and its
 * distance is the circumradius. Circumscribed: the pick is an edge midpoint and its
 * distance is the apothem — the same split Fusion's polygon tool makes.
 */
const POLYGON_INSCRIBED: I18nKeys = "option.command.polygonMode.inscribed";
const POLYGON_CIRCUMSCRIBED: I18nKeys = "option.command.polygonMode.circumscribed";

/** A regular polygon in sketch (u, v), before it becomes solver entities. */
export interface RegularPolygonLayout {
    readonly center: [number, number];
    /** Radius of the circle through every vertex — the carrier the rigidity constraints pin to. */
    readonly circumradius: number;
    /**
     * Radius of the circle the edges are tangent to: the distance the user picked, so
     * it exists only in circumscribed mode. It is a different circle from the carrier
     * through the vertices, so it is added as a second entity — see `addRegularPolygon`.
     */
    readonly incircle?: number;
    /** Angle of the first vertex, radians. */
    readonly first: number;
    readonly sides: number;
}

/**
 * The regular polygon `center` and `picked` describe. `circumscribed` reads the
 * pick the way Fusion's circumscribed mode does — the distance to an edge rather
 * than to a vertex — so the circumradius is that over cos(π/N), and the first
 * vertex starts half a step before the picked direction, which is where the first
 * edge's midpoint sits. Inscribed needs neither: the pick is the first vertex.
 */
export function regularPolygonLayout(
    center: [number, number],
    picked: [number, number],
    sides: number,
    circumscribed: boolean,
): RegularPolygonLayout {
    const step = (Math.PI * 2) / sides;
    const distance = Math.hypot(picked[0] - center[0], picked[1] - center[1]);
    return {
        center,
        circumradius: circumscribed ? distance / Math.cos(step / 2) : distance,
        ...(circumscribed ? { incircle: distance } : {}),
        first: Math.atan2(picked[1] - center[1], picked[0] - center[0]) - (circumscribed ? step / 2 : 0),
        sides,
    };
}

/** The layout's vertices, in loop order — vertex i starts the edge `lineIds[i]`. */
export function regularPolygonVertices(layout: RegularPolygonLayout): [number, number][] {
    const step = (Math.PI * 2) / layout.sides;
    const [cx, cy] = layout.center;
    return Array.from({ length: layout.sides }, (_, i) => {
        const angle = layout.first + i * step;
        return [cx + layout.circumradius * Math.cos(angle), cy + layout.circumradius * Math.sin(angle)];
    });
}

export interface RegularPolygonIds {
    readonly lineIds: number[];
    /** The construction circle through every vertex; carries the rigidity constraints. */
    readonly circleId: number;
    /** The construction circle the edges are tangent to, present only in circumscribed mode. */
    readonly incircleId?: number;
}

/**
 * Adds the polygon as N lines closed into a loop, plus the construction circle
 * through their vertices.
 *
 * The circle is the rigidity carrier, not decoration: the vertices pinned onto it
 * (`PointOnCircle`) together with the equal-length chain make the loop regular, so
 * dragging any vertex keeps the shape a regular polygon. Vertices-on-a-circle plus
 * equal edges pins exactly the 4 remaining degrees of freedom a regular polygon has
 * (center, size, rotation) — equal edges alone would leave the loop free to shear
 * into a rhombus. The circle is construction geometry, so it never enters a profile;
 * like every construction entity it stays drawn and pickable, which is what lets the
 * user delete it once the edges it holds are gone.
 *
 * Circumscribed mode picks a circle the carrier cannot be: the one the edges are
 * tangent to, which is a *smaller* circle than the one through the vertices. A
 * circle cannot both hold the vertices and be tangent to the edges — pinning the
 * edges instead (`TangentLineCircle`) constrains nothing, since any closed
 * equidistant loop already has an incircle. So that mode adds the picked circle as
 * a second, tangent-pinned entity (see `addIncircle`), alongside the carrier rather
 * than in place of it.
 */
export function addRegularPolygon(solver: SketchSolver, layout: RegularPolygonLayout): RegularPolygonIds {
    const vertices = regularPolygonVertices(layout);
    const lineIds = vertices.map((vertex, i) => {
        const next = vertices[(i + 1) % vertices.length];
        return solver.addLine(vertex[0], vertex[1], next[0], next[1]);
    });
    joinLoop(solver, lineIds);

    const [cx, cy] = layout.center;
    const circleId = solver.addCircle(cx, cy, layout.circumradius);
    solver.setConstruction(circleId, true);

    for (const lineId of lineIds) {
        solver.addConstraint({
            kind: ConstraintKind.PointOnCircle,
            refs: [{ entityId: lineId, pointIndex: 0 }, centerRef(circleId)],
        });
    }
    for (let i = 0; i < lineIds.length - 1; i++) {
        // EqualLength, not Equal: the latter is garlic's scalar kind and has no
        // two-line form on this side of the FFI.
        solver.addConstraint({
            kind: ConstraintKind.EqualLength,
            refs: [...lineRefs(lineIds[i]), ...lineRefs(lineIds[i + 1])],
        });
    }

    if (layout.incircle === undefined) return { lineIds, circleId };
    return { lineIds, circleId, incircleId: addIncircle(solver, [cx, cy], layout.incircle, lineIds) };
}

/**
 * The circumscribed polygon's picked circle, tangent to every edge.
 *
 * Three tangencies pin it: its centre and radius are three unknowns, so three
 * equations leave nothing over — no redundancy for the solver to report. The
 * remaining edges are tangent for free, since a regular polygon's incircle is a
 * single circle; the pinned three only have to be spread out rather than share a
 * corner, so nothing about the pinning favours one end of the loop.
 */
function addIncircle(
    solver: SketchSolver,
    center: readonly [number, number],
    radius: number,
    lineIds: readonly number[],
): number {
    const incircleId = solver.addCircle(center[0], center[1], radius);
    solver.setConstruction(incircleId, true);

    const count = lineIds.length;
    const spread = [0, Math.floor(count / 3), Math.floor((count * 2) / 3)];
    for (const index of spread) {
        solver.addConstraint({
            kind: ConstraintKind.TangentLineCircle,
            refs: [...lineRefs(lineIds[index]), centerRef(incircleId)],
        });
    }
    return incircleId;
}

/**
 * A regular polygon from a center pick and a pick that sets its size and rotation.
 *
 * It lands as N independent lines, not a polygon object — the solver has no such
 * entity type, the same shape FreeCAD's regular polygon takes. Its construction
 * circles are serialized with them: the carrier through the vertices in both modes,
 * plus the picked incircle in circumscribed mode. Both stay visible and pickable as
 * ordinary construction geometry, and both show their constraints in the editor's
 * constraint panel.
 */
@command({ key: "sketch.polygon", icon: "icon-polygon" })
export class SketchPolygonCommand extends SketchMultistepCommand {
    /** Sides of the polygon; garlic's angular step needs at least a triangle. */
    @property("regularPolygon.sides")
    get sides(): number {
        return this.getPrivateValue("sides", 6);
    }
    set sides(value: number) {
        if (!Number.isFinite(value) || value < 3) return;
        this.setProperty("sides", Math.floor(value));
    }

    @property("option.command.polygonMode", {
        combobox: Combobox.from([POLYGON_INSCRIBED, POLYGON_CIRCUMSCRIBED] satisfies I18nKeys[]),
    })
    get polygonMode(): I18nKeys {
        return this.getPrivateValue("polygonMode", POLYGON_INSCRIBED);
    }
    set polygonMode(value: I18nKeys) {
        this.setProperty("polygonMode", value);
    }

    private get circumscribed(): boolean {
        return this.polygonMode === POLYGON_CIRCUMSCRIBED;
    }

    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickCircleCenter"),
            new SketchPointStep("prompt.pickRadius", this.getRadiusData),
        ];
    }

    protected executeMainTask(): void {
        const layout = regularPolygonLayout(this.uvOf(0), this.uvOf(1), this.sides, this.circumscribed);
        if (layout.circumradius < Precision.Distance) {
            PubSub.default.pub("displayError", "Polygon is too small to place");
            return;
        }

        const solver = this.editor.solver;
        const { lineIds, circleId, incircleId } = addRegularPolygon(solver, layout);
        if (this.construction) {
            for (const id of lineIds) solver.setConstruction(id, true);
        }

        // Points only, never `applyAutoConstraints`: that pass judges tangency against the
        // drawn geometry and excludes nothing but the entity itself, so a polygon whose
        // apothem sits within snap distance of its own circumradius — any hexagon under a
        // few millimetres on screen — would be handed a tangent constraint between the
        // carrier circle and one of the edges it exists to hold.
        //
        // Every entity the polygon just made is excluded, the carrier included: it is the
        // one the two snapped points are defined against. A vertex under snap distance of
        // the circumradius sits that close to the carrier's centre, and snapping it there
        // both moved the vertex onto the centre and had `subsumedIncidence` delete the
        // PointOnCircle holding the vertex out — collapsing the polygon into a fan. The
        // centre snapping onto its own circle would collapse it just as well, by pinning
        // the radius to zero.
        const options = { pointTolerance: this.editor.screenTolerance() };
        const snapped = [centerRef(circleId)];
        // inscribed: the pick IS the first vertex. Circumscribed's pick is an edge
        // midpoint, which no entity point stands at, so only the center snaps.
        if (!this.circumscribed) snapped.push({ entityId: lineIds[0], pointIndex: 0 });
        applyPointAutoConstraints(
            solver,
            snapped,
            [...lineIds, ...(incircleId ? [incircleId] : []), circleId],
            options,
        );

        this.editor.solve(true);
        this.editor.commit();
    }

    private readonly getRadiusData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1,
        preview: this.polygonPreview,
    });

    private readonly polygonPreview = (point: XYZ | undefined) => {
        const center = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(center)];
        }
        const plane = this.editor.node.plane;
        const layout = regularPolygonLayout(this.uvOf(0), toUV(plane, point), this.sides, this.circumscribed);
        const vertices = regularPolygonVertices(layout).map(([u, v]) => toWorld(plane, u, v));
        return [
            this.meshPoint(center),
            this.meshLine(center, point),
            ...vertices.map((vertex, i) => this.meshLine(vertex, vertices[(i + 1) % vertices.length])),
            // the circle the user is drawing: the carrier's circumradius in inscribed
            // mode, the picked incircle in circumscribed mode — the same circle the
            // command goes on to commit
            this.meshCreatedShape("circle", plane.normal, center, layout.incircle ?? layout.circumradius),
        ];
    };
}
