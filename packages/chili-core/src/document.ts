// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "./disposable";
import { IHistory } from "./history";
import { IModelManager } from "./model";
import { IPropertyChanged } from "./observer";
import { IVisualization } from "./visualization";
import { ISelection } from "./visualization/selection";
import { IViewer } from "./visualization/viewer";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly id: string;
    readonly viewer: IViewer;
    readonly selection: ISelection;
    readonly history: IHistory;
    readonly visualization: IVisualization;
    readonly models: IModelManager;
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
