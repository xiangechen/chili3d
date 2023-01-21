// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, IPropertyChanged } from "chili-shared";
import { ModelObject } from "./model";
import { ISelection } from "./selection";
import { IViewer } from "./viewer";
import { IVisualization } from "./visualization";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly id: string;
    readonly viewer: IViewer;
    readonly selection: ISelection;
    get modelCount(): number;
    addModel(...models: ModelObject[]): void;
    get visualization(): IVisualization;
    getModel(id: string): ModelObject | undefined;
    getModels(...ids: string[]): ModelObject[];
    removeModel(...models: ModelObject[]): void;
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
