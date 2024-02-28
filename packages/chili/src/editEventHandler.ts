// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, INode, PubSub } from "chili-core";
import { ModelSelectionHandler } from "chili-vis";

export class EditEventHandler extends ModelSelectionHandler {
    constructor(
        document: IDocument,
        readonly nodes: INode[],
    ) {
        super(document, true);
        PubSub.default.pub("showProperties", document, nodes);
    }

    override dispose() {
        PubSub.default.pub("showProperties", this.document, []);
        super.dispose();
    }
}
