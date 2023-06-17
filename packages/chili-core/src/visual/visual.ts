// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "../base";
import { IDocument } from "../document";
import { IEventHandler } from "./eventHandler";
import { IViewer } from "./viewer";
import { IVisualContext } from "./visualContext";

export interface IVisual extends IDisposable {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;
    eventHandler: IEventHandler;
    resetEventHandler(): void;
}
