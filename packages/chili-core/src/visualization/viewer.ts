// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType } from "./cursorType";
import { IDocument } from "../document";
import { IView } from "./view";
import { IDisposable } from "../disposable";
import { Plane } from "../math";

export interface IViewer extends IDisposable {
    readonly document: IDocument;
    views(): IView[];
    redraw(): void;
    update(): void;
    setCursor(cursor: CursorType): void;
    createView(dom: HTMLElement, name: string, workplane: Plane): IView;
}
