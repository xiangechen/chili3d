// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, IModel, IView, ShapeMeshData, VisualShapeData, XYZ } from "chili-core";

export type SnapValidator = (point: XYZ) => boolean;

export type SnapPreviewer = (point: XYZ | undefined) => ShapeMeshData[];

export interface SnapedData {
    view: IView;
    point?: XYZ;
    info?: string;
    distance?: number;
    refPoint?: XYZ;
    shapes: VisualShapeData[];
    models?: IModel[];
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
