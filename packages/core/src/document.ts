// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "./application";
import type { History, IDisposable, IPropertyChanged, ObservableCollection } from "./foundation";
import type { ModelManager } from "./modelManager";
import type { IVariableTable } from "./parameters/variableTable";
import type { IPicker, ISelection } from "./selection";
import type { Serialized } from "./serialize";
import type { Act, IVisual } from "./visual";

export const DOCUMENT_FILE_EXTENSION = ".cd";
export const PLUGIN_FILE_EXTENSION = ".chiliplugin";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly selection: ISelection;
    readonly picker: IPicker;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly application: IApplication;
    readonly modelManager: ModelManager;
    /** Document-wide parameters shared by every body and sketch (see `variableTable.ts`). */
    readonly variables: IVariableTable;
    name: string;
    acts: ObservableCollection<Act>;
    userData?: Record<string, unknown>;
    save(): Promise<void>;
    close(): Promise<void>;
    serialize(): Serialized;
}
