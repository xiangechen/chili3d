// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type IStep,
    Precision,
    PubSub,
    type ShapeMeshData,
    type XYZ,
} from "@chili3d/core";
import type { TentativeEntity } from "../autoConstraints";
import { sampleEntity } from "../curveEval";
import { toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/**
 * Ellipse params [c, m, n] in sketch uv. The minor-axis point is the probe's
 * projection onto the major axis's perpendicular — the third click sets the minor
 * radius alone, so the committed ellipse satisfies the structural Perpendicular
 * exactly and the first solve does not move it.
 */
export function ellipseParams(
    center: [number, number],
    major: [number, number],
    minorProbe: [number, number],
): [number, number, number, number, number, number] | undefined {
    const [cx, cy] = center;
    const ux = major[0] - cx;
    const uy = major[1] - cy;
    const majorLength = Math.hypot(ux, uy);
    if (majorLength < Precision.Distance) return undefined;
    const perp: [number, number] = [-uy / majorLength, ux / majorLength];
    const minorLength = (minorProbe[0] - cx) * perp[0] + (minorProbe[1] - cy) * perp[1];
    if (Math.abs(minorLength) < Precision.Distance) return undefined;
    return [cx, cy, major[0], major[1], cx + perp[0] * minorLength, cy + perp[1] * minorLength];
}

/** The ellipse the probe would complete, or undefined while its minor axis is still zero. */
function tentativeEllipse(
    center: [number, number],
    major: [number, number],
    minorProbe: [number, number],
): TentativeEntity | undefined {
    const params = ellipseParams(center, major, minorProbe);
    return params === undefined ? undefined : { type: "ellipse", params };
}

/** Center → major-axis point → minor-axis point (the minor axis is always perpendicular). */
@command({ key: "sketch.ellipse", icon: "icon-ellipse" })
export class SketchEllipseCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickEllipseCenter"),
            new SketchPointStep("prompt.pickEllipseMajor", this.getMajorData),
            new SketchPointStep("prompt.pickEllipseMinor", this.getMinorData),
        ];
    }

    protected executeMainTask(): void {
        const params = ellipseParams(this.uvOf(0), this.uvOf(1), this.uvOf(2));
        if (params === undefined) {
            PubSub.default.pub("displayError", "Ellipse axis point is too close to the center");
            return;
        }
        this.commitNewEntity(this.editor.solver.addEllipse(...params));
    }

    /** The centre and the major-axis point are the user's picks; the minor one is projected. */
    protected override autoConstraintPoints(): readonly number[] {
        return [0, 1];
    }

    private readonly getMajorData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1,
        preview: this.majorPreview,
    });

    private readonly majorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const center = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(center)];
        }
        return [this.meshPoint(center), this.meshLine(center, point)];
    };

    private readonly getMinorData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        preview: this.minorPreview,
        tentative: (probe) => tentativeEllipse(this.uvOf(0), this.uvOf(1), probe),
    });

    private readonly minorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const center = this.stepDatas[0].point!;
        const major = this.stepDatas[1].point!;
        const meshes = [this.meshPoint(center), this.meshLine(center, major)];
        if (point === undefined) {
            return meshes;
        }
        const params = ellipseParams(this.uvOf(0), this.uvOf(1), toUV(plane, point));
        if (params !== undefined) {
            meshes.push(this.meshCurvePolyline(sampleEntity({ type: "ellipse", params })));
        }
        return meshes;
    };
}
