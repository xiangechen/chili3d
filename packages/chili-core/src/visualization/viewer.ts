// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "../disposable";
import { IDocument } from "../document";
import { Plane } from "../math";
import { CursorType } from "./cursorType";
import { IView } from "./view";

export interface IViewer extends IDisposable {
    readonly document: IDocument;
    views(): IView[];
    redraw(): void;
    update(): void;
    setCursor(cursor: CursorType): void;
    createView(dom: HTMLElement, name: string, workplane: Plane): IView;
}
