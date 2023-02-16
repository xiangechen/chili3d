// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ } from "../math";
import { LineType } from "./lineType";

export interface RenderData {
    type: "vertex" | "edge" | "face";
    vertexs: number[];
    color?: number;
    vertexColors?: number[];
}

export interface VertexRenderData extends RenderData {
    size?: number;
}

export namespace VertexRenderData {
    export function from(point: XYZ, color?: number, size?: number): VertexRenderData {
        return {
            type: "vertex",
            vertexs: [point.x, point.y, point.z],
            color,
            size,
        };
    }
}

export interface EdgeRenderData extends RenderData {
    lineType?: LineType;
}

export namespace EdgeRenderData {
    export function from(start: XYZ, end: XYZ, color: number, lineType?: LineType): EdgeRenderData {
        return {
            type: "edge",
            vertexs: [start.x, start.y, start.z, end.x, end.y, end.z],
            color,
            lineType,
        };
    }
}

export interface FaceRenderData extends RenderData {
    normals: number[];
    textures?: number[];
    indices: number[];
}

export namespace RenderData {
    export function isVertex(data: RenderData): data is VertexRenderData {
        return data.type === "vertex";
    }

    export function isEdge(data: RenderData): data is EdgeRenderData {
        return data.type === "edge";
    }

    export function isFace(data: RenderData): data is FaceRenderData {
        return data.type === "face";
    }
}

export class RenderDataBuilder {
    private _vertexs: number[] = [];
    private _normals: number[] = [];
    private _textures?: number[];
    private _indices: number[] = [];
    private _vertexColors?: number[];
    private _color?: number;

    addVertex(x: number, y: number, z: number) {
        this._vertexs.push(x, y, z);
    }

    addNormal(x: number, y: number, z: number) {
        this._normals.push(x, y, z);
    }

    addTextureCoordinates(u: number, v: number) {
        if (this._textures === undefined) {
            this._textures = [];
        }
        this._textures.push(u, v);
    }

    addIndices(i1: number, i2: number, i3: number) {
        this._indices.push(i1, i2, i3);
    }

    addColor(color: number) {
        this._color = color;
    }

    addVertexColor(color: number) {
        if (this._vertexColors === undefined) {
            this._vertexColors = [];
        }
        this._vertexColors.push(color);
    }

    buildVertex(): VertexRenderData {
        return this.buildVertexOrEdge("vertex");
    }

    buildEdge(): EdgeRenderData {
        return this.buildVertexOrEdge("edge");
    }

    private buildVertexOrEdge(type: "vertex" | "edge") {
        return {
            type,
            vertexs: this._vertexs,
            color: this._color,
            vertexColors: this._vertexColors,
        };
    }

    buildFace(): FaceRenderData {
        return {
            type: "face",
            vertexs: this._vertexs,
            color: this._color,
            vertexColors: this._vertexColors,
            normals: this._normals,
            indices: this._indices,
            textures: this._textures,
        };
    }
}
