// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, IHistory, IPropertyChanged } from "./base";
import { FlolderEntry } from "./folder";
import { IModelManager } from "./model";
import { IVisualization } from "./visualization";
import { IViewer } from "./visualization/viewer";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly id: string;
    readonly viewer: IViewer;
    readonly history: IHistory;
    readonly visualization: IVisualization;
    readonly models: IModelManager;
    readonly folder: FlolderEntry;
}
