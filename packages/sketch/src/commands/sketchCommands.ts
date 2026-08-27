// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IApplication, type ICommand, PubSub, Transaction } from "@chili3d/core";
import { SketchEditor } from "../editor/sketchEditor";
import { SketchNode } from "../sketchNode";

@command({ key: "sketch.create", icon: "icon-edit" })
export class CreateSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (view === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        const node = new SketchNode({ document: view.document, plane: view.workplane });
        Transaction.execute(view.document, "create sketch", () => {
            view.document.modelManager.addNode(node);
        });
        SketchEditor.enter(node);
    }
}

@command({ key: "sketch.enter", icon: "icon-edit" })
export class EnterSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (view === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        const node = view.document.selection.getSelectedNodes().find((n) => n instanceof SketchNode) as
            | SketchNode
            | undefined;
        if (node === undefined) {
            PubSub.default.pub("displayError", "Select a sketch node first");
            return;
        }
        SketchEditor.enter(node);
    }
}

@command({ key: "sketch.exit", icon: "icon-back" })
export class ExitSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        SketchEditor.exit();
    }
}
