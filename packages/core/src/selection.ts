// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { AsyncController, IDisposable, Signal } from "./foundation";
import type { I18nKeys } from "./i18n";
import type { INode, VisualNode } from "./model";
import type { INodeFilter, IShapeFilter } from "./selectionFilter";
import type { ShapeType } from "./shape";
import type { CursorType, IEventHandler, VisualShapeData, VisualState } from "./visual";

export interface PickShapeOptions {
    shapeType?: ShapeType;
    shapeFilter?: IShapeFilter;
    nodeFilter?: INodeFilter;
    multi?: boolean;
    selectedState?: VisualState;
    highlightState?: VisualState;
    /** In multi mode, finish the pick automatically once this returns true. */
    canFinish?: (selected: VisualShapeData[]) => boolean;
    /**
     * Reorders what the pointer detects; the pick highlights and returns the first entry,
     * so moving a shape to the front is how a caller expresses a preference between
     * shapes that overlap in the viewport.
     */
    sortDetected?: (detected: VisualShapeData[]) => VisualShapeData[];
}

export interface PickNodeOptions {
    nodeFilter?: INodeFilter;
    multi?: boolean;
}

export interface ISelection extends IDisposable {
    readonly onNodeChanged: Signal<(selected: INode[]) => void>;
    readonly onShapeChanged: Signal<(selected: VisualShapeData[]) => void>;

    setSelectedNodes(nodes: INode[], toggle: boolean): number;
    setSelectedShapes(shapes: VisualShapeData[], selectedState: VisualState, toggle: boolean): number;
    getSelectedNodes(): INode[];
    getSelectedNodeLength(): number;
    getSelectedShapes(): VisualShapeData[];
    getSelectedVisualNodes(): VisualNode[];
    clearSelection(): void;
}

export interface IPicker {
    pickShape(
        prompt: I18nKeys,
        controller: AsyncController,
        options?: PickShapeOptions,
    ): Promise<VisualShapeData[]>;

    pickNode(prompt: I18nKeys, controller: AsyncController, options?: PickNodeOptions): Promise<VisualNode[]>;

    pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType,
    ): Promise<void>;
}
