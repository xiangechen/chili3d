// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    IApplication,
    ICommand,
    IDataExchange,
    IDocument,
    IPluginManager,
    IShapeProvider,
    IStorage,
    IView,
    IVisualFactory,
} from "@chili3d/core";
import { ObservableCollection } from "@chili3d/core";
import { createMockVisual } from "./mockVisual";

export interface MockApplicationOverrides {
    storage?: Partial<IStorage>;
    visualFactory?: Partial<IVisualFactory>;
    shapeProvider?: Partial<IShapeProvider>;
    dataExchange?: Partial<IDataExchange>;
    services?: any[];
    pluginManager?: Partial<IPluginManager>;
}

/**
 * Create a configurable mock IApplication for unit tests.
 * The returned object implements the full IApplication interface with sensible defaults.
 */
export function createMockApplication(overrides: MockApplicationOverrides = {}): IApplication {
    const mockDocuments = new Set<IDocument>();
    const mockViews = new ObservableCollection<IView>();

    const app: IApplication = {
        storage: {
            createDBIfNeeded: async () => {},
            get: async () => undefined,
            put: async () => true,
            delete: async () => true,
            page: async () => [],
            ...overrides.storage,
        } as IStorage,
        visualFactory: {
            kernelName: "mock",
            create: (doc: IDocument) => ({
                ...createMockVisual(doc),
                resetEventHandler: () => {},
                isExcutingHandler: () => false,
            }),
            ...overrides.visualFactory,
        } as unknown as IVisualFactory,
        shapeProvider: {
            factory: {} as any,
            converter: {} as any,
            ...overrides.shapeProvider,
        } as IShapeProvider,
        dataExchange: {
            import: async () => {},
            export: async () => new Blob(),
            importFormats: () => [] as string[],
            exportFormats: () => [] as string[],
            ...overrides.dataExchange,
        } as IDataExchange,
        services: overrides.services ?? [],
        pluginManager: {
            plugins: new Map(),
            manifests: new Map(),
            shouldRevokes: new Map(),
            loadFromFile: async () => {},
            loadFromUrl: async () => {},
            ...overrides.pluginManager,
        } as unknown as IPluginManager,
        views: mockViews,
        documents: mockDocuments,
        activeView: undefined,
        lastCommand: undefined,
        executingCommand: undefined,
        dispose: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        onPropertyChanged: () => {},
        newDocument: async () => ({}) as IDocument,
        openDocument: async () => undefined,
        loadDocument: async () => undefined,
        loadFileFromUrl: async () => {},
    };

    return app;
}

/**
 * Create a mock ICommand for testing.
 */
export function createMockCommand(overrides: Partial<ICommand> = {}): ICommand {
    return {
        execute: async () => {},
        ...overrides,
    };
}

/**
 * Create a mock cancelable command for testing.
 */
export function createMockCancelableCommand(
    overrides: Partial<{ execute: () => Promise<void>; cancel: () => Promise<void> }> = {},
): ICommand {
    return {
        execute: overrides.execute ?? (async () => {}),
        cancel: overrides.cancel ?? (async () => {}),
    } as any;
}
