// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, IDisposable } from "./foundation";
import { I18nKeys } from "./i18n";
import { INode, VisualNode } from "./model";
import { INodeFilter, IShapeFilter } from "./selectionFilter";
import { ShapeType } from "./shape";
import { CursorType, IEventHandler, VisualShapeData } from "./visual";

export interface ISelection extends IDisposable {
    pickShape(prompt: I18nKeys, controller: AsyncController, multiMode: boolean): Promise<VisualShapeData[]>;
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
