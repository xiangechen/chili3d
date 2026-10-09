// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    Dimensions,
    type IStep,
    type ShapeMeshData,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { sampleEntity } from "../curveEval";
import { ConstraintKind, defaultNurbsSpec, nurbsParams, toUV, toWorld } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/**
 * The NURBS tool draws a control polygon: every pick after the first adds a control point,
 * and Escape (or Enter) ends the polygon and commits the curve — a one-point polygon commits
 * nothing, and the panel's ✗ abandons it. Picking the first point again closes the polygon
 * onto it, the way the line chain closes its loop: the closing point is written to the first
 * one's place and the two are coincident-linked, so the curve closes. The tool then stays
 * armed for the next curve, like the line tool does.
 *
 * The curve is garlic's general rational B-spline, built the way every CAD sketch tool
 * builds a spline: cubic where there are control points enough for it, clamped uniform
 * knots, and unit weights (a plain B-spline). Nothing else about it is asked for here —
 * degree, knots and weights are the entity's own, and the tools that would edit them are a
 * question of their own.
 *
 * Nothing is committed mid-chain: the curve is one entity, so the auto-constraints and the
 * undo step run once, over every control point at the end.
 */
@command({ key: "sketch.nurbs", icon: "icon-toPoly" })
export class SketchNurbsCommand extends SketchMultistepCommand {
    /** The control points collected so far, in sketch uv — `stepDatas[0]` is the chain's end. */
    private poles: [number, number][] = [];

    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPointOrFinish", this.getNextPoleData),
        ];
    }

    protected override async executeAsync(): Promise<void> {
        if (!(await this.canExcute())) return;

        const steps = this.getSteps();
        while (true) {
            this.poles = [];
            const start = await this.pick(steps[0]);
            if (start === undefined) return;

            this.poles.push(toUV(this.editor.node.plane, start.point!));
            this.stepDatas = [start];
            await this.extendPolygon(steps[1]);
            // the panel's ✗ ends the tool, while Escape/Enter only ends the polygon
            if (this.isCanceled) return;
        }
    }

    /** The chain itself commits nothing; this is never reached (see `executeAsync`). */
    protected executeMainTask(): void {}

    /** Adds control points until the pick ends — or lands back on the first, which closes it. */
    private async extendPolygon(step: IStep): Promise<void> {
        while (true) {
            const next = await this.pick(step);
            if (next === undefined) {
                this.commitPolygon(false);
                return;
            }
            const uv = toUV(this.editor.node.plane, next.point!);
            const closes = this.closesPolygon(uv);
            const first = this.poles[0];
            this.poles.push(closes ? [first[0], first[1]] : uv);
            if (closes) {
                this.commitPolygon(true);
                return;
            }
            this.stepDatas = [next];
        }
    }

    /**
     * Whether the pick landed back on the first control point. The control points are not
     * sketch entities while the tool runs — nothing is committed until the end — so the cursor
     * cannot snap to the first one; the pick is read against the screen tolerance instead,
     * which is the drawing hints' own reading of "the same place".
     */
    private closesPolygon(uv: [number, number]): boolean {
        const first = this.poles[0];
        if (first === undefined) return false;
        return Math.hypot(uv[0] - first[0], uv[1] - first[1]) <= this.editor.screenTolerance();
    }

    /**
     * Commits the polygon as one curve: nothing for a lone point, and nothing when the panel's
     * ✗ abandoned the tool (Escape and Enter end the polygon, which does commit).
     */
    private commitPolygon(closed: boolean): void {
        if (this.isCanceled || this.poles.length < 2) return;
        const id = this.editor.solver.addNurbs(this.poles.flat(), defaultNurbsSpec(this.poles.length));
        if (closed) {
            // the ends were written to the same place, so this only makes the closure a
            // relation the user can see and delete rather than an accident of the numbers
            this.editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: this.poles.length - 1 },
                    { entityId: id, pointIndex: 0 },
                ],
            });
        }
        this.commitNewEntity(id);
    }

    private async pick(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        return step.execute(this.document, this.controller);
    }

    private readonly getNextPoleData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: this.nurbsPreview,
        tentative: (probe) => this.probeCurve(probe),
    });

    /**
     * The control polygon laid down so far — dashed, the way the committed curve draws its
     * net (`controlNetMeshes`) — and the curve the probe would complete.
     */
    private readonly nurbsPreview = (point: XYZ | undefined) => {
        const plane = this.editor.node.plane;
        const last = this.stepDatas[0].point!;
        const meshes: ShapeMeshData[] = [this.meshPoint(last)];
        if (point === undefined) return meshes;
        const probe = toUV(plane, point);
        for (let index = 1; index < this.poles.length; index++) {
            meshes.push(
                this.meshLine(
                    toWorld(plane, this.poles[index - 1][0], this.poles[index - 1][1]),
                    toWorld(plane, this.poles[index][0], this.poles[index][1]),
                    undefined,
                    undefined,
                    "dash",
                ),
            );
        }
        meshes.push(
            this.meshLine(last, point, undefined, undefined, "dash"),
            this.meshCurvePolyline(sampleEntity(this.probeCurve(probe))),
        );
        return meshes;
    };

    /**
     * The curve the probe would commit: the control points so far, and the probe as the next —
     * in the entity's own layout, weights and all (`nurbsParams`). The drawing hints evaluate
     * this entity as the cursor moves, so a bare point list here is a curve nothing can read.
     */
    private probeCurve(probe: [number, number]) {
        const poles = [...this.poles, probe];
        return {
            type: "nurbs" as const,
            params: nurbsParams(poles.flat()),
            nurbs: defaultNurbsSpec(poles.length),
        };
    }
}
