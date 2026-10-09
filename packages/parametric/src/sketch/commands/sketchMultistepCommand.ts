// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type EdgeMeshData, MultistepCommand, PubSub, property, VisualConfig } from "@chili3d/core";
import { applyAutoConstraints } from "../autoConstraints";
import { SketchEditor } from "../editor/sketchEditor";
import { toUV, toWorld } from "../sketchModel";

/**
 * Base class for in-sketch step commands: requires an active sketch editing session.
 */
export abstract class SketchMultistepCommand extends MultistepCommand {
    /**
     * Construction mode: the committed entity becomes reference geometry (dashed,
     * excluded from profiles). Shared by every draw command — the command property
     * cache is keyed by property name, so the checkbox set on one of them applies
     * to the others and sticks until unticked.
     */
    @property("option.command.construction")
    get construction(): boolean {
        return this.getPrivateValue("construction", false);
    }
    set construction(value: boolean) {
        this.setProperty("construction", value);
    }

    protected override canExcute(): Promise<boolean> {
        if (SketchEditor.getActive() === undefined) {
            PubSub.default.pub("displayError", "No active sketch editor");
            return Promise.resolve(false);
        }
        return Promise.resolve(true);
    }

    protected get editor(): SketchEditor {
        return SketchEditor.getActive()!;
    }

    /**
     * Whether a freshly committed entity takes the drawing hints' auto-constraints (see
     * `applyAutoConstraints`). A command whose entity's points the *tool* derived answers no:
     * those points are not the user's, and a snap onto whatever happens to lie near one —
     * the neighbouring segment's own curve, say — would be fought by the derivation that
     * placed it. Such a command states the relations it means itself.
     */
    protected takesAutoConstraints(): boolean {
        return true;
    }

    /**
     * Which of a freshly committed entity's points take those auto-constraints: `undefined` for
     * every point, or the indices of the ones the *user* placed. A command that derives some of
     * its points — an ellipse's minor probe is projected onto the major axis's perpendicular,
     * not picked — answers with the picked ones, so a snap cannot pull a derived point off the
     * shape the derivation just placed it on.
     */
    protected autoConstraintPoints(): readonly number[] | undefined {
        return undefined;
    }

    /** Applies auto-constraints to a freshly added entity, then solves and commits. */
    protected commitNewEntity(entityId: number): void {
        if (this.construction) this.editor.solver.setConstruction(entityId, true);
        if (this.takesAutoConstraints()) {
            applyAutoConstraints(
                this.editor.solver,
                entityId,
                { pointTolerance: this.editor.screenTolerance() },
                this.autoConstraintPoints(),
            );
        }
        this.editor.solve(true);
        this.editor.commit();
    }

    /** Sketch (u, v) of the point picked by the step at `index`. */
    protected uvOf(index: number): [number, number] {
        return toUV(this.editor.node.plane, this.stepDatas[index].point!);
    }

    /**
     * A numeric-curve preview from its sketch-uv polyline: the ellipse and the free curves
     * draw sampled (`curveEval.sampleEntity`), where a line or an
     * arc has a kernel shape to preview instead.
     */
    protected meshCurvePolyline(
        uvs: readonly [number, number][],
        color: number = VisualConfig.defaultEdgeColor,
    ): EdgeMeshData {
        const plane = this.editor.node.plane;
        const position = new Float32Array(Math.max(0, uvs.length - 1) * 6);
        for (let i = 1; i < uvs.length; i++) {
            const p0 = toWorld(plane, uvs[i - 1][0], uvs[i - 1][1]);
            const p1 = toWorld(plane, uvs[i][0], uvs[i][1]);
            position.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], (i - 1) * 6);
        }
        return { position, range: [], color, lineType: "solid" };
    }
}
