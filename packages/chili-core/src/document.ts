// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, IHistory, IPropertyChanged } from "./base";
import { ICollectionNode, INode, INodeCollection } from "./model/node";
import { IVisualization } from "./visualization";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: INode;
    readonly id: string;
    readonly history: IHistory;
    readonly visualization: IVisualization;
    readonly nodes: INodeCollection;
    readonly rootNode: ICollectionNode;
}
