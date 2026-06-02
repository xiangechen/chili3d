// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ICommand } from "./command";
import type { IDataExchange } from "./dataExchange";
import type { IDocument } from "./document";
import type { IPropertyChanged, IStorage, ObservableCollection } from "./foundation";
import type { IPluginManager } from "./plugin";
import type { Serialized } from "./serialize";
import type { IService } from "./service";
import type { IShapeFactory } from "./shape";
import type { IWindow } from "./ui/window";
import type { IView, IVisualFactory } from "./visual";

export interface IApplication extends IPropertyChanged {
    readonly mainWindow?: IWindow;
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly views: ObservableCollection<IView>;
    readonly documents: Set<IDocument>;
    readonly pluginManager: IPluginManager;
    executingCommand: ICommand | undefined;
    activeView: IView | undefined;
    newDocument(name: string): Promise<IDocument>;
    openDocument(id: string): Promise<IDocument | undefined>;
    loadDocument(data: Serialized): Promise<IDocument | undefined>;
    loadFileFromUrl(url: string): Promise<void>;
}

let currentApplication: IApplication;
export function getCurrentApplication() {
    if (!currentApplication) {
        throw new Error(
            "No application instance is set. Please create an instance of Application before accessing it.",
        );
    }
    return currentApplication;
}

export function setCurrentApplication(app: IApplication): void {
    if (currentApplication) {
        throw new Error("An application instance is already set. Multiple instances are not allowed.");
    }
    currentApplication = app;
}

declare global {
    var shapeFactory: IShapeFactory;
    var activeView: IView | undefined;
    var activeDocument: IDocument | undefined;
}

Object.defineProperty(globalThis, "shapeFactory", {
    get() {
        const app = getCurrentApplication();
        return app.shapeFactory;
    },
});

Object.defineProperty(globalThis, "activeView", {
    get() {
        const app = getCurrentApplication();
        return app.activeView;
    },
});

Object.defineProperty(globalThis, "activeDocument", {
    get() {
        const app = getCurrentApplication();
        return app.activeView?.document;
    },
});
