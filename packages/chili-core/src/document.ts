// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "./application";
import type { History, IDisposable, IPropertyChanged, ObservableCollection } from "./foundation";
import type { ModelManager } from "./modelManager";
import type { ISelection } from "./selection";
import type { ISerialize, Serialized } from "./serialize";
import type { Act, IVisual } from "./visual";

export const DOCUMENT_FILE_EXTENSION = ".cd";

export interface IDocument extends IPropertyChanged, IDisposable, ISerialize {
    readonly selection: ISelection;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly application: IApplication;
    readonly modelManager: ModelManager;
    name: string;
    acts: ObservableCollection<Act>;
    save(): Promise<void>;
    close(): Promise<void>;
    serialize(): Serialized;
}
