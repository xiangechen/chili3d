// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    type IStep,
    type ShapeMeshData,
    VisualConfig,
    type XYZ,
} from "@chili3d/core";
import { pointCrossMesh } from "../curveMesh";
import { pointMarkerHalf } from "../editor/sketchEventHandler";
import { toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/**
 * Places standalone sketch points, one per pick, until Escape ends the tool. A point is
 * a constraint and drag target that builds no profile geometry — the bolt-circle centre
 * marks, the point a dimension is hung off. Each pick commits through the same
 * auto-constraints a line's endpoint gets, so a point placed near existing geometry snaps
 * and coincides onto it.
 */
@command({ key: "sketch.point", icon: "icon-point" })
export class SketchPointCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [new SketchPointStep("prompt.pickPoint", this.getPointData)];
    }

    protected override async executeAsync(): Promise<void> {
        if (!(await this.canExcute())) return;
        const [step] = this.getSteps();
        while (true) {
            this.controller = new AsyncController();
            const data = await step.execute(this.document, this.controller);
            // a cancelled pick is the whole of the ending: what is placed stays placed
            if (data === undefined) return;
            this.stepDatas = [data];
            this.executeMainTask();
            if (this.isCanceled) return;
        }
    }

    protected executeMainTask(): void {
        const [u, v] = this.uvOf(0);
        this.commitNewEntity(this.editor.solver.addPoint(u, v));
    }

    private readonly getPointData = (): SketchPointSnapData => ({
        preview: this.pointPreview,
    });

    /** The cross the point will draw as — the preview is the marker itself. */
    private readonly pointPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        if (point === undefined) return [];
        const plane = this.editor.node.plane;
        return [
            pointCrossMesh(
                plane,
                toUV(plane, point),
                pointMarkerHalf(this.editor),
                VisualConfig.editVertexColor,
            ),
        ];
    };
}
