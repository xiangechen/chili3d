// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, History, IPropertyChanged } from "./base";
import { ILinkListNode } from "./model/node";
import { ISelection } from "./selection";
import { IView, IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: ILinkListNode;
    // activeView: IView | undefined;
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly rootNode: ILinkListNode;
}
