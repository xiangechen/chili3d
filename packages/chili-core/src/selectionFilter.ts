// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { INode, ShapeNode } from "./model";
import { IShape } from "./shape";

export interface IShapeFilter {
    allow(shape: IShape): boolean;
}

export interface INodeFilter {
    allow(node: INode): boolean;
}

export class ShapeNodeFilter implements INodeFilter {
    allow(node: INode): boolean {
        return node instanceof ShapeNode;
    }
}
