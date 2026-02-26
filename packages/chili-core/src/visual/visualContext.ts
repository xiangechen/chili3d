// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDisposable } from "../foundation";
import type { BoundingBox, Matrix4 } from "../math";
import type { INode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { EdgeMeshData, MeshLike, ShapeMeshData } from "../shape";
import type { IVisualObject } from "./visualObject";

export interface IVisualContext extends IDisposable {
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
    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], opacity?: number): number;
    displayLineSegments(data: EdgeMeshData): number;
    setPosition(id: number, position: Float32Array): void;
    setInstanceMatrix(id: number, matrixs: Matrix4[]): void;
}
