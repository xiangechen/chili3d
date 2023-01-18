// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IModel, IModelGroup, IModelObject } from "chili-geo";
import { IDisposable, IPropertyChanged, Plane } from "chili-shared";
import { CursorType, IVisualization, IVisualizationShape, ISelection, IView } from "chili-vis";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly id: string;
    readonly viewer: IViewer;
    readonly selection: ISelection;
    get modelCount(): number;
    addModel(...models: IModelObject[]): void;
    get visualization(): IVisualization;
    getModel(id: string): IModelObject | undefined;
    getModels(...ids: string[]): IModelObject[];
    removeModel(...models: IModelObject[]): void;
    undo(): void;
    redo(): void;
}

export namespace IDocument {
    let documentMap = new Map<string, IDocument>();

    export function get(id: string): IDocument | undefined {
        return documentMap.get(id);
    }

    export function set(document: IDocument) {
        return documentMap.set(document.id, document);
    }
}

export interface IViewer extends IDisposable {
    readonly document: IDocument;
    views(): IView[];
    redraw(): void;
    update(): void;
    setCursor(cursor: CursorType): void;
    createView(dom: HTMLElement, name: string, workplane: Plane): IView;
}
