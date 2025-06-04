// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import { Matrix4, XYZ } from "../math";
import { Serializer } from "../serialize";
import { LineType } from "./lineType";
import { ISubShape } from "./shape";

@Serializer.register(["start", "count", "materialIndex"])
export class MeshGroup {
    @Serializer.serialze()
    start: number;
    @Serializer.serialze()
    count: number;
    @Serializer.serialze()
    materialIndex: number;

    constructor(start: number, count: number, materialIndex: number) {
        this.start = start;
        this.count = count;
        this.materialIndex = materialIndex;
    }
}

export type MeshType = "surface" | "linesegments";

@Serializer.register([])
export class Mesh {
    static createSurface(positionSize: number, indexSize: number) {
        let mesh = new Mesh();
        mesh.meshType = "surface";
        mesh.normal = new Float32Array(positionSize * 3);
        mesh.uv = new Float32Array(positionSize * 2);
        mesh.position = new Float32Array(positionSize * 3);
        mesh.index = new Uint32Array(indexSize);
        return mesh;
    }

    static createLineSegments(size: number) {
        let mesh = new Mesh();
        mesh.meshType = "linesegments";
        mesh.position = new Float32Array(size * 3);
        return mesh;
    }

    @Serializer.serialze()
    meshType: MeshType = "linesegments";

    @Serializer.serialze()
    position: Float32Array | undefined;

    @Serializer.serialze()
    normal: Float32Array | undefined = undefined;

    @Serializer.serialze()
    index: Uint32Array | undefined = undefined;

    @Serializer.serialze()
    color: number | number[] = 0xfff;

    @Serializer.serialze()
    uv: Float32Array | undefined = undefined;

    @Serializer.serialze()
    groups: MeshGroup[] = [];
}

export interface IShapeMeshData {
    edges: EdgeMeshData | undefined;
    faces: FaceMeshData | undefined;
}

export interface ShapeMeshRange {
    start: number;
    count: number;
    shape: ISubShape;
    transform?: Matrix4;
}

export interface ShapeMeshData {
    position: Float32Array;
    range: ShapeMeshRange[];
    color?: number | number[];
}

export namespace ShapeMeshData {
    export function isVertex(data: ShapeMeshData): data is VertexMeshData {
        return (data as VertexMeshData)?.size !== undefined;
    }

    export function isEdge(data: ShapeMeshData): data is EdgeMeshData {
        return (data as EdgeMeshData)?.lineType !== undefined;
    }

    export function isFace(data: ShapeMeshData): data is FaceMeshData {
        return (data as FaceMeshData)?.index !== undefined;
    }
}

export interface VertexMeshData extends ShapeMeshData {
    size: number;
}

export namespace VertexMeshData {
    export function from(point: XYZ, size: number, color: number): VertexMeshData {
        return {
            position: new Float32Array([point.x, point.y, point.z]),
            range: [],
            color,
            size,
        };
    }
}

export interface EdgeMeshData extends ShapeMeshData {
    lineType: LineType;
    lineWidth?: number;
}

export function concatTypedArrays<T extends Float32Array | Uint32Array>(arrays: T[]): T {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
    const result = new (arrays[0].constructor as new (length: number) => T)(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

export namespace EdgeMeshData {
    export function from(start: XYZ, end: XYZ, color: number, lineType: LineType): EdgeMeshData {
        return {
            position: new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]),
            color,
            lineType,
            range: [],
        };
    }

    export function merge(data: EdgeMeshData, other: EdgeMeshData): EdgeMeshData {
        const otherRange = other.range.map((range) => {
            return {
                start: range.start + data.position.length / 3,
                count: range.count,
                shape: range.shape,
                transform: range.transform,
            };
        });
        return {
            position: concatTypedArrays([data.position, other.position]),
            range: data.range.concat(otherRange),
            color: data.color,
            lineType: data.lineType,
            lineWidth: data.lineWidth,
        };
    }
}

export interface FaceMeshData extends ShapeMeshData {
    index: Uint32Array;
    normal: Float32Array;
    uv: Float32Array;
    groups: MeshGroup[];
}

export namespace FaceMeshData {
    export function merge(data: FaceMeshData, other: FaceMeshData): FaceMeshData {
        const otherRange = other.range.map((range) => {
            return {
                start: range.start + data.position.length / 3,
                count: range.count,
                shape: range.shape,
                transform: range.transform,
            };
        });
        const groups = other.groups.map((group) => {
            return {
                start: group.start + data.index.length,
                count: group.count,
                materialIndex: group.materialIndex,
            };
        });
        return {
            position: concatTypedArrays([data.position, other.position]),
            range: data.range.concat(otherRange),
            index: concatTypedArrays([data.index, other.index]),
            normal: concatTypedArrays([data.normal, other.normal]),
            uv: concatTypedArrays([data.uv, other.uv]),
            color: data.color,
            groups,
        };
    }
}

export abstract class MeshDataBuilder<T extends ShapeMeshData> {
    protected readonly _positions: number[] = [];
    protected readonly _groups: ShapeMeshRange[] = [];
    protected _color: number | undefined;
    protected _vertexColor: number[] | undefined;

    setColor(color: number) {
        this._color = color;
    }

    addColor(r: number, g: number, b: number) {
        this._vertexColor ??= [];
        this._vertexColor.push(r, g, b);
        return this;
    }

    protected getColor() {
        let color: number | number[] | undefined = this._vertexColor;
        if (this._vertexColor?.length !== this._positions.length) {
            color = this._color;
        }
        return color;
    }

    abstract newGroup(): this;

    abstract endGroup(shape: ISubShape): this;

    abstract addPosition(x: number, y: number, z: number): this;

    abstract build(): T;
}

/**
 * LineSegments
 */
export class EdgeMeshDataBuilder extends MeshDataBuilder<EdgeMeshData> {
    protected _positionStart: number = 0;
    private _previousVertex: [number, number, number] | undefined = undefined;
    private _lineType: LineType = LineType.Solid;

    constructor() {
        super();
        this._color = VisualConfig.defaultEdgeColor;
    }

    setType(type: LineType) {
        this._lineType = type;
    }

    override newGroup() {
        this._positionStart = this._positions.length;
        this._previousVertex = undefined;
        return this;
    }

    override endGroup(shape: ISubShape) {
        this._groups.push({
            start: this._positionStart / 3,
            count: (this._positions.length - this._positionStart) / 3,
            shape,
        });
        return this;
    }

    override addPosition(x: number, y: number, z: number) {
        if (this._previousVertex) {
            this._positions.push(...this._previousVertex, x, y, z);
        }
        this._previousVertex = [x, y, z];
        return this;
    }

    override build(): EdgeMeshData {
        let color = this.getColor()!;
        return {
            position: new Float32Array(this._positions),
            range: this._groups,
            lineType: this._lineType,
            color,
        };
    }
}

export class FaceMeshDataBuilder extends MeshDataBuilder<FaceMeshData> {
    private _indexStart: number = 0;
    private _groupStart: number = 0;
    private readonly _normals: number[] = [];
    private readonly _uvs: number[] = [];
    private readonly _indices: number[] = [];

    constructor() {
        super();
        this._color = VisualConfig.defaultFaceColor;
    }

    override newGroup() {
        this._groupStart = this._indices.length;
        this._indexStart = this._positions.length / 3;
        return this;
    }

    override endGroup(shape: ISubShape) {
        this._groups.push({
            start: this._groupStart,
            count: this._indices.length - this._groupStart,
            shape,
        });
        return this;
    }

    override addPosition(x: number, y: number, z: number) {
        this._positions.push(x, y, z);
        return this;
    }

    addNormal(x: number, y: number, z: number) {
        this._normals.push(x, y, z);
        return this;
    }

    addUV(u: number, v: number) {
        this._uvs.push(u, v);
        return this;
    }

    addIndices(i1: number, i2: number, i3: number) {
        this._indices.push(this._indexStart + i1, this._indexStart + i2, this._indexStart + i3);
        return this;
    }

    build(): FaceMeshData {
        return {
            position: new Float32Array(this._positions),
            color: this.getColor()!,
            normal: new Float32Array(this._normals),
            index: new Uint32Array(this._indices),
            uv: new Float32Array(this._uvs),
            range: this._groups,
            groups: [],
        };
    }
}
