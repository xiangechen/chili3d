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
import { applyPointAutoConstraints } from "../autoConstraints";
import { ConstraintKind, toUV, toWorld } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { SketchPointStep } from "./sketchPointStep";

/** Axis-aligned rectangle from two diagonal corners: 4 lines + coincident/H/V constraints. */
@command({ key: "sketch.rectangle", icon: "icon-rect" })
export class SketchRectangleCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPoint", this.getCornerData),
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
        const [top, right, bottom, left] = addRectangle(solver, [u1, v1], [u2, v2]);
        // Snap the two picked corners onto the origin/points/lines/axes; the shape's
        // own four edges are excluded so the corners never snap onto each other.
        applyPointAutoConstraints(
            solver,
            [
                { entityId: left, pointIndex: 0 },
                { entityId: top, pointIndex: 1 },
            ],
            [top, right, bottom, left],
            { pointTolerance: this.editor.screenTolerance() },
        );
        this.editor.solve(true);
        this.editor.commit();
    }

    private readonly getCornerData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D2,
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

function addRectangle(
    solver: SketchSolver,
    corner1: [number, number],
    corner2: [number, number],
): [number, number, number, number] {
    const [u1, v1] = corner1;
    const [u2, v2] = corner2;
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
    return [top, right, bottom, left];
}
