// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    Dimensions,
    type IStep,
    Precision,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { type SketchPointRef, toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/** Line params in sketch uv for the endpoints `start` and `end`. */
function lineParams(start: [number, number], end: [number, number]): [number, number, number, number] {
    return [start[0], start[1], end[0], end[1]];
}

/**
 * The line tool draws a chain: every pick after the first commits the segment from
 * the point picked before it and becomes the chain's new end, so the segments stay
 * connected without re-picking the point they share. A pick on the chain's start
 * closes the loop and ends the chain; Escape (or Enter) ends it too, without the
 * closing segment. Either way what is already committed stays, and the tool is left
 * armed for the next chain; the same key at a first point, which draws nothing,
 * leaves the tool instead. `stepDatas[0]` is the chain's end between picks, which
 * is what the step's reference point, preview and tentative read.
 */
@command({ key: "sketch.line", icon: "icon-line" })
export class SketchLineCommand extends SketchMultistepCommand {
    /** The chain being drawn — the one thing a later segment needs to know about the first. */
    private chain?: { start: SketchPointRef; segments: number };

    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPointOrFinish", this.getNextPointData),
        ];
    }

    protected override async executeAsync(): Promise<void> {
        if (!(await this.canExcute())) return;

        const steps = this.getSteps();
        while (true) {
            this.chain = undefined;
            const start = await this.pick(steps[0]);
            if (start === undefined) return;

            this.stepDatas = [start];
            await this.extendChain(steps[1]);
            // the panel's ✗ ends the tool, while Escape/Enter only ends the chain
            if (this.isCanceled) return;
        }
    }

    /** Commits the segment from the chain's end (`stepDatas[0]`) to the point just picked. */
    protected executeMainTask(): void {
        const id = this.editor.solver.addLine(...lineParams(this.uvOf(0), this.uvOf(1)));
        // the chain starts at the first segment's first point, held as a ref so it can
        // be read back wherever a later solve has moved it
        this.chain ??= { start: { entityId: id, pointIndex: 0 }, segments: 0 };
        this.chain.segments++;
        this.commitNewEntity(id);
    }

    /** Adds segments from `step`'s picks until one is cancelled or closes the loop. */
    private async extendChain(step: IStep): Promise<void> {
        while (true) {
            const next = await this.pick(step);
            if (next === undefined) return;

            const closes = this.closesChain(next.point!);
            // a one-segment chain has no loop to close: the closing copy would only
            // repeat the segment already drawn, so the pick just ends the chain
            if (closes && this.chain!.segments < 2) return;

            this.stepDatas.push(next);
            this.executeMainTask();
            this.stepDatas = [next];
            if (closes) return;
        }
    }

    /**
     * Whether the pick landed on the chain's start point — as it is now, not as it was
     * picked: the snap resolves onto the point's current position, and a solve may
     * have moved it since.
     */
    private closesChain(point: XYZ): boolean {
        if (this.chain === undefined) return false;

        const [u, v] = toUV(this.editor.node.plane, point);
        const [su, sv] = this.editor.solver.pointOf(this.chain.start);
        return Math.hypot(u - su, v - sv) <= Precision.Distance;
    }

    private async pick(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        return step.execute(this.document, this.controller);
    }

    private readonly getNextPointData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: this.linePreview,
        tentative: (probe) => ({ type: "line", params: lineParams(this.uvOf(0), probe) }),
    });

    private readonly linePreview = (point: XYZ | undefined) => {
        const end = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(end)];
        }
        return [this.meshPoint(end), this.meshLine(end, point)];
    };
}
