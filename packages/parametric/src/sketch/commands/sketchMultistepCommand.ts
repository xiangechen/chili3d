// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MultistepCommand, PubSub } from "@chili3d/core";
import { applyAutoConstraints } from "../autoConstraints";
import { SketchEditor } from "../editor/sketchEditor";

/**
 * Base class for in-sketch step commands: requires an active sketch editing session.
 */
export abstract class SketchMultistepCommand extends MultistepCommand {
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
        applyAutoConstraints(this.editor.solver, entityId, { pointTolerance: this.editor.screenTolerance() });
        this.editor.solve(true);
        this.editor.commit();
    }
}
