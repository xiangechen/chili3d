// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IDocument } from "../document";
import { IVisual } from "./visual";

export interface IVisualFactory {
    readonly kernelName: string;
    create(document: IDocument): IVisual;
}
