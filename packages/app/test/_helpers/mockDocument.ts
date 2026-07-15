// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    History,
    I18nKeys,
    IApplication,
    IDocument,
    IEventHandler,
    INode,
    IPicker,
    ISelection,
    IStorage,
    ModelManager,
    ObservableCollection,
    Serialized,
    Signal,
    VisualShapeData,
} from "@chili3d/core";
import { BoundingBox, VisualNode } from "@chili3d/core";
import { createMockVisual } from "./mockVisual";

export interface MockDocumentOverrides {
    id?: string;
    name?: string;
    selection?: Partial<ISelection>;
    history?: Partial<History>;
    modelManager?: Partial<ModelManager>;
    application?: IApplication;
    storage?: Partial<IStorage>;
}

/**
 * A concrete VisualNode subclass so instanceof checks pass in tests.
 */
export class TestNode extends VisualNode {
    constructor(name = "test", id = "test-id") {
        // biome-ignore lint/suspicious/noExplicitAny: constructor args not needed for test
        super(null as any, name, id);
    }
    display(): I18nKeys {
        return "common.ok" as I18nKeys;
    }
    boundingBox() {
        return new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
}

/**
 * Create a plain INode (not a VisualNode) for testing instanceof filtering.
 */
export function createPlainNode(): INode {
    return {} as unknown as INode;
}

/**
 * Create a configurable mock IDocument for unit tests.
 * Builds on top of createMockVisual.
 */
export function createMockDocument(overrides: MockDocumentOverrides = {}): IDocument {
    const docId = overrides.id ?? "mock-doc-id";
    const docName = overrides.name ?? "mock-doc";

    const mockApp = (overrides.application ?? {}) as IApplication;

    const onNodeChangedSignal = createMockSignal<(selected: INode[]) => void>();
    const onShapeChangedSignal = createMockSignal<(selected: VisualShapeData[]) => void>();

    const selection: ISelection = {
        onNodeChanged: onNodeChangedSignal,
        onShapeChanged: onShapeChangedSignal,
        setSelectedNodes: () => 0,
        setSelectedShapes: () => 0,
        getSelectedNodes: () => [],
        getSelectedNodeLength: () => 0,
        getSelectedShapes: () => [],
        getSelectedVisualNodes: () => [],
        clearSelection: () => {},
        dispose: () => {},
        ...overrides.selection,
    };

    const history: History = {
        disabled: false,
        add: () => {},
        addRecords: () => {},
        undo: async () => undefined,
        redo: async () => undefined,
        dispose: () => {},
        ...overrides.history,
    } as unknown as History;

    const modelManager: ModelManager = {
        nodes: [],
        materials: [],
        addNode: () => {},
        getChildren: () => [],
        dispose: () => {},
        ...overrides.modelManager,
    } as unknown as ModelManager;

    // resolve circular reference — declare doc first so visual can reference it
    const doc = {} as IDocument;
    const visual = createMockVisual(doc);

    Object.assign(doc, {
        id: docId,
        name: docName,
        selection,
        picker: {} as IPicker,
        history,
        visual,
        application: mockApp,
        modelManager,
        acts: {
            length: 0,
            push: () => 0,
            remove: () => {},
            dispose: () => {},
        } as unknown as ObservableCollection<any>,
        userData: {},
        save: async () => {},
        close: async () => {},
        serialize: () => ({}) as Serialized,
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        onPropertyChanged: () => {},
        dispose: () => {},
    });

    // patch visual.document to point to this doc
    (visual as any).document = doc;

    return doc;
}

/** Helper to create a minimal mock Signal */
function createMockSignal<T extends (...args: any[]) => void>(): Signal<T> {
    let listeners: T[] = [];
    return {
        sub: (listener: T) => {
            listeners.push(listener);
        },
        remove: (listener: T) => {
            listeners = listeners.filter((l) => l !== listener);
        },
        emit: (...args: any[]) => {
            for (const l of listeners) {
                l(...(args as any));
            }
        },
        dispose: () => {
            listeners = [];
        },
    } as unknown as Signal<T>;
}
