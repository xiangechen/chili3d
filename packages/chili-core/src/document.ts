// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IApplication } from "./application";
import {
    History,
    IDisposable,
    INodeChangedObserver,
    IPropertyChanged,
    NodeRecord,
    ObservableCollection,
} from "./foundation";
import { Material } from "./material";
import { Component, INode, INodeLinkedList } from "./model";
import { ISelection } from "./selection";
import { ISerialize, Serialized } from "./serialize";
import { Act, IVisual } from "./visual";

export const DOCUMENT_FILE_EXTENSION = ".cd";

export interface IDocument extends IPropertyChanged, IDisposable, ISerialize {
    name: string;
    currentNode?: INodeLinkedList;
    rootNode: INodeLinkedList;
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly application: IApplication;
    readonly components: Array<Component>;
    materials: ObservableCollection<Material>;
    acts: ObservableCollection<Act>;
    addNode(...nodes: INode[]): void;
    addNodeObserver(observer: INodeChangedObserver): void;
    removeNodeObserver(observer: INodeChangedObserver): void;
    notifyNodeChanged(records: NodeRecord[]): void;
    save(): Promise<void>;
    close(): Promise<void>;
    serialize(): Serialized;
}
