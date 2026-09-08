// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    BoundingBox,
    EdgeMeshData,
    IEdge,
    IFace,
    IShape,
    IShapeMeshData,
    IWire,
    OrientedBoundingBox,
    ShapeType,
    XYZLike,
} from "../src";
import { Matrix4, type Orientation, ShapeTypes, VisualConfig } from "../src";
import type { Plane, XYZ } from "../src/math";
import type { ITrimmedCurve } from "../src/shape/curve";
import { createMockEdgeCurve } from "./mockCurve";

/**
 * Configurable mock of IShape for unit tests.
 *
 * Defaults provide rich mesh data (faces, edges, vertexs with Float32Arrays) so that
 * tests exercising mesh assembly (MultiShapeMesh, etc.) work out of the box.
 * Tests that only need an instanceof check can ignore the defaults.
 */
export class MockShape implements IShape {
    readonly shapeType: ShapeType;
    private _id: string;
    matrix: Matrix4;
    volume(): number {
        return 0;
    }

    constructor(overrides?: { shapeType?: ShapeType; id?: string; matrix?: Matrix4 }) {
        this.shapeType = overrides?.shapeType ?? ShapeTypes.compound;
        this._id = overrides?.id ?? "mock-shape-id";
        this.matrix = overrides?.matrix ?? Matrix4.identity();
    }

    get id(): string {
        return this._id;
    }

    private _mesh?: IShapeMeshData;
    get mesh(): IShapeMeshData {
        this._mesh ??= {
            faces: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                range: [{ start: 0, count: 3, shape: {} as any }],
                groups: [],
                color: VisualConfig.defaultFaceColor,
            },
            edges: {
                lineType: "solid",
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0]),
                range: [{ start: 0, count: 4, shape: {} as any }],
                color: VisualConfig.defaultEdgeColor,
            },
            vertexs: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]),
                color: VisualConfig.defaultFaceColor,
                range: [],
                size: 3,
            },
        };
        return this._mesh;
    }

    setTolerance(tolerance: number): void {}

    transformed(_matrix: Matrix4): IShape {
        return new MockShape();
    }

    transformedMul(_matrix: Matrix4): IShape {
        return new MockShape();
    }

    edgesMeshPosition(): EdgeMeshData {
        return this.mesh.edges!;
    }

    extremaDistance(_other: IShape): number {
        return 0;
    }

    boundingBox(): BoundingBox {
        throw new Error("Method not implemented.");
    }

    orientedBoundingBox(): OrientedBoundingBox {
        throw new Error("Method not implemented.");
    }

    isClosed(): boolean {
        return true;
    }

    isNull(): boolean {
        return false;
    }

    isEqual(other: IShape): boolean {
        return this === other;
    }

    isSame(other: IShape): boolean {
        return this === other;
    }

    isPartner(other: IShape): boolean {
        return this === other;
    }

    orientation(): Orientation {
        return "forward";
    }

    findAncestor(_ancestorType: ShapeType, _fromShape: IShape): IShape[] {
        return [];
    }

    findSubShapes(_subshapeType: ShapeType): IShape[] {
        return [];
    }

    findFaceContainsPoint(_point: XYZLike, _tolerance: number): IFace | undefined {
        return undefined;
    }

    fixShape(_tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }

    shellSewing(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }

    checkShape(): boolean {
        return true;
    }

    checkFaces(): { index: number; isValid: boolean; status: string[] }[] {
        return [];
    }

    fixSmallFace(_tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }

    fixSolid(_tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }

    directSubShapes(): IShape[] {
        return [this];
    }

    section(_shape: IShape | Plane): IShape {
        return new MockShape();
    }

    split(_shapes: IShape[]): IShape {
        return new MockShape();
    }

    reserve(): void {}

    clone(): IShape {
        return new MockShape();
    }

    hlr(_position: XYZLike, _direction: XYZLike, _xDir: XYZLike): IShape {
        return new MockShape();
    }

    dispose(): void {}
}

export interface MockEdgeConfig {
    curve?: ITrimmedCurve;
    orientation?: Orientation;
    intersectResult?: { point: XYZ; parameter: number }[];
}

/**
 * Duck-typed IEdge for unit tests. `isEqual` uses identity comparison,
 * `intersect` returns `intersectResult` (default: no intersections).
 */
export function createMockEdge(config?: MockEdgeConfig): IEdge {
    const curve = config?.curve ?? createMockEdgeCurve();
    const edge = {
        shapeType: ShapeTypes.edge,
        curve,
        orientation: () => config?.orientation ?? "forward",
        isEqual: (other: IShape) => other === edge,
        intersect: () => config?.intersectResult ?? [],
        ends: () => [curve.value(curve.firstParameter()), curve.value(curve.lastParameter())],
    } as unknown as IEdge;
    return edge;
}

/**
 * Duck-typed IWire for unit tests. `findSubShapes(ShapeTypes.edge)` returns the given edges,
 * any other shape type returns an empty array.
 */
export function createMockWire(edges: IEdge[], orientation: Orientation = "forward"): IWire {
    return {
        shapeType: ShapeTypes.wire,
        orientation: () => orientation,
        findSubShapes: (subshapeType: ShapeType) => (subshapeType === ShapeTypes.edge ? edges : []),
    } as unknown as IWire;
}
