// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { AsyncController, IDisposable } from "./foundation";
import { I18nKeys } from "./i18n";
import { INode, VisualNode } from "./model";
import { INodeFilter, IShapeFilter } from "./selectionFilter";
import { ShapeType } from "./shape";
import { CursorType, IEventHandler, VisualShapeData, VisualState } from "./visual";

export interface ISelection extends IDisposable {
    pickShape(
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean,
        selectedState?: VisualState,
    ): Promise<VisualShapeData[]>;
    pickNode(prompt: I18nKeys, controller: AsyncController, multiMode: boolean): Promise<VisualNode[]>;
    pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType,
    ): Promise<void>;
    shapeType: ShapeType;
    shapeFilter?: IShapeFilter;
    nodeFilter?: INodeFilter;
    setSelection(nodes: INode[], toggle: boolean): number;
    clearSelection(): void;
    getSelectedNodes(): INode[];
}
