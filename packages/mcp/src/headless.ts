// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Deep import to avoid the @chili3d/app barrel, which transitively pulls in
// @chili3d/element / @chili3d/ui (web components extending HTMLElement) and would
// fail to evaluate in a pure Node environment. document.ts only depends on
// @chili3d/core, so it is headless-safe.
import { Document } from "@chili3d/app/src/document";
import {
    type IApplication,
    type ICommand,
    type IDataExchange,
    type IDocument,
    type IPluginManager,
    type IService,
    type IShapeFactory,
    type IStorage,
    type IView,
    type IVisual,
    type IVisualContext,
    type IVisualFactory,
    Material,
    Observable,
    ObservableCollection,
    type Serialized,
} from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";

// ---------------------------------------------------------------------------
// Null visual layer: lets a Document be constructed and mutated with no renderer.
// The browser uses Three.js here; headless modeling (MCP / CLI / tests) does not
// render, so every member is a no-op. Node-change subscriptions live in the real
// visual, so context methods are never actually called in the headless flow.
// ---------------------------------------------------------------------------

class NullVisualContext implements IVisualContext {
    get shapeCount() {
        return 0;
    }
    addVisualObject(): void {}
    removeVisualObject(): void {}
    boundingBoxIntersectFilter(): never[] {
        return [];
    }
    addNode(): void {}
    removeNode(): void {}
    getVisual() {
        return undefined;
    }
    getNode() {
        return undefined;
    }
    redrawNode(): void {}
    setVisible(): void {}
    visuals(): never[] {
        return [];
    }
    displayMesh(): number {
        return 0;
    }
    removeMesh(): void {}
    displayInstancedMesh(): number {
        return 0;
    }
    displayLineSegments(): number {
        return 0;
    }
    setPosition(): void {}
    setInstanceMatrix(): void {}
    dispose(): void {}
}

class NullVisual implements IVisual {
    readonly context: IVisualContext = new NullVisualContext();
    // These surfaces are never exercised headlessly; keep them as inert stubs.
    readonly highlighter = {} as IVisual["highlighter"];
    readonly meshExporter = {} as IVisual["meshExporter"];
    viewHandler = {} as IVisual["viewHandler"];
    defaultEventHandler = {} as IVisual["defaultEventHandler"];
    eventHandler = {} as IVisual["eventHandler"];

    constructor(readonly document: IDocument) {}

    update(): void {}
    createView(): IView {
        return {} as IView;
    }
    dispose(): void {}
}

export class NullVisualFactory implements IVisualFactory {
    readonly kernelName = "null";
    create(document: IDocument): IVisual {
        return new NullVisual(document);
    }
}

// ---------------------------------------------------------------------------
// In-memory storage: enough for save()/open() round-trips without IndexedDB.
// ---------------------------------------------------------------------------

class InMemoryStorage implements IStorage {
    private readonly tables = new Map<string, Map<string, unknown>>();

    private table(database: string, table: string) {
        const key = `${database}/${table}`;
        let map = this.tables.get(key);
        if (!map) {
            map = new Map();
            this.tables.set(key, map);
        }
        return map;
    }

    async createDBIfNeeded(): Promise<void> {}

    async get(database: string, table: string, id: string): Promise<any> {
        return this.table(database, table).get(id);
    }

    async put(database: string, table: string, id: string, value: any): Promise<boolean> {
        this.table(database, table).set(id, value);
        return true;
    }

    async delete(database: string, table: string, id: string): Promise<boolean> {
        return this.table(database, table).delete(id);
    }

    async page(database: string, table: string): Promise<any[]> {
        return [...this.table(database, table).values()];
    }
}

// ---------------------------------------------------------------------------
// Headless application: a real IApplication that shares the production geometry
// core (@chili3d/wasm ShapeFactory) but has no window, no UI, no singleton. This
// is the official entry point for running CAD command logic outside the browser.
// ---------------------------------------------------------------------------

export class HeadlessApplication extends Observable implements IApplication {
    readonly dataExchange = {} as IDataExchange;
    readonly visualFactory: IVisualFactory = new NullVisualFactory();
    readonly shapeFactory: IShapeFactory = new ShapeFactory();
    readonly services: IService[] = [];
    readonly storage: IStorage = new InMemoryStorage();
    readonly views = new ObservableCollection<IView>();
    readonly documents = new Set<IDocument>();
    readonly pluginManager = {} as IPluginManager;
    executingCommand: ICommand | undefined = undefined;
    activeView: IView | undefined = undefined;

    async newDocument(name: string): Promise<IDocument> {
        // `this as IApplication`: the class implements IApplication, but TS's
        // polymorphic-`this` + `keyof this` generic on IPropertyChanged blocks the
        // direct assignment. The cast is sound (members are all present).
        const document = new Document(this as IApplication, name);
        // Mirror the browser app: a document needs at least one material, or nodes
        // default to materialId "" and the renderer throws "Material not found".
        // Created before any node so GeometryNode picks materials[0] by default.
        document.modelManager.materials.push(
            new Material({ document, name: "LightGray", color: 0xdedede }),
            new Material({ document, name: "DeepGray", color: 0x898989 }),
        );
        return document;
    }

    async openDocument(id: string): Promise<IDocument | undefined> {
        return Document.open(this as IApplication, id);
    }

    async loadDocument(data: Serialized): Promise<IDocument | undefined> {
        return Document.load(this as IApplication, data);
    }

    async loadFileFromUrl(): Promise<void> {
        throw new Error("loadFileFromUrl is not supported in the headless application");
    }
}

/**
 * Initialize the OCCT WebAssembly kernel for Node. Pass the raw bytes of
 * `chili-wasm.wasm` (Node has no fetch for it). Call once before modeling.
 */
export async function initHeadlessWasm(wasmBinary: BufferSource): Promise<void> {
    await initWasm({ wasmBinary });
}

/** Create a headless application wired to the real OCCT geometry core. */
export function createHeadlessApplication(): HeadlessApplication {
    return new HeadlessApplication();
}
