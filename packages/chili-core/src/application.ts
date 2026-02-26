// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ICommand } from "./command";
import type { IDataExchange } from "./dataExchange";
import type { IDocument } from "./document";
import type { IStorage, ObservableCollection } from "./foundation";
import type { Serialized } from "./serialize";
import type { IService } from "./service";
import type { IShapeFactory } from "./shape";
import type { IWindow } from "./ui/window";
import type { IView, IVisualFactory } from "./visual";

export interface IApplication {
    readonly mainWindow?: IWindow;
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly views: ObservableCollection<IView>;
    readonly documents: Set<IDocument>;
    executingCommand: ICommand | undefined;
    activeView: IView | undefined;
    newDocument(name: string): Promise<IDocument>;
    openDocument(id: string): Promise<IDocument | undefined>;
    loadDocument(data: Serialized): Promise<IDocument | undefined>;
    loadFileFromUrl(url: string): Promise<void>;
}

let currentApplication: IApplication | undefined;
export function getCurrentApplication() {
    return currentApplication;
}

export function setCurrentApplication(app: IApplication): void {
    currentApplication = app;
}
