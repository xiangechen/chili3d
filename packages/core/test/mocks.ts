// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    BoundingBox,
    EdgeMeshData,
    IFace,
    IShape,
    IShapeMeshData,
    OrientedBoundingBox,
    Plane,
    ShapeType,
    XYZLike,
} from "../src";
import {
    type Act,
    History,
    type IApplication,
    type IDocument,
    InternalClassName,
    type IPicker,
    type ISelection,
    type IView,
    type IVisual,
    Matrix4,
    ModelManager,
    ObservableCollection,
    type Orientation,
    type PropertyChangedHandler,
    type Serialized,
    ShapeTypes,
    VisualConfig,
} from "../src";

// ============================================================================
// MockShape — IShape mock
// ============================================================================

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

    fixSmallFace(_tolerance: number): IShape {
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

// ============================================================================
// TestDocument + createMockVisual — IDocument / IVisual mock
// ============================================================================

/**
 * Lightweight mock of IVisual + IVisualContext for unit tests that don't need a real viewport.
 * All context methods are no-ops by default; tests that need specific behavior can
 * replace individual methods via `createMockVisual()` return value.
 */
export function createMockVisual(): IVisual {
    const context = {
        shapeCount: 0,
        addVisualObject: () => {},
        boundingBoxIntersectFilter: () => [],
        removeVisualObject: () => {},
        addNode: () => {},
        removeNode: () => {},
        getVisual: () => undefined,
        getNode: () => undefined,
        redrawNode: () => {},
        setVisible: () => {},
        visuals: () => [],
        displayMesh: () => 0,
        setMeshColor: () => {},
        removeMesh: () => {},
        displayInstancedMesh: () => 0,
        displayLineSegments: () => 0,
        setPosition: () => {},
        setInstanceMatrix: () => {},
        dispose: () => {},
    };

    return { context } as unknown as IVisual;
}

export class TestDocument implements IDocument {
    application: IApplication;
    name: string;
    id: string;
    history: History;
    selection: ISelection;
    picker: IPicker;
    visual: IVisual;
    activeView: IView | undefined;
    userData?: Record<string, unknown> | undefined;
    modelManager: ModelManager;
    acts: ObservableCollection<Act> = new ObservableCollection<Act>();

    onPropertyChanged<K extends keyof this>(_handler: PropertyChangedHandler<this, K>): void {
        // no-op: TestDocument is not observable in tests
    }

    removePropertyChanged<K extends keyof this>(_handler: PropertyChangedHandler<this, K>): void {
        // no-op
    }

    clearPropertyChanged(): void {
        // no-op
    }

    dispose() {
        this.modelManager.dispose();
    }

    save(): Promise<void> {
        return Promise.resolve();
    }

    importFiles(_files: File[] | FileList): Promise<void> {
        return Promise.resolve();
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    serialize(): Serialized {
        return {
            [InternalClassName]: "TestDocument",
            properties: {},
        };
    }

    constructor(overrides?: Partial<Pick<TestDocument, "visual" | "application" | "selection" | "picker">>) {
        this.name = "test";
        this.id = "test";
        this.visual = overrides?.visual ?? createMockVisual();
        this.history = new History();
        this.selection = overrides?.selection ?? ({} as ISelection);
        this.picker = overrides?.picker ?? ({} as IPicker);
        this.application = overrides?.application ?? ({ views: [] } as unknown as IApplication);
        this.modelManager = new ModelManager(this);
    }
}
