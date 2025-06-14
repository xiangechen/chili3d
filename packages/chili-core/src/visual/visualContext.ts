// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable, INodeChangedObserver } from "../foundation";
import { BoundingBox } from "../math";
import { INode } from "../model";
import { IShapeFilter } from "../selectionFilter";
import { ShapeMeshData } from "../shape";
import { IVisualObject } from "./visualObject";

export interface IVisualContext extends IDisposable, INodeChangedObserver {
    get shapeCount(): number;
    addVisualObject(object: IVisualObject): void;
    boundingBoxIntersectFilter(boundingBox: BoundingBox, filter?: IShapeFilter): IVisualObject[];
    removeVisualObject(object: IVisualObject): void;
    addNode(nodes: INode[]): void;
    removeNode(nodes: INode[]): void;
    getVisual(node: INode): IVisualObject | undefined;
    getNode(visual: IVisualObject): INode | undefined;
    redrawNode(nodes: INode[]): void;
    setVisible(node: INode, visible: boolean): void;
    visuals(): IVisualObject[];
    displayMesh(datas: ShapeMeshData[], opacity?: number): number;
    removeMesh(id: number): void;
}
