// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class DefaultEditorEventHandler extends EditorEventHandler {
    constructor(document: IDocument) {
        super(document);
    }

    featurePoints(): FeaturePoint[] {
        return [];
    }
}
