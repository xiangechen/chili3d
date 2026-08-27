// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export * from "./autoConstraints";
export * from "./editor/sketchEditor";
export * from "./garlic";
export * from "./sketchModel";
export * from "./sketchNode";
export * from "./solver";
import "./commands";

import { PubSub } from "@chili3d/core";
import { SketchEditor } from "./editor/sketchEditor";
import { SketchNode } from "./sketchNode";

// Double-clicking a sketch node in the project tree enters its editing session.
PubSub.default.sub("nodeDoubleClicked", (node) => {
    if (node instanceof SketchNode && SketchEditor.getActive()?.node !== node) {
        SketchEditor.enter(node);
    }
});
