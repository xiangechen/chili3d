// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, INode, PubSub } from "chili-core";
import { NodeSelectionHandler } from "chili-vis";

export class EditEventHandler extends NodeSelectionHandler {
    constructor(
        document: IDocument,
        readonly selectedNodes: INode[],
    ) {
        super(document, true);
        PubSub.default.pub("showProperties", document, selectedNodes);
    }

    override disposeInternal() {
        PubSub.default.pub("showProperties", this.document, []);
        super.disposeInternal();
    }
}
