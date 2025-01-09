// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IDisposable } from "../foundation";
import { Plane } from "../math";
import { IEventHandler } from "./eventHandler";
import { IHighlighter } from "./highlighter";
import { IView } from "./view";
import { IVisualContext } from "./visualContext";

export interface IVisual extends IDisposable {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly highlighter: IHighlighter;
    update(): void;
    eventHandler: IEventHandler;
    resetEventHandler(): void;
    isExcutingHandler(): boolean;
    createView(name: string, workplane: Plane): IView;
}
