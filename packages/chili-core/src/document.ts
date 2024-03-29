// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "./application";
import { History, IDisposable, IPropertyChanged, ObservableCollection } from "./foundation";
import { Material } from "./material";
import { INode, INodeLinkedList } from "./model/node";
import { ISelection } from "./selection";
import { ISerialize, Serialized } from "./serialize";
import { IVisual } from "./visual";

export interface IDocument extends IPropertyChanged, IDisposable, ISerialize {
    name: string;
    currentNode?: INodeLinkedList;
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly rootNode: INodeLinkedList;
    readonly application: IApplication;
    materials: ObservableCollection<Material>;
    addNode(...nodes: INode[]): void;
    save(): Promise<void>;
    close(): Promise<void>;
    serialize(): Serialized;
}
