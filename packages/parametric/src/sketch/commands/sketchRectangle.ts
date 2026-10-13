// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    formatMeasurement,
    type IStep,
    type PointSnapData,
    Precision,
    PubSub,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { applyPointAutoConstraints } from "../autoConstraints";
import { ConstraintKind, type SketchPointRef, toUV, toWorld } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { joinLoop } from "../solverEntities";
import { typedOffsetDimensions } from "../typedDimension";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { SketchPointStep } from "./sketchPointStep";

/** Axis-aligned rectangle from two diagonal corners: 4 lines + coincident/H/V constraints. */
@command({ key: "sketch.rectangle", icon: "icon-rect" })
export class SketchRectangleCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickOppositeCorner", this.getCornerData),
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
        if (this.construction) {
            for (const id of [top, right, bottom, left]) solver.setConstruction(id, true);
        }
        // the two picked corners, and with them the rectangle's diagonal
        const corners: [SketchPointRef, SketchPointRef] = [
            { entityId: left, pointIndex: 0 },
            { entityId: top, pointIndex: 1 },
        ];
        // Snap the two picked corners onto the origin/points/lines/axes; the shape's
        // own four edges are excluded so the corners never snap onto each other.
        applyPointAutoConstraints(solver, corners, [top, right, bottom, left], {
            pointTolerance: this.editor.screenTolerance(),
        });

        // The pick that sets the size takes a pair of offsets rather than a lone number, and
        // here the pair IS the size: the width and the height are the gaps across, between each
        // pair of opposite edges. Nothing to suppress either — a rectangle is axis-aligned by
        // construction, so no hinted H/V can disagree with the numbers typed at it.
        this.solveAndCommit(
            this.hasTypedOffsets(1) ? typedOffsetDimensions([left, right], [top, bottom]) : [],
        );
    }

    private readonly getCornerData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D2,
        preview: this.rectanglePreview,
        prompt: this.cornerPrompt,
    });

    /**
     * The rectangle's size under the cursor: the two offsets this pick is about to state, which
     * for an axis-aligned rectangle are its width and its height. The generic readout would give
     * the distance to the first corner instead — the diagonal, which is no side of anything and
     * says nothing about the shape being drawn.
     */
    private readonly cornerPrompt = (snaped: SnapResult): string => {
        const point = snaped.point;
        if (point === undefined) return "";

        const plane = this.editor.node.plane;
        const [u1, v1] = toUV(plane, this.stepDatas[0].point!);
        const [u2, v2] = toUV(plane, point);
        const width = formatMeasurement("length", Math.abs(u2 - u1));
        const height = formatMeasurement("length", Math.abs(v2 - v1));
        return `${width}, ${height}`;
    };

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

    // Each edge's endpoint 1 meets the next edge's endpoint 0.
    joinLoop(solver, [top, right, bottom, left]);
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
