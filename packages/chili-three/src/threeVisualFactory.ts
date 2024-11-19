// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, IVisual, IVisualFactory } from "chili-core";

import { ThreeVisual } from "./threeVisual";

export class ThreeVisulFactory implements IVisualFactory {
    readonly kernelName = "three";
    create(document: IDocument): IVisual {
        return new ThreeVisual(document);
    }
}
