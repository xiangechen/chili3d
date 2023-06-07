// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { VisualShapeData, IShape, IView, XYZ, IDocument } from "chili-core";

export interface Validator {
    (point: XYZ): boolean;
}

export interface ShapePreviewer {
    (point: XYZ): IShape | undefined;
}

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
