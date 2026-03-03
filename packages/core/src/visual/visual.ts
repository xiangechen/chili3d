// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { IDisposable } from "../foundation";
import type { Plane } from "../math";
import type { IEventHandler } from "./eventHandler";
import type { IHighlighter } from "./highlighter";
import type { IMeshExporter } from "./meshExporter";
import type { IView } from "./view";
import type { IVisualContext } from "./visualContext";

export interface IVisual extends IDisposable {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly viewHandler: IEventHandler;
    readonly highlighter: IHighlighter;
    readonly meshExporter: IMeshExporter;
    update(): void;
    eventHandler: IEventHandler;
    resetEventHandler(): void;
    isExcutingHandler(): boolean;
    createView(name: string, workplane: Plane): IView;
}
