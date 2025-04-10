// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import {
    IDocument,
    IShapeFilter,
    IView,
    Plane,
    ShapeMeshData,
    VisualNode,
    VisualShapeData,
    XYZ,
} from "chili-core";

export interface SnapData {
    preview?: (point: XYZ | undefined) => ShapeMeshData[];
    prompt?: (point: SnapResult) => string;
    filter?: IShapeFilter;
    validator?: (point: XYZ) => boolean;
    featurePoints?: {
        point: XYZ;
        prompt: string;
        when?: () => boolean;
    }[];
}

export interface SnapResult {
    view: IView;
    point?: XYZ;
    info?: string;
    distance?: number;
    refPoint?: XYZ;
    shapes: VisualShapeData[];
    nodes?: VisualNode[];
    plane?: Plane;
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: VisualShapeData[];
}

export interface ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined;
    readonly handleSnaped?: (document: IDocument, snaped?: SnapResult) => void;
    removeDynamicObject(): void;
    clear(): void;
}
