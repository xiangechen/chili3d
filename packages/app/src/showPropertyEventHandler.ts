// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INode, NodeSelectionHandler, PubSub } from "@chili3d/core";

export class ShowPropertyEventHandler extends NodeSelectionHandler {
    constructor(document: IDocument) {
        super(document, true);
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
    }

    protected readonly handleSelectionChanged = (
        _doc: IDocument,
        selected: INode[],
        _unselected: INode[],
    ) => {
        PubSub.default.pub("showProperties", this.document, selected);
    };

    override disposeInternal() {
        PubSub.default.remove("selectionChanged", this.handleSelectionChanged);
        super.disposeInternal();
    }
}
