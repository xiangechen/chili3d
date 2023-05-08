// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { ISelection } from "../selection";
import { IEventHandler } from "./eventHandler";
import { IViewFactory } from "./viewFactory";
import { IViewer } from "./viewer";
import { IVisualContext } from "./visualContext";

export interface IVisual {
    get document(): IDocument;
    get context(): IVisualContext;
    get viewHandler(): IEventHandler;
    readonly selection: ISelection;
    readonly viewer: IViewer;
    eventHandler: IEventHandler;
    get viewFactory(): IViewFactory;
    clearEventHandler(): void;
}
