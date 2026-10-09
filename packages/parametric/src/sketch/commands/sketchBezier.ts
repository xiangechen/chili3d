// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    Dimensions,
    type IStep,
    Precision,
    type ShapeMeshData,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import type { TentativeEntity } from "../autoConstraints";
import { sampleEntity, subNurbs } from "../curveEval";
import { ConstraintKind, clampedUniformKnots, defaultNurbsDegree, toUV, toWorld } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/** The control points of one cubic: the tool's own count, garlic's bezier being fixed at four. */
const CURVE_POINTS = 4;

/**
 * The chain's segments for a pole list: the spans of the clamped uniform B-spline the poles
 * are the control points of, each as a cubic.
 *
 * The poles are the points the user clicked, and the curve is drawn *by* them rather than
 * through them: a clamped B-spline starts and ends at its first and last control point and
 * passes through none of the others, which is what a control-point spline is (Onshape's and
 * Fusion's control-point spline, SolidWorks' style spline). Its spans are what the chain is
 * made of — a clamped B-spline's span *is* a Bézier — and consecutive spans meet smoothly: at
 * an interior knot of multiplicity one the two handles are one tangent seen from its two
 * sides, and the joint between them is their midpoint.
 *
 * The degree is the one the sketch gives a spline of that many control points
 * (`defaultNurbsDegree`), so a two-point chain is a line and a three-point one a quadratic; a
 * span below cubic is raised to it, the entity being a fixed cubic.
 */
function chainSegments(poles: readonly [number, number][]): [number, number][][] {
    if (poles.length < 2) return [];
    const degree = defaultNurbsDegree(poles.length);
    const spec = { degree, knots: clampedUniformKnots(poles.length, degree) };
    const weights = new Array<number>(poles.length).fill(1);
    const spans: [number, number][][] = [];
    // the domain runs from the first knot the curve is clamped at to the last, with one span
    // between each pair of knots after it
    for (let index = degree; index < poles.length; index++) {
        const piece = subNurbs(poles, weights, spec, spec.knots[index], spec.knots[index + 1]);
        if (piece !== undefined) spans.push(elevateToCubic(piece.poles));
    }
    return spans;
}

/**
 * The poles of a piece as a cubic — the degree a line or a quadratic is raised to, so every
 * segment of the chain is the same kind of entity. Each step carries the differences a step
 * along: `b'_i = b_i + (b_{i−1} − b_i)·i/(n+1)`.
 */
function elevateToCubic(poles: [number, number][]): [number, number][] {
    let raised = poles;
    while (raised.length > 0 && raised.length < CURVE_POINTS) {
        const next: [number, number][] = [raised[0]];
        for (let index = 1; index < raised.length; index++) {
            const scale = index / raised.length;
            next.push([
                raised[index][0] + (raised[index - 1][0] - raised[index][0]) * scale,
                raised[index][1] + (raised[index - 1][1] - raised[index][1]) * scale,
            ]);
        }
        next.push(raised[raised.length - 1]);
        raised = next;
    }
    return raised;
}

/**
 * The bezier tool draws a chain of cubics *by* the points it is given: every pick after the
 * first is a control point, and the chain is the clamped uniform B-spline those control
 * points draw — cut into one entity per span, so a new segment appears on every pick once the
 * chain has four of them. It is the continuous gesture the line tool draws segments with, and
 * the shape a control-point spline has: the curve is pulled towards the points rather than
 * passing through them, and only the first and last of them are on it.
 *
 * Nothing about the handles is the user's to pick, but everything about them is the user's to
 * edit: they are ordinary points of the sketch, and the joint is held by two constraints on
 * them — a coincidence at the point the spans share, and the two handles at it held collinear
 * with it. So the smoothness is a relation the user can see and change (delete the second and
 * the joint becomes a corner) rather than a property of the curve that only exists where it
 * was drawn.
 *
 * A point added later therefore *refits* the chain: every span's control points depend on the
 * control points around it, so the last segment in particular changes shape as the curve
 * grows towards the point just placed. That is a spline following its control points. What it
 * does not do is re-derive on an edit: the handles are ordinary control points from then on,
 * so dragging one moves the curve (the tangency keeps the joints smooth) rather than refitting
 * the chain around it.
 *
 * Escape (or Enter) ends the chain at the points already placed — a lone first point draws
 * nothing. Picking the chain's first point again closes it: the curve's last control point
 * lands where its first one is, and the tool ties the two ends together; no tangency is stated
 * there, the closing span's handles not having been derived for it.
 */
@command({ key: "sketch.bezier", icon: "icon-bezier" })
export class SketchBezierCommand extends SketchMultistepCommand {
    /** The control points the chain is drawn by, in order, as they were picked. */
    private poles: [number, number][] = [];
    /** The chain's segments, by entity id, one span of the spline each. */
    private segments: number[] = [];

    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPointOrFinish", this.getNextPointData),
        ];
    }

    protected override async executeAsync(): Promise<void> {
        if (!(await this.canExcute())) return;

        const steps = this.getSteps();
        while (true) {
            this.poles = [];
            this.segments = [];
            const start = await this.pick(steps[0]);
            if (start === undefined) return;

            this.poles.push(toUV(this.editor.node.plane, start.point!));
            this.stepDatas = [start];
            await this.extendChain(steps[1]);
            // the panel's ✗ ends the tool, while Escape/Enter only ends the chain
            if (this.isCanceled) return;
        }
    }

    /** The chain commits its segments as the points come; this is never reached (see `executeAsync`). */
    protected executeMainTask(): void {}

    /**
     * The chain's control points are the tool's own derivation, not the user's picks (which
     * are not points of any entity), so the drawing hints have nothing here to read: every
     * relation the chain has is stated by the tool itself.
     */
    protected override takesAutoConstraints(): boolean {
        return false;
    }

    /** Adds control points until the pick ends; every one past the first grows the chain. */
    private async extendChain(step: IStep): Promise<void> {
        while (true) {
            const next = await this.pick(step);
            if (next === undefined) return;

            const closes = this.closesChain(next.point!);
            this.poles.push(toUV(this.editor.node.plane, next.point!));
            this.commitChain(closes);
            if (closes) return;
            this.stepDatas = [next];
        }
    }

    /**
     * Brings the committed segments in line with the control points picked so far: the ones
     * already there are rewritten (the new point bends every span near it, and above all the
     * last), and the ones the chain has grown into are added — each tied to the one before it,
     * the joint's coincidence coming from the snap that sees the two ends meet.
     */
    private commitChain(closes: boolean): void {
        const wanted = chainSegments(this.poles);
        if (wanted.length === 0) return;
        for (let index = 0; index < this.segments.length; index++) {
            this.writeSegment(this.segments[index], wanted[index]);
        }
        for (const points of wanted.slice(this.segments.length)) {
            const id = this.editor.solver.addBezier(points.flat());
            const previous = this.segments.at(-1);
            if (previous !== undefined) this.joinToPrevious(previous, id);
            this.segments.push(id);
        }
        if (closes) this.closeLoop();
        const last = this.segments.at(-1);
        if (last !== undefined) this.commitNewEntity(last);
    }

    /**
     * Holds a closed chain's two ends together — the control point the curve ends at and the
     * one it started from. Stated by the tool rather than left to the snap, a chain's spans
     * taking no auto-constraints (`takesAutoConstraints`).
     */
    private closeLoop(): void {
        const first = this.segments[0];
        const last = this.segments.at(-1);
        if (first === undefined || last === undefined) return;
        this.editor.solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: last, pointIndex: CURVE_POINTS - 1 },
                { entityId: first, pointIndex: 0 },
            ],
        });
    }

    /** Writes a segment's control points in place: a refit is the same entity, reshaped. */
    private writeSegment(id: number, points: readonly [number, number][]): void {
        if (points.length !== CURVE_POINTS) return;
        points.forEach(([u, v], pointIndex) => {
            this.editor.solver.setPointPosition({ entityId: id, pointIndex }, u, v);
        });
    }

    /**
     * Ties a new segment to the one before it, both relations stated on the *handles* rather
     * than on the curves: the joint is one point — the two segments' own ends are written to
     * it by the derivation, so the coincidence holds as stated rather than settling — and the
     * two handles at it are collinear with the joint, which is what "the segments meet
     * tangentially" comes to (the tangent a clamped end leaves along is the line to its
     * handle, so the two tangents are parallel exactly when the three points are in line).
     *
     * garlic's curve-curve tangency would say the same thing of the curves, at a *contact* it
     * finds with two auxiliary parameters of its own; stating it on the handles keeps the
     * relation the user can see — and can edit, a handle being a point of the sketch like any
     * other — with nothing left over for the solver to settle.
     */
    private joinToPrevious(previousId: number, id: number): void {
        this.editor.solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: previousId, pointIndex: CURVE_POINTS - 1 },
                { entityId: id, pointIndex: 0 },
            ],
        });
        this.editor.solver.addConstraint({
            kind: ConstraintKind.Parallel,
            refs: [
                { entityId: previousId, pointIndex: 2 },
                { entityId: previousId, pointIndex: CURVE_POINTS - 1 },
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 1 },
            ],
        });
    }

    /**
     * Whether the pick landed on the first control point — that ends the chain, and the loop
     * closes through the coincidence the snap adds between the two ends. Read as it is *now*,
     * not as it was picked: a solve may have moved the first pole since.
     */
    private closesChain(point: XYZ): boolean {
        const start = this.poles[0];
        if (start === undefined) return false;
        const [u, v] = toUV(this.editor.node.plane, point);
        return Math.hypot(u - start[0], v - start[1]) <= Precision.Distance;
    }

    private async pick(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        return step.execute(this.document, this.controller);
    }

    private readonly getNextPointData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: this.chainPreview,
        tentative: (probe) => this.pendingSegments(probe).at(-1) ?? undefined,
    });

    /** The chain the probe would make: the spline over the points picked, and the probe. */
    private pendingSegments(probe: [number, number]): TentativeEntity[] {
        return chainSegments([...this.poles, probe]).map((points) => ({
            type: "bezier" as const,
            params: points.flat(),
        }));
    }

    /**
     * The control polygon the chain is being drawn by — the points picked, dashed, as a
     * committed net is drawn — and the curve it draws, which the probe refits.
     */
    private readonly chainPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const last = this.stepDatas[0].point!;
        const meshes: ShapeMeshData[] = [this.meshPoint(last)];
        if (point === undefined) return meshes;
        const probe = toUV(plane, point);
        const dashed = (from: XYZ, to: XYZ) => this.meshLine(from, to, undefined, undefined, "dash");
        for (let index = 1; index < this.poles.length; index++) {
            meshes.push(
                dashed(toWorld(plane, ...this.poles[index - 1]), toWorld(plane, ...this.poles[index])),
            );
        }
        meshes.push(dashed(last, point));
        for (const segment of this.pendingSegments(probe)) {
            meshes.push(this.meshCurvePolyline(sampleEntity(segment)));
        }
        return meshes;
    };
}
