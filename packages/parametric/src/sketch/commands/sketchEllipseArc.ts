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
import { ellipseParameterOf, ellipseSweep, evaluateEllipse, sampleEntity } from "../curveEval";
import { toUV, toWorld } from "../sketchModel";
import { ellipseParams } from "./sketchEllipse";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

type EllipseArcParams = [number, number, number, number, number, number, number, number, number, number];

/**
 * EllipseArc params [c, m, n, s, e] in sketch uv: the ellipse core from the first
 * three picks, the rim points the two last probes project onto — projected so the
 * structural PointOnEllipse constraints do not move them on the first solve. The
 * sweep reads counter-clockwise from s to e (`ellipseSweep`); a collapsed one is no
 * arc, exactly the arc command's rule.
 */
function ellipseArcParams(
    center: [number, number],
    major: [number, number],
    minor: [number, number],
    startProbe: [number, number],
    endProbe: [number, number],
): EllipseArcParams | undefined {
    const core = ellipseParams(center, major, minor);
    if (core === undefined) return undefined;
    const start = evaluateEllipse(core, ellipseParameterOf(core, startProbe));
    const end = evaluateEllipse(core, ellipseParameterOf(core, endProbe));
    return [...core, ...start, ...end];
}

/** The ellipseArc the probes would complete, or undefined while a piece is still degenerate. */
function tentativeEllipseArc(
    center: [number, number],
    major: [number, number],
    minor: [number, number],
    startProbe: [number, number],
    endProbe: [number, number],
): TentativeEntity | undefined {
    const params = ellipseArcParams(center, major, minor, startProbe, endProbe);
    return params === undefined ? undefined : { type: "ellipseArc", params };
}

/** Center → major → minor → start → end, the rim points projected onto the ellipse. */
@command({ key: "sketch.ellipseArc", icon: "icon-ellipseArc" })
export class SketchEllipseArcCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickEllipseCenter"),
            new SketchPointStep("prompt.pickEllipseMajor", this.getMajorData),
            new SketchPointStep("prompt.pickEllipseMinor", this.getMinorData),
            new SketchPointStep("prompt.pickStartPoint", this.getStartData),
            new SketchPointStep("prompt.pickEndPoint", this.getEndData),
        ];
    }

    protected executeMainTask(): void {
        const params = ellipseArcParams(this.uvOf(0), this.uvOf(1), this.uvOf(2), this.uvOf(3), this.uvOf(4));
        if (params === undefined) {
            PubSub.default.pub("displayError", "Ellipse axis point is too close to the center");
            return;
        }
        const [t0, t1] = ellipseSweep(params);
        if (t1 - t0 <= Precision.Angle || Math.PI * 2 - (t1 - t0) <= Precision.Angle) {
            PubSub.default.pub("displayError", "EllipseArc end point is on the start ray (zero sweep)");
            return;
        }
        this.commitNewEntity(this.editor.solver.addEllipseArc(...params));
    }

    /**
     * Only the centre and the major-axis point are the user's picks: the minor one is projected
     * onto the major axis's perpendicular, and the two rim points onto the ellipse itself.
     */
    protected override autoConstraintPoints(): readonly number[] {
        return [0, 1];
    }

    /** The ellipse core the first three picks committed, undefined while degenerate. */
    private coreParams(): [number, number, number, number, number, number] | undefined {
        if (this.stepDatas.length < 3) return undefined;
        return ellipseParams(this.uvOf(0), this.uvOf(1), this.uvOf(2));
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
    });

    private readonly minorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const center = this.stepDatas[0].point!;
        const meshes = [this.meshPoint(center), this.meshLine(center, this.stepDatas[1].point!)];
        if (point === undefined) return meshes;
        const core = ellipseParams(this.uvOf(0), this.uvOf(1), toUV(plane, point));
        if (core !== undefined) {
            meshes.push(this.meshCurvePolyline(sampleEntity({ type: "ellipse", params: core })));
        }
        return meshes;
    };

    private readonly getStartData = (): SketchPointSnapData => ({
        preview: this.startPreview,
        // the sweep is still open here, so the ellipseArc reads as its whole ellipse
        tentative: (probe) => tentativeEllipseArc(this.uvOf(0), this.uvOf(1), this.uvOf(2), probe, probe),
    });

    private readonly startPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const core = this.coreParams();
        if (core === undefined) return [];
        const meshes: ShapeMeshData[] = [
            this.meshCurvePolyline(sampleEntity({ type: "ellipse", params: core })),
        ];
        if (point !== undefined) {
            const start = evaluateEllipse(core, ellipseParameterOf(core, toUV(plane, point)));
            meshes.push(this.meshPoint(toWorld(plane, start[0], start[1])));
        }
        return meshes;
    };

    private readonly getEndData = (): SketchPointSnapData => ({
        preview: this.endPreview,
        tentative: (probe) =>
            tentativeEllipseArc(this.uvOf(0), this.uvOf(1), this.uvOf(2), this.uvOf(3), probe),
    });

    private readonly endPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const plane = this.editor.node.plane;
        const core = this.coreParams();
        if (core === undefined) return [];
        const start = evaluateEllipse(core, ellipseParameterOf(core, this.uvOf(3)));
        const startMarker = this.meshPoint(toWorld(plane, start[0], start[1]));
        if (point === undefined) {
            return [this.meshCurvePolyline(sampleEntity({ type: "ellipse", params: core })), startMarker];
        }
        const params = ellipseArcParams(
            this.uvOf(0),
            this.uvOf(1),
            this.uvOf(2),
            this.uvOf(3),
            toUV(plane, point),
        );
        if (params === undefined) {
            return [this.meshCurvePolyline(sampleEntity({ type: "ellipse", params: core })), startMarker];
        }
        return [this.meshCurvePolyline(sampleEntity({ type: "ellipseArc", params })), startMarker];
    };
}
