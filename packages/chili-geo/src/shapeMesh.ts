// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { EdgeRenderData, FaceRenderData, RenderDataBuilder, VertexRenderData } from "./renderData";
import { IEdge, IFace, IVertex } from "./shape";

export interface VertexMesh {
    renderData: VertexRenderData;
    vertex: IVertex;
}

export interface EdgeMesh {
    renderData: EdgeRenderData;
    edge: IEdge;
}

export interface FaceMesh {
    renderData: FaceRenderData;
    face: IFace;
}

export interface IShapeMesh {
    get vertexs(): VertexMesh[];
    get edges(): EdgeMesh[];
    get faces(): FaceMesh[];
}
