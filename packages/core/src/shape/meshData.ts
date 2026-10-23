// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import type { Matrix4, XYZ } from "../math";
import { serializable, serialize } from "../serialize";
import type { LineType } from "./lineType";
import type { ISubShape } from "./shape";

export interface MeshGroupOptions {
    start: number;
    count: number;
    materialIndex: number;
}

@serializable()
export class MeshGroup {
    @serialize()
    start: number;
    @serialize()
    count: number;
    @serialize()
    materialIndex: number;

    constructor(options: MeshGroupOptions) {
        this.start = options.start;
        this.count = options.count;
        this.materialIndex = options.materialIndex;
    }
}

export type MeshType = "surface" | "linesegments";

export interface MeshOptions {
    meshType?: MeshType;
    position?: Float32Array;
    normal?: Float32Array;
    index?: Uint32Array;
    color?: number | number[];
    uv?: Float32Array;
    groups?: MeshGroup[];
}

@serializable()
export class Mesh {
    constructor(options?: MeshOptions) {
        this.meshType = options?.meshType ?? "linesegments";
        this.position = options?.position;
        this.normal = options?.normal;
        this.index = options?.index;
        this.color = options?.color ?? 0xfff;
        this.uv = options?.uv;
        this.groups = options?.groups ?? [];
    }
    static createSurface(positionSize: number, indexSize: number) {
        const mesh = new Mesh();
        mesh.meshType = "surface";
        mesh.normal = new Float32Array(positionSize * 3);
        mesh.uv = new Float32Array(positionSize * 2);
        mesh.position = new Float32Array(positionSize * 3);
        mesh.index = new Uint32Array(indexSize);
        return mesh;
    }

    static createLineSegments(size: number) {
        const mesh = new Mesh();
        mesh.meshType = "linesegments";
        mesh.position = new Float32Array(size * 3);
        return mesh;
    }

    @serialize()
    meshType: MeshType = "linesegments";

    @serialize()
    position: Float32Array | undefined;

    @serialize()
    normal: Float32Array | undefined = undefined;

    @serialize()
    index: Uint32Array | undefined = undefined;

    @serialize()
    color: number | number[] = 0xfff;

    @serialize()
    uv: Float32Array | undefined = undefined;

    @serialize()
    groups: MeshGroup[] = [];
}

export interface IShapeMeshData {
    edges: EdgeMeshData | undefined;
    faces: FaceMeshData | undefined;
    vertexs: VertexMeshData | undefined;
}

export interface ShapeMeshRange {
    start: number;
    count: number;
    shape: ISubShape;
    transform?: Matrix4;
    /**
     * Draws this range's segments with a line type other than the mesh's own — how appended
     * display-only edges (auxiliary lines) stay dashed inside a solid mesh. A renderer splits
     * the mesh at these ranges (`MeshDataUtils.splitEdgeRuns`); left undefined everywhere else.
     */
    lineType?: LineType;
}

export interface ShapeMeshData {
    position: Float32Array;
    range: ShapeMeshRange[];
    color?: number | number[];
}

export interface MeshLike {
    position: Float32Array;
    index: Uint32Array;
    normal: Float32Array;
    uv: Float32Array;
    color?: number | number[];
}

export class MeshDataUtils {
    static isVertexMesh(data: ShapeMeshData): data is VertexMeshData {
        return (data as VertexMeshData)?.size !== undefined;
    }

    static isEdgeMesh(data: ShapeMeshData): data is EdgeMeshData {
        return (data as EdgeMeshData)?.lineType !== undefined;
    }

    static isFaceMesh(data: ShapeMeshData): data is FaceMeshData {
        return (data as FaceMeshData)?.index !== undefined;
    }

    static createVertexMesh(point: XYZ, size: number, color: number): VertexMeshData {
        return {
            position: new Float32Array([point.x, point.y, point.z]),
            range: [],
            color,
            size,
        };
    }

    static createEdgeMesh(start: XYZ, end: XYZ, color: number, lineType: LineType): EdgeMeshData {
        return {
            position: new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]),
            color,
            lineType,
            range: [],
        };
    }

    static mergeEdgeMesh(data: EdgeMeshData, other: EdgeMeshData): EdgeMeshData {
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

    /**
     * Appends display-only edges to an edge mesh, keeping colours correct on both sides:
     * when every part carries the same single colour the result keeps it, otherwise each
     * part expands to the per-vertex RGB triplets the array form of `color` consumes
     * (`mergeEdgeMesh` cannot serve here — it keeps only the first side's colour). A part
     * whose line type differs from the base mesh's keeps it on its copied ranges, so a
     * renderer can still tell its segments apart. Neither input is mutated.
     */
    static appendEdgeMeshes(data: EdgeMeshData | undefined, extras: EdgeMeshData[]): EdgeMeshData {
        const parts = [data, ...extras].filter(
            (x): x is EdgeMeshData => x !== undefined && x.position.length > 0,
        );
        const baseLineType = parts[0]?.lineType ?? "solid";
        let position: Float32Array = new Float32Array(0);
        let range: ShapeMeshRange[] = [];
        for (const part of parts) {
            const offset = position.length / 3;
            position = concatTypedArrays([position, part.position]);
            range = range.concat(
                part.range.map((x) => {
                    const rebased = { ...x, start: x.start + offset };
                    if (part.lineType !== baseLineType) rebased.lineType = part.lineType;
                    return rebased;
                }),
            );
        }
        return {
            position,
            range,
            lineType: baseLineType,
            lineWidth: parts[0]?.lineWidth,
            color: MeshDataUtils.mergedEdgeColor(parts),
        };
    }

    /**
     * Splits an edge mesh into maximal runs of one line type, for a renderer that draws each
     * type with an object of its own (dashing is a per-material feature). Ranges carrying a
     * `lineType` other than the mesh's own mark the non-default blocks — adjacent ones of the
     * same type coalesce — everything else, including segments no range covers, keeps the
     * mesh's type. `startVertex` maps the run back into the source mesh's vertex numbering, so
     * a pick index found in a run object shifts back by it. Without any marked range the whole
     * mesh comes back as a single run sharing the source arrays — no copying.
     */
    static splitEdgeRuns(data: EdgeMeshData): EdgeMeshRun[] {
        const marked = data.range.filter((x) => x.lineType !== undefined && x.lineType !== data.lineType);
        if (marked.length === 0 || data.position.length === 0) {
            return [
                {
                    lineType: data.lineType,
                    startVertex: 0,
                    position: data.position,
                    color: data.color,
                },
            ];
        }

        const blocks: { start: number; end: number; lineType: LineType }[] = [];
        for (const range of [...marked].sort((a, b) => a.start - b.start)) {
            const last = blocks.at(-1);
            if (last && last.lineType === range.lineType && last.end === range.start) {
                last.end = range.start + range.count;
            } else {
                blocks.push({
                    start: range.start,
                    end: range.start + range.count,
                    lineType: range.lineType!,
                });
            }
        }

        const runs: EdgeMeshRun[] = [];
        const pushRun = (start: number, end: number, lineType: LineType) => {
            if (end <= start) return;
            runs.push({
                lineType,
                startVertex: start,
                position: data.position.slice(start * 3, end * 3),
                color: Array.isArray(data.color) ? data.color.slice(start * 3, end * 3) : data.color,
            });
        };
        let cursor = 0;
        for (const block of blocks) {
            pushRun(cursor, block.start, data.lineType);
            pushRun(block.start, block.end, block.lineType);
            cursor = block.end;
        }
        pushRun(cursor, data.position.length / 3, data.lineType);
        return runs;
    }

    private static mergedEdgeColor(parts: EdgeMeshData[]): number | number[] {
        const first = parts[0]?.color ?? VisualConfig.defaultEdgeColor;
        const uniform = parts.every(
            (x) => !Array.isArray(x.color) && (x.color ?? VisualConfig.defaultEdgeColor) === first,
        );
        if (uniform) return first;
        return parts.flatMap((x) => MeshDataUtils.expandEdgeColor(x));
    }

    private static expandEdgeColor(part: EdgeMeshData): number[] {
        if (Array.isArray(part.color)) return part.color;
        const color = part.color ?? VisualConfig.defaultEdgeColor;
        const rgb = [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
        const result: number[] = [];
        for (let i = 0; i < part.position.length / 3; i++) {
            result.push(rgb[0], rgb[1], rgb[2]);
        }
        return result;
    }

    static mergeFaceMesh(data: FaceMeshData, other: FaceMeshData): FaceMeshData {
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

export interface VertexMeshData extends ShapeMeshData {
    size: number;
}

export interface EdgeMeshData extends ShapeMeshData {
    lineType: LineType;
    lineWidth?: number;
}

/** One maximal run of same-type segments inside an edge mesh — see `MeshDataUtils.splitEdgeRuns`. */
export interface EdgeMeshRun {
    lineType: LineType;
    /** Index of the run's first vertex in the source mesh; a pick index found in the run shifts back by it. */
    startVertex: number;
    position: Float32Array;
    color?: number | number[];
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

export interface FaceMeshData extends ShapeMeshData {
    index: Uint32Array;
    normal: Float32Array;
    uv: Float32Array;
    groups: MeshGroup[];
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
    private _lineType: LineType = "solid";

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
        const color = this.getColor()!;
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
