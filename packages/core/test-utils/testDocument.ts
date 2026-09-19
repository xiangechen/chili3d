// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Act,
    History,
    type IApplication,
    type IDocument,
    InternalClassName,
    type IPicker,
    type ISelection,
    type IVariableTable,
    type IView,
    type IVisual,
    ModelManager,
    ObservableCollection,
    type PropertyChangedHandler,
    type Serialized,
    VariableTable,
} from "../src";
import { createMockVisual } from "./mockVisual";

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
    variables: IVariableTable;
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
        this.variables = new VariableTable(this);
    }
}
