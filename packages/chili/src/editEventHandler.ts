// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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

    override dispose() {
        PubSub.default.pub("showProperties", this.document, []);
        super.dispose();
    }
}
