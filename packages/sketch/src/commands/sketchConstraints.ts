// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IApplication, type ICommand, PubSub } from "@chili3d/core";
import { SketchEditor } from "../editor/sketchEditor";
import { ConstraintKind } from "../sketchModel";

function editorOrError(): SketchEditor | undefined {
    const editor = SketchEditor.getActive();
    if (editor === undefined) {
        PubSub.default.pub("displayError", "No active sketch editor");
    }
    return editor;
}

export abstract class SketchConstraintCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        const editor = editorOrError();
        if (editor === undefined) return;
        await this.executeWithEditor(editor);
    }

    protected abstract executeWithEditor(editor: SketchEditor): Promise<void>;
}

@command({ key: "constraint.coincident", icon: "icon-lock" })
export class CoincidentConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const p1 = await editor.pickPoint("prompt.pickSketchPoint");
        if (p1 === undefined) return;
        const p2 = await editor.pickPoint("prompt.pickSketchPoint");
        if (p2 === undefined) return;
        editor.solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [p1, p2] });
        editor.solve(true);
        editor.commit();
    }
}

abstract class LineConstraintCommand extends SketchConstraintCommand {
    protected abstract readonly kind: ConstraintKind.Horizontal | ConstraintKind.Vertical;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const lineId = await editor.pickEntity("prompt.pickSketchEntity", "line");
        if (lineId === undefined) return;
        editor.solver.addConstraint({
            kind: this.kind,
            refs: [
                { entityId: lineId, pointIndex: 0 },
                { entityId: lineId, pointIndex: 1 },
            ],
        });
        editor.solve(true);
        editor.commit();
    }
}

@command({ key: "constraint.horizontal", icon: "icon-minus" })
export class HorizontalConstraintCommand extends LineConstraintCommand {
    protected readonly kind = ConstraintKind.Horizontal;
}

@command({ key: "constraint.vertical", icon: "icon-minus" })
export class VerticalConstraintCommand extends LineConstraintCommand {
    protected readonly kind = ConstraintKind.Vertical;
}
