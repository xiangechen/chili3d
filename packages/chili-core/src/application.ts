// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICommand } from "./command";
import { IDocument } from "./document";
import { IStorage, ObservableCollection } from "./foundation";
import { IShapeFactory } from "./geometry";
import { Serialized } from "./serialize";
import { IService } from "./service";
import { IWindow } from "./ui/window";
import { IView, IVisualFactory } from "./visual";

export interface IApplication {
    readonly mainWindow?: IWindow;
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
}
