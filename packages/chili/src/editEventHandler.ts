// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
