// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Dimensions, type IStep, type ShapeMeshData, type XYZ } from "@chili3d/core";
import type { TentativeEntity } from "../autoConstraints";
import { conicShoulder, sampleEntity } from "../curveEval";
import { toUV, toWorld } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/**
 * The rho a shoulder probe asks for: its projection onto the chord-midpoint →
 * control direction, as the fraction of it — garlic's rho definition,
 * ρ = |S−M| / |C−M|, read backwards. Clamped into (0, 1): the endpoints are the
 * degenerate conics (a line, a parabola at the limit), so the pick saturates rather
 * than failing.
 */
export function conicRhoFromShoulder(
    start: [number, number],
    end: [number, number],
    control: [number, number],
    probe: [number, number],
): number {
    const m: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const dx = control[0] - m[0];
    const dy = control[1] - m[1];
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-12) return 0.5;
    const t = ((probe[0] - m[0]) * dx + (probe[1] - m[1]) * dy) / lengthSq;
    return Math.min(0.95, Math.max(0.05, t));
}

/** The conic the probe would complete: a rho of ½ until the shoulder pick says otherwise. */
function tentativeConic(
    start: [number, number],
    end: [number, number],
    control: [number, number],
    rho = 0.5,
): TentativeEntity {
    return { type: "conic", params: [...start, ...control, ...end, rho] };
}

/**
 * Conic (rational quadratic bezier): start → end → control point → shoulder point.
 * The shoulder sets rho, so the curve's fullness is picked on the curve rather than
 * typed — the rho dimension (`dimension` on a conic) edits it afterwards.
 */
@command({ key: "sketch.conic", icon: "icon-conic" })
export class SketchConicCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickStartPoint"),
            new SketchPointStep("prompt.pickEndPoint", this.getEndData),
            new SketchPointStep("prompt.pickConicControl", this.getControlData),
            new SketchPointStep("prompt.pickConicShoulder", this.getShoulderData),
        ];
    }

    protected executeMainTask(): void {
        const [sx, sy] = this.uvOf(0);
        const [ex, ey] = this.uvOf(1);
        const [cx, cy] = this.uvOf(2);
        const rho = conicRhoFromShoulder([sx, sy], [ex, ey], [cx, cy], this.uvOf(3));
        this.commitNewEntity(this.editor.solver.addConic(sx, sy, cx, cy, ex, ey, rho));
    }

    private readonly getEndData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: (point) => {
            const start = this.stepDatas[0].point!;
            return point === undefined
                ? [this.meshPoint(start)]
                : [this.meshPoint(start), this.meshLine(start, point)];
        },
    });

    private readonly getControlData = (): SketchPointSnapData => ({
        preview: this.controlPreview,
        tentative: (probe) => tentativeConic(this.uvOf(0), this.uvOf(1), probe),
    });

    /** The control triangle plus the conic at the default rho, so the pick sees the curve it steers. */
    private readonly controlPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const start = this.stepDatas[0].point!;
        const end = this.stepDatas[1].point!;
        if (point === undefined) {
            return [this.meshLine(start, end)];
        }
        const meshes: ShapeMeshData[] = [this.meshLine(start, point), this.meshLine(point, end)];
        const tentative = tentativeConic(this.uvOf(0), this.uvOf(1), toUV(plane, point));
        meshes.push(this.meshCurvePolyline(sampleEntity(tentative)));
        return meshes;
    };

    private readonly getShoulderData = (): SketchPointSnapData => ({
        preview: this.shoulderPreview,
        tentative: (probe) =>
            tentativeConic(
                this.uvOf(0),
                this.uvOf(1),
                this.uvOf(2),
                conicRhoFromShoulder(this.uvOf(0), this.uvOf(1), this.uvOf(2), probe),
            ),
    });

    /** The triangle and the conic at the probe's rho, with the shoulder marked on the curve. */
    private readonly shoulderPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const [sx, sy] = this.uvOf(0);
        const [ex, ey] = this.uvOf(1);
        const [cx, cy] = this.uvOf(2);
        const start = this.stepDatas[0].point!;
        const end = this.stepDatas[1].point!;
        const control = this.stepDatas[2].point!;
        const meshes: ShapeMeshData[] = [this.meshLine(start, control), this.meshLine(control, end)];
        if (point === undefined) return meshes;
        const rho = conicRhoFromShoulder([sx, sy], [ex, ey], [cx, cy], toUV(plane, point));
        const params: number[] = [sx, sy, cx, cy, ex, ey, rho];
        meshes.push(this.meshCurvePolyline(sampleEntity({ type: "conic", params })));
        const shoulder = conicShoulder(params);
        meshes.push(this.meshPoint(toWorld(plane, shoulder[0], shoulder[1])));
        return meshes;
    };
}
