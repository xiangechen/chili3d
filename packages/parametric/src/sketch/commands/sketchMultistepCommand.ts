// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MultistepCommand, PubSub, property } from "@chili3d/core";
import { applyAutoConstraints } from "../autoConstraints";
import { SketchEditor } from "../editor/sketchEditor";
import { toUV } from "../sketchModel";

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

    /** Applies auto-constraints to a freshly added entity, then solves and commits. */
    protected commitNewEntity(entityId: number): void {
        if (this.construction) this.editor.solver.setConstruction(entityId, true);
        applyAutoConstraints(this.editor.solver, entityId, { pointTolerance: this.editor.screenTolerance() });
        this.editor.solve(true);
        this.editor.commit();
    }

    /** Sketch (u, v) of the point picked by the step at `index`. */
    protected uvOf(index: number): [number, number] {
        return toUV(this.editor.node.plane, this.stepDatas[index].point!);
    }
}
