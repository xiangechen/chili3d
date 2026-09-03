// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    IDocument,
    IEventHandler,
    IHighlighter,
    IMeshExporter,
    INode,
    ISelection,
    IView,
    IVisual,
    IVisualContext,
    IVisualObject,
} from "../src";

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

export interface MockVisualOverrides {
    highlighter?: Partial<IHighlighter>;
    meshExporter?: Partial<IMeshExporter>;
    eventHandler?: Partial<IEventHandler>;
    viewHandler?: Partial<IEventHandler>;
    context?: Partial<IVisualContext>;
}

/**
 * Richer mock of IVisual for tests whose code under test calls event handlers or the
 * mesh exporter: unlike `createMockVisual`, the highlighter/context get the no-op
 * defaults from `createMockHighlighter` / `createMockVisualContext`, and
 * `eventHandler` / `viewHandler` / `meshExporter` are callable stubs instead of `{}`.
 */
export function createMockVisualWithDocument(
    document: IDocument,
    overrides: MockVisualOverrides = {},
): IVisual {
    const highlighter: IHighlighter = {
        ...createMockHighlighter().highlighter,
        ...overrides.highlighter,
    };

    const context: IVisualContext = {
        ...createMockVisualContext(),
        ...overrides.context,
    } as unknown as IVisualContext;

    const defaultEventHandler: IEventHandler = {
        isEnabled: true,
        pointerMove: () => {},
        pointerDown: () => {},
        pointerUp: () => {},
        keyDown: () => {},
        dispose: () => {},
    };

    return {
        document,
        context,
        highlighter,
        meshExporter: {
            exportToStl: async () => ({ ok: false }),
            exportToPly: async () => ({ ok: false }),
            exportToObj: async () => ({ ok: false }),
            ...overrides.meshExporter,
        } as IMeshExporter,
        update: () => {},
        viewHandler: { ...defaultEventHandler, ...overrides.viewHandler } as IEventHandler,
        defaultEventHandler,
        eventHandler: { ...defaultEventHandler, ...overrides.eventHandler } as IEventHandler,
        createView: () => ({}) as IView,
        dispose: () => {},
    } as unknown as IVisual;
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
        setNodeOnTop: () => {},
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
