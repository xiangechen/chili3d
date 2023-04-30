// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "../base";
import { IDocument } from "../document";
import { CursorType } from "./cursorType";
import { IView } from "./view";

export interface IViewer extends IDisposable {
    readonly document: IDocument;
    addView(view: IView): void;
    views(): readonly IView[];
    redraw(): void;
    update(): void;
    setCursor(cursor: CursorType): void;
}
