// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, Plane } from "chili-shared";
import { CursorType, IView } from "chili-vis";
import { IDocument } from "./document";

export interface IViewer extends IDisposable {
    readonly document: IDocument;
    views(): IView[];
    redraw(): void;
    update(): void;
    setCursor(cursor: CursorType): void;
    createView(dom: HTMLElement, name: string, workplane: Plane): IView;
}
