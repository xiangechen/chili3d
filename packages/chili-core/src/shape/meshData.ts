// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import { XYZ } from "../math";
import { Serializer } from "../serialize";
import { LineType } from "./lineType";
import { IShape } from "./shape";

@Serializer.register(["start", "count", "materialId"])
export class MeshGroup {
    @Serializer.serialze()
    start: number;
    @Serializer.serialze()
    count: number;
    @Serializer.serialze()
    materialId: string;

    constructor(start: number, count: number, materialId: string) {
        this.start = start;
        this.count = count;
        this.materialId = materialId;
    }
}

@Serializer.register([])
export class Mesh {
    static createSurface() {
        let mesh = new Mesh();
        mesh.meshType = "surface";
        mesh.normal = [];
        mesh.uv = [];
        return mesh;
    }

    @Serializer.serialze()
    meshType: "line" | "surface" | "linesegments" = "line";

    @Serializer.serialze()
    position: number[] = [];

    @Serializer.serialze()
    normal: number[] | undefined = undefined;

    @Serializer.serialze()
    index: number[] | undefined = undefined;

    @Serializer.serialze()
    color: number | number[] = 0xfff;

    @Serializer.serialze()
    uv: number[] | undefined = undefined;

    @Serializer.serialze()
    groups: MeshGroup[] = [];
}

export interface IShapeMeshData {
    get edges(): EdgeMeshData | undefined;
    get faces(): FaceMeshData | undefined;
    updateMeshShape(): void;
}

export interface ShapeMeshGroup {
    start: number;
    count: number;
    shape: IShape;
}

export interface ShapeMeshData {
    positions: Float32Array;
    groups: ShapeMeshGroup[];
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
        return (data as FaceMeshData)?.indices !== undefined;
    }
}

export interface VertexMeshData extends ShapeMeshData {
    size: number;
}

export namespace VertexMeshData {
    export function from(point: XYZ, size: number, color: number): VertexMeshData {
        return {
            positions: new Float32Array([point.x, point.y, point.z]),
            groups: [],
            color,
            size,
        };
    }
}

export interface EdgeMeshData extends ShapeMeshData {
    lineType: LineType;
    lineWidth?: number;
}

export namespace EdgeMeshData {
    export function from(start: XYZ, end: XYZ, color: number, lineType: LineType): EdgeMeshData {
        return {
            positions: new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]),
            color,
            lineType,
            groups: [],
        };
    }
}

export interface FaceMeshData extends ShapeMeshData {
    indices: Uint16Array | Uint32Array;
    normals: Float32Array;
    uvs: Float32Array;
}

export function arrayNeedsUint32(array: number[]) {
    for (let i = array.length - 1; i >= 0; --i) {
        if (array[i] >= 65535) return true; // account for PRIMITIVE_RESTART_FIXED_INDEX, #24565
    }
    return false;
}

export abstract class MeshDataBuilder<T extends ShapeMeshData> {
    protected readonly _positions: number[] = [];
    protected readonly _groups: ShapeMeshGroup[] = [];
    protected _color: number | undefined;
    protected _vertexColor: number[] | undefined;

    setColor(color: number) {
        this._color = color;
    }

    addColor(r: number, g: number, b: number) {
        if (this._vertexColor === undefined) this._vertexColor = [];
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

    abstract endGroup(shape: IShape): this;

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

    override endGroup(shape: IShape) {
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
            positions: new Float32Array(this._positions),
            groups: this._groups,
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

    override endGroup(shape: IShape) {
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
        let color = this.getColor()!;
        return {
            positions: new Float32Array(this._positions),
            color,
            normals: new Float32Array(this._normals),
            indices: arrayNeedsUint32(this._indices)
                ? new Uint32Array(this._indices)
                : new Uint16Array(this._indices),
            uvs: new Float32Array(this._uvs),
            groups: this._groups,
        };
    }
}
