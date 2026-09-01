// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    type XYZ,
} from "@chili3d/core";
import { ConstraintKind, toUV, toWorld } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";

/** Axis-aligned rectangle from two diagonal corners: 4 lines + coincident/H/V constraints. */
@command({ key: "sketch.rectangle", icon: "icon-rect" })
export class SketchRectangleCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickFistPoint"),
            new PointStep("prompt.pickNextPoint", this.getCornerData),
        ];
    }

    protected executeMainTask(): void {
        const plane = this.editor.node.plane;
        const [u1, v1] = toUV(plane, this.stepDatas[0].point!);
        const [u2, v2] = toUV(plane, this.stepDatas[1].point!);
        if (Math.abs(u2 - u1) < Precision.Distance || Math.abs(v2 - v1) < Precision.Distance) {
            PubSub.default.pub("displayError", "Rectangle sides are too small");
            return;
        }

        const solver = this.editor.solver;
        const top = solver.addLine(u1, v2, u2, v2);
        const right = solver.addLine(u2, v2, u2, v1);
        const bottom = solver.addLine(u2, v1, u1, v1);
        const left = solver.addLine(u1, v1, u1, v2);
        for (const [from, to] of [
            [top, right],
            [right, bottom],
            [bottom, left],
            [left, top],
        ] as const) {
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: from, pointIndex: 1 },
                    { entityId: to, pointIndex: 0 },
                ],
            });
        }
        // the corners are already axis-aligned, so these only keep the rectangle rigid
        for (const [entityId, kind] of [
            [top, ConstraintKind.Horizontal],
            [right, ConstraintKind.Vertical],
            [bottom, ConstraintKind.Horizontal],
            [left, ConstraintKind.Vertical],
        ] as const) {
            solver.addConstraint({
                kind,
                refs: [
                    { entityId, pointIndex: 0 },
                    { entityId, pointIndex: 1 },
                ],
            });
        }
        this.editor.solve(true);
        this.editor.commit();
    }

    private readonly getCornerData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        preview: this.rectanglePreview,
    });

    private readonly rectanglePreview = (point: XYZ | undefined) => {
        const plane = this.editor.node.plane;
        const first = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(first)];
        }
        const [u1, v1] = toUV(plane, first);
        const [u2, v2] = toUV(plane, point);
        const corners = [
            toWorld(plane, u1, v1),
            toWorld(plane, u2, v1),
            toWorld(plane, u2, v2),
            toWorld(plane, u1, v2),
        ];
        return [
            this.meshPoint(first),
            ...corners.map((corner, i) => this.meshLine(corner, corners[(i + 1) % 4])),
        ];
    };
}
