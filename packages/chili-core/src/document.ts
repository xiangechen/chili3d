// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { History, IDisposable, IPropertyChanged } from "./base";
import { INode, INodeLinkedList } from "./model/node";
import { ISelection } from "./selection";
import { IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: INodeLinkedList;
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly rootNode: INodeLinkedList;
    addNode(...nodes: INode[]): void;
    save(): void;
}
