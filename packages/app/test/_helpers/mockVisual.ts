// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    IDocument,
    IEventHandler,
    IHighlighter,
    IMeshExporter,
    IView,
    IVisual,
    IVisualContext,
    IVisualObject,
    VisualShapeData,
} from "@chili3d/core";

export interface MockVisualOverrides {
    highlighter?: Partial<IHighlighter>;
    meshExporter?: Partial<IMeshExporter>;
    eventHandler?: Partial<IEventHandler>;
    viewHandler?: Partial<IEventHandler>;
    context?: Partial<IVisualContext>;
}

/**
 * Create a mock IVisual for unit tests.
 */
export function createMockVisual(document: IDocument, overrides: MockVisualOverrides = {}): IVisual {
    const highlighter: IHighlighter = {
        addState: () => {},
        removeState: () => {},
        clear: () => {},
        getState: () => undefined,
        resetState: () => {},
        highlightMesh: () => 0,
        removeHighlightMesh: () => {},
        ...overrides.highlighter,
    };

    const context: IVisualContext = {
        dispose: () => {},
        removeNode: () => {},
        redrawNode: () => {},
        getVisual: () => undefined,
        setVisible: () => {},
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
