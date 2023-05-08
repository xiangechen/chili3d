// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, IHistory, IPropertyChanged } from "./base";
import { ICollectionNode, INode, INodeCollection } from "./model/node";
import { IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: INode;
    readonly id: string;
    readonly history: IHistory;
    readonly visual: IVisual;
    readonly nodes: INodeCollection;
    readonly rootNode: ICollectionNode;
}
