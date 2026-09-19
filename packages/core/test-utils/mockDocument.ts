// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type History,
    type I18nKeys,
    type IApplication,
    type IDocument,
    Id,
    type INode,
    type IPicker,
    type ISelection,
    type IStorage,
    type IVariableTable,
    type ModelManager,
    type ObservableCollection,
    type Serialized,
    Signal,
    VisualNode,
    type VisualShapeData,
} from "../src";
import { createMockVisualWithDocument } from "./mockVisual";

export interface MockDocumentOverrides {
    id?: string;
    name?: string;
    selection?: Partial<ISelection>;
    history?: Partial<History>;
    modelManager?: Partial<ModelManager>;
    application?: IApplication;
    storage?: Partial<IStorage>;
    variables?: Partial<IVariableTable>;
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
 * Accepts an optional name and id so it can also stand in for a generic
 * sibling/parent node in tree-structure tests.
 */
export function createPlainNode(name = "plain-node", id?: string): INode {
    return {
        id: id ?? Id.generate(),
        name,
        visible: true,
        parentVisible: true,
        parent: undefined,
        previousSibling: undefined,
        nextSibling: undefined,
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        clone: () => ({}) as INode,
        dispose: () => {},
    } as unknown as INode;
}

/**
 * Create a configurable mock IDocument for unit tests.
 * Builds on top of createMockVisualWithDocument.
 *
 * Unlike `TestDocument` (which wires real `History` / `ModelManager` instances),
 * this is a pure mock object: every collaborator is a stub and each slice
 * (selection / history / modelManager / ...) can be overridden per field.
 */
export function createMockDocument(overrides: MockDocumentOverrides = {}): IDocument {
    const docId = overrides.id ?? "mock-doc-id";
    const docName = overrides.name ?? "mock-doc";

    const mockApp = (overrides.application ?? {}) as IApplication;

    const onNodeChangedSignal = new Signal<(selected: INode[]) => void>();
    const onShapeChangedSignal = new Signal<(selected: VisualShapeData[]) => void>();

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
        findNode: () => undefined,
        findNodes: () => [],
        getChildren: () => [],
        notifyNodeChanged: () => {},
        dispose: () => {},
        ...overrides.modelManager,
    } as unknown as ModelManager;

    // resolve circular reference — declare doc first so visual can reference it
    const doc = {} as IDocument;
    const visual = createMockVisualWithDocument(doc);

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
        variables: {
            document: doc,
            items: [],
            variablesJson: "[]",
            revision: 0,
            setItems: () => {},
            evaluate: () => ({ scope: new Map(), errors: new Map() }),
            onPropertyChanged: () => {},
            removePropertyChanged: () => {},
            clearPropertyChanged: () => {},
            dispose: () => {},
            ...overrides.variables,
        } as unknown as IVariableTable,
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
