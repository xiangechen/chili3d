// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShapeFactory } from "chili-geo";
import { IVisualFactory } from "chili-vis";
import { ICommand } from "./command";
import { IDocument } from "./document";
import { IStorage } from "./foundation";
import { Serialized } from "./serialize";
import { IService } from "./service";

export interface IApplication {
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    executingCommand: ICommand | undefined;
    activeDocument: IDocument | undefined;
    newDocument(name: string): Promise<IDocument>;
    openDocument(id: string): Promise<IDocument | undefined>;
    loadDocument(data: Serialized): Promise<IDocument>;
}
