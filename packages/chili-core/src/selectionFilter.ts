// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
