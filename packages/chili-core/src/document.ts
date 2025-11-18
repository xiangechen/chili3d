// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "./application";
import type {
    History,
    IDisposable,
    INodeChangedObserver,
    IPropertyChanged,
    NodeRecord,
    ObservableCollection,
} from "./foundation";
import type { Material } from "./material";
import type { Component, INode, INodeLinkedList } from "./model";
import type { ISelection } from "./selection";
import type { ISerialize, Serialized } from "./serialize";
import type { Act, IVisual } from "./visual";

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
