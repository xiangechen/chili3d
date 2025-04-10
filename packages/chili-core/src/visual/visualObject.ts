// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { BoundingBox, GeometryNode, IDisposable, Matrix4 } from "chili-core";

export interface IVisualObject extends IDisposable {
    visible: boolean;
    transform: Matrix4;
    boundingBox(): BoundingBox;
}

export interface IVisualGeometry extends IVisualObject {
    get geometryNode(): GeometryNode;
}

export namespace IVisualObject {
    export function isGeometry(obj: IVisualObject): obj is IVisualGeometry {
        return (obj as IVisualGeometry).geometryNode !== undefined;
    }
}
