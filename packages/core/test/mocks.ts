// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    BoundingBox,
    EdgeMeshData,
    ICurve,
    IFace,
    IHighlighter,
    INode,
    IShape,
    IShapeMeshData,
    IVisualContext,
    IVisualObject,
    OrientedBoundingBox,
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
import { Plane, Ray, XY, XYZ } from "../src/math";
import type { MouseAndDetected } from "../src/snap/snap";

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

// ============================================================================
// TestDocument + createMockVisual — IDocument / IVisual mock
// ============================================================================

/**
 * Lightweight mock of IVisual + IVisualContext for unit tests that don't need a real viewport.
 * All context methods are no-ops by default; tests that need specific behavior can
 * replace individual methods via `createMockVisual()` return value.
 */
export function createMockVisual(options?: {
    document?: IDocument;
    highlighter?: IHighlighter;
    getNode?: (v: IVisualObject) => INode | undefined;
}): IVisual {
    const context = createMockVisualContext(options?.getNode);

    return {
        document: options?.document ?? ({} as any),
        highlighter: options?.highlighter ?? ({} as any),
        context,
        meshExporter: {} as any,
        update: () => {},
        viewHandler: {} as any,
        defaultEventHandler: {} as any,
        eventHandler: {} as any,
        createView: () => ({}) as any,
        dispose: () => {},
    } as unknown as IVisual;
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

export function createPointerEvent(overrides?: Partial<PointerEvent>): PointerEvent {
    return {
        button: 0,
        isPrimary: true,
        offsetX: 100,
        offsetY: 200,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
        pointerType: "mouse",
        shiftKey: false,
        preventDefault: () => {},
        stopImmediatePropagation: () => {},
        ...overrides,
    } as PointerEvent;
}

export function createMockHighlighter(): {
    highlighter: IHighlighter;
    addCalls: { shape: IVisualObject; state: number; type: number; indexes: number[] }[];
    removeCalls: { shape: IVisualObject; state: number; type: number; indexes: number[] }[];
} {
    const addCalls: { shape: IVisualObject; state: number; type: number; indexes: number[] }[] = [];
    const removeCalls: { shape: IVisualObject; state: number; type: number; indexes: number[] }[] = [];
    const highlighter: IHighlighter = {
        getState: () => undefined,
        clear: () => {},
        resetState: () => {},
        addState(shape, state, type, ...indexes) {
            addCalls.push({ shape: shape as IVisualObject, state, type, indexes });
        },
        removeState(shape, state, type, ...indexes) {
            removeCalls.push({ shape: shape as IVisualObject, state, type, indexes });
        },
        highlightMesh: () => 0,
        removeHighlightMesh: () => {},
    };
    return { highlighter, addCalls, removeCalls };
}

export function createMockVisualContext(
    getNode: (shape: IVisualObject) => INode | undefined = () => undefined,
): IVisualContext {
    return {
        shapeCount: 0,
        addVisualObject: () => {},
        boundingBoxIntersectFilter: () => [],
        removeVisualObject: () => {},
        addNode: () => {},
        removeNode: () => {},
        getVisual: () => undefined,
        getNode,
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
}

export function createMockSelection(): ISelection {
    return {
        setSelectedNodes: () => 0,
        setSelectedShapes: () => 0,
        getSelectedNodes: () => [],
        getSelectedNodeLength: () => 0,
        getSelectedShapes: () => [],
        getSelectedVisualNodes: () => [],
        clearSelection: () => {},
        onNodeChanged: { on: () => {}, off: () => {} } as any,
        onShapeChanged: { on: () => {}, off: () => {} } as any,
        dispose: () => {},
    };
}

// ============================================================================
// createMockView — IView mock for snap tests
// ============================================================================

/**
 * Creates a mock IView with sensible defaults for snap-related unit tests.
 * All detection methods return empty arrays; rayAt/screenToWorld use
 * parameterized transformations for realistic test scenarios.
 */
export function createMockView(overrides?: Partial<IView>): IView {
    const document = new TestDocument();
    return {
        document,
        cameraController: {} as never,
        isClosed: false,
        width: 800,
        height: 600,
        mode: "solid",
        name: "test-view",
        workplane: Plane.XY,
        update: () => {},
        up: () => XYZ.unitZ,
        toImage: () => "",
        direction: () => XYZ.unitY.reverse(),
        rayAt: (mx: number, my: number) =>
            new Ray({
                point: new XYZ({ x: mx - 400, y: 300 - my, z: 500 }),
                direction: XYZ.unitZ.reverse(),
            }),
        screenToWorld: (mx: number, my: number) => new XYZ({ x: mx - 400, y: 300 - my, z: 0 }),
        worldToScreen: (point: XYZ) => new XY({ x: point.x + 400, y: point.y + 300 }),
        isolate: () => {},
        unisolate: () => {},
        resize: () => {},
        setDom: () => {},
        htmlText: () => ({ dispose: () => {} }),
        close: () => {},
        detectVisual: () => [],
        detectVisualRect: () => [],
        detectShapes: () => [],
        detectShapesRect: () => [],
        getNodes: () => [],
        getAllNodes: () => [],
        getSelectedNodes: () => [],
        setSelectedNodes: () => {},
        setSelectedShapes: () => {},
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        dispose: () => {},
        ...overrides,
    } as unknown as IView;
}

// ============================================================================
// createHandlerMockView — IView mock for handler tests (simpler defaults)
// ============================================================================

/**
 * Like createMockView, but with no-op rayAt/screenToWorld by default.
 * Handler tests that need real ray intersections should override these.
 */
export function createHandlerMockView(overrides?: Partial<IView>): IView {
    return createMockView({
        rayAt: () => new Ray({ point: XYZ.zero, direction: new XYZ({ x: 0, y: 0, z: -1 }) }),
        screenToWorld: () => XYZ.zero,
        ...overrides,
    });
}

// ============================================================================
// createMockCurve — duck-typed curve mock for snap tests
// ============================================================================

/**
 * Creates a lightweight duck-typed curve object for snap unit tests.
 * Provides enough of the ICurve surface for nearestExtrema-based snapping
 * and parametric point evaluation.
 *
 * @param options.nearestPoint — if set, nearestExtrema() returns this point (wrapped as { p1 })
 * @param options.length — curve length; defaults to 1. Controls value(t), endPoint(), and length()
 */
export function createMockCurve(options?: { nearestPoint?: XYZ; length?: number }) {
    const len = options?.length ?? 1;
    return {
        nearestExtrema: () => (options?.nearestPoint ? { p1: options.nearestPoint } : undefined),
        basisCurve: {},
        startPoint: () => XYZ.zero,
        endPoint: () => new XYZ({ x: len, y: 0, z: 0 }),
        firstParameter: () => 0,
        lastParameter: () => 1,
        value: (t: number) => new XYZ({ x: t * len, y: 0, z: 0 }),
        project: () => [],
        length: () => len,
        intersect: () => [],
    } as unknown as ICurve;
}

// ============================================================================
// createMouseAndDetected — MouseAndDetected factory for snap tests
// ============================================================================

export function createMouseAndDetected(view: IView, overrides?: Partial<MouseAndDetected>): MouseAndDetected {
    return {
        view,
        mx: 400,
        my: 300,
        shapes: [],
        ...overrides,
    };
}
