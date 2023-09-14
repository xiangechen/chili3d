// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "./application";
import { History, IDisposable, IPropertyChanged } from "./base";
import { INode, INodeLinkedList } from "./model/node";
import { SelectionManager } from "./selectionManager";
import { IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable {
    name: string;
    currentNode?: INodeLinkedList;
    readonly selection: SelectionManager;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly rootNode: INodeLinkedList;
    readonly application: IApplication;
    addNode(...nodes: INode[]): void;
    save(): Promise<void>;
    close(): Promise<void>;
}
