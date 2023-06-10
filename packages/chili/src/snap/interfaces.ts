// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IView, ShapeMeshData, VisualShapeData, XYZ } from "chili-core";

export type SnapValidator = (point: XYZ) => boolean;

export type SnapPreviewer = (point: XYZ) => ShapeMeshData | undefined;

export interface SnapedData {
    view: IView;
    point: XYZ;
    info?: string;
    shapes: VisualShapeData[];
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: VisualShapeData[];
}

export interface ISnapper {
    snap(data: MouseAndDetected): SnapedData | undefined;
    handleSnaped?: (document: IDocument, snaped?: SnapedData) => void;
    removeDynamicObject(): void;
    clear(): void;
}
