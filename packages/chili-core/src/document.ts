// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, History, IPropertyChanged } from "./base";
import { ICollectionNode, INode, INodeCollection } from "./model/node";
import { ISelection } from "./selection";
import { IView, IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: INode;
    // activeView: IView | undefined;
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly nodes: INodeCollection;
    readonly rootNode: ICollectionNode;
}
