// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import type { ClassicPreset, GetSchemes, NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { AreaExtra } from "./editor";
import type { VPI18nKeys } from "./i18n/keys";

export type Schemes = GetSchemes<
    ClassicPreset.Node,
    ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;

export type ToolCommand = {
    display: VPI18nKeys;
    icon: string;
    node: new (editor: INodeEditor) => ClassicPreset.Node;
};

export type ToolGroup = {
    groupName: VPI18nKeys;
    items: ToolCommand[];
};

export interface INodeEditor {
    readonly document: IDocument;
    readonly editor: NodeEditor<Schemes>;
    readonly socket: ClassicPreset.Socket;
    readonly area: AreaPlugin<Schemes, AreaExtra>;
    process(): void;
    addNode(node: new (editor: INodeEditor) => ClassicPreset.Node): Promise<void>;
}
