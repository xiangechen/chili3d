// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncController, I18nKeys, IDocument, ShapeType } from "chili-core";
import { Selection } from "../selection";
import { SnapedData } from "../snap";
import { IStep } from "./step";

export class SelectStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly multiple: boolean = false,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        var shapes = await Selection.pickShape(
            document,
            this.snapeType,
            this.prompt,
            controller,
            this.multiple,
        );
        return {
            view: document.visual.viewer.activeView!,
            shapes,
        };
    }
}
