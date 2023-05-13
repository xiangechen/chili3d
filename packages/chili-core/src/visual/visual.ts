// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { ShapeType } from "../geometry";
import { Plane } from "../math";
import { ISelection } from "../selection";
import { IEventHandler } from "./eventHandler";
import { IView } from "./view";
import { IViewer } from "./viewer";
import { IVisualContext } from "./visualContext";

export interface IVisual {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;
    eventHandler: IEventHandler;
    selectionType: ShapeType;
    resetEventHandler(): void;
}
