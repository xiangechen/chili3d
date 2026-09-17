// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Dimensions, type IStep, Precision, PubSub, type XYZ } from "@chili3d/core";
import type { TentativeEntity } from "../autoConstraints";
import { arcAngles, rawArcSweep, toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/** Arc params in sketch uv, the end projected onto the circle center/start define. */
function arcParams(
    center: [number, number],
    start: [number, number],
    end: [number, number],
): [number, number, number, number, number, number] | undefined {
    const [cx, cy] = center;
    const endDistance = Math.hypot(end[0] - cx, end[1] - cy);
    if (endDistance < Precision.Distance) return undefined;
    // project the end onto the circle so the PointOnArc constraint does not move
    // it (and with it the whole arc) on the first solve
    const scale = Math.hypot(start[0] - cx, start[1] - cy) / endDistance;
    return [cx, cy, start[0], start[1], cx + (end[0] - cx) * scale, cy + (end[1] - cy) * scale];
}

/** The arc the probe would complete, or undefined while its end is still on the center. */
function tentativeArc(
    center: [number, number],
    start: [number, number],
    end: [number, number],
): TentativeEntity | undefined {
    const params = arcParams(center, start, end);
    return params === undefined ? undefined : { type: "arc", params };
}

/** Three-point arc: center → start (radius + start angle) → end (counter-clockwise sweep). */
@command({ key: "sketch.arc", icon: "icon-arc" })
export class SketchArcCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickCircleCenter"),
            new SketchPointStep("prompt.pickFistPoint", this.getStartData),
            new SketchPointStep("prompt.pickArcEnd", this.getEndData),
        ];
    }

    protected executeMainTask(): void {
        const params = arcParams(this.uvOf(0), this.uvOf(1), this.uvOf(2));
        if (params === undefined) {
            PubSub.default.pub("displayError", "Arc end point is too close to the center");
            return;
        }
        // an end on the start ray (within angular tolerance, end = start included)
        // fixes no sweep direction — the preview shows "no arc" there, so reject
        // with feedback instead of committing an arc generateShape would refuse
        if (Math.abs(rawArcSweep(params)) <= Precision.Angle) {
            PubSub.default.pub("displayError", "Arc end point is on the start ray (zero sweep)");
            return;
        }
        this.commitNewEntity(this.editor.solver.addArc(...params));
    }

    private readonly getStartData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1,
        preview: this.startPreview,
        // the sweep is still open here, so the arc is its whole circle (start = end)
        tentative: (probe) => tentativeArc(this.uvOf(0), probe, probe),
    });

    private readonly startPreview = (point: XYZ | undefined) => {
        const center = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(center)];
        }
        const plane = this.editor.node.plane;
        return [
            this.meshPoint(center),
            this.meshLine(center, point),
            this.meshCreatedShape("circle", plane.normal, center, plane.projectDistance(center, point)),
        ];
    };

    private readonly getEndData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[1].point!,
        preview: this.endPreview,
        tentative: (probe) => tentativeArc(this.uvOf(0), this.uvOf(1), probe),
    });

    private readonly endPreview = (point: XYZ | undefined) => {
        const plane = this.editor.node.plane;
        const center = this.stepDatas[0].point!;
        const start = this.stepDatas[1].point!;
        const meshes = [this.meshPoint(center), this.meshLine(center, start)];
        if (point === undefined) {
            return meshes;
        }
        const [cx, cy] = toUV(plane, center);
        const [sx, sy] = toUV(plane, start);
        const [ex, ey] = toUV(plane, point);
        const [, sweep] = arcAngles([cx, cy, sx, sy, ex, ey]);
        // a sweep of (almost) 2π means the cursor is on the start ray — no arc yet
        if (Math.abs(sweep - Math.PI * 2) < Precision.Angle) {
            return meshes;
        }
        meshes.push(this.meshCreatedShape("arc", plane.normal, center, start, (sweep * 180) / Math.PI));
        return meshes;
    };
}
