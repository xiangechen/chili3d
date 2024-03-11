// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IDisposable } from "../foundation";
import { IEventHandler } from "./eventHandler";
import { IHighlighter } from "./highlighter";
import { ITextGenerator } from "./textGenerator";
import { IViewer } from "./viewer";
import { IVisualContext } from "./visualContext";

export interface IVisual extends IDisposable {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly viewHandler: IEventHandler;
    readonly viewer: IViewer;
    readonly highlighter: IHighlighter;
    readonly textGenerator: ITextGenerator;
    eventHandler: IEventHandler;
    resetEventHandler(): void;
    isExcutingHandler(): boolean;
}
