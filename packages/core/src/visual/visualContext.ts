// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDisposable } from "../foundation";
import type { BoundingBox, Matrix4 } from "../math";
import type { INode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { EdgeMeshData, MeshLike, ShapeMeshData } from "../shape";
import type { IVisualObject } from "./visualObject";

export type MeshOption = {
    meshOpacity?: number;
    lineOpacity?: number;
    vertexOpacity?: number;
    onTop?: boolean;
    /**
     * Draw the faces in their own colour instead of shading them. For flat overlay furniture whose
     * colour *is* the information — a dimension's tone, a marker's state — a lit face renders a
     * different colour from the unlit line drawn beside it, which is exactly what the colour was
     * there to say. Solids that should read as solids (`arrowHandle`'s handles, a datum plane
     * quad) leave this off.
     */
    unlit?: boolean;
};

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
    /** Renders the nodes above everything else (no depth test) — e.g. the sketch being edited. */
    setNodeOnTop(nodes: INode[], onTop: boolean): void;
    visuals(): IVisualObject[];
    displayMesh(datas: ShapeMeshData[], meshOption?: MeshOption): number;
    setMeshColor(id: number, color: number): void;
    setMeshOpacity(id: number, opacity: number): void;
    removeMesh(id: number): void;
    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], meshOption?: MeshOption): number;
    displayLineSegments(data: EdgeMeshData): number;
    setPosition(id: number, position: Float32Array): void;
    setInstanceMatrix(id: number, matrixs: Matrix4[]): void;
}
