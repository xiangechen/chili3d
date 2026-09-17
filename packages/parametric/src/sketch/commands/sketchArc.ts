// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type IStep,
    type PointSnapData,
    Precision,
    PubSub,
    type XYZ,
} from "@chili3d/core";
import { arcAngles, rawArcSweep, toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { SketchPointStep } from "./sketchPointStep";

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
        const plane = this.editor.node.plane;
        const [cx, cy] = toUV(plane, this.stepDatas[0].point!);
        const [sx, sy] = toUV(plane, this.stepDatas[1].point!);
        const [ex, ey] = toUV(plane, this.stepDatas[2].point!);
        const radius = Math.hypot(sx - cx, sy - cy);
        const endDistance = Math.hypot(ex - cx, ey - cy);
        if (endDistance < Precision.Distance) {
            PubSub.default.pub("displayError", "Arc end point is too close to the center");
            return;
        }
        // an end on the start ray (within angular tolerance, end = start included)
        // fixes no sweep direction — the preview shows "no arc" there, so reject
        // with feedback instead of committing an arc generateShape would refuse
        if (Math.abs(rawArcSweep([cx, cy, sx, sy, ex, ey])) <= Precision.Angle) {
            PubSub.default.pub("displayError", "Arc end point is on the start ray (zero sweep)");
            return;
        }
        // project the end onto the circle so the PointOnArc constraint does not
        // move it (and with it the whole arc) on the first solve
        const scale = radius / endDistance;
        this.commitNewEntity(
            this.editor.solver.addArc(cx, cy, sx, sy, cx + (ex - cx) * scale, cy + (ey - cy) * scale),
        );
    }

    private readonly getStartData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1,
        preview: this.startPreview,
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

    private readonly getEndData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[1].point!,
        preview: this.endPreview,
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
