// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, INode, PubSub } from "chili-core";
import { ModelSelectionHandler } from "chili-vis";
import { Snapper } from "../snap";
import { FeaturePoint } from "./eventHandler";

export class DefaultEditorEventHandler extends ModelSelectionHandler {
    constructor(document: IDocument, nodes: INode[]) {
        super(document, true);
        PubSub.default.pub("showProperties", document, nodes);
    }

    override dispose(): void {
        super.dispose();
        PubSub.default.pub("showProperties", this.document, []);
    }

    protected getSnapper(point: FeaturePoint): Snapper | undefined {
        return undefined;
    }

    featurePoints(): FeaturePoint[] {
        return [];
    }
}
