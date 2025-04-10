// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IDocument, IVisual, IVisualFactory } from "chili-core";

import { ThreeVisual } from "./threeVisual";

export class ThreeVisulFactory implements IVisualFactory {
    readonly kernelName = "three";
    create(document: IDocument): IVisual {
        return new ThreeVisual(document);
    }
}
