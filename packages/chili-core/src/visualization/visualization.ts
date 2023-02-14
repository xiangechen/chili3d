// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler } from "./eventHandler";
import { ISelection } from "./selection";
import { IViewFactory } from "./viewFactory";
import { IVisualizationContext } from "./visualizationContext";

export interface IVisualization {
    get context(): IVisualizationContext;
    get selection(): ISelection;
    get viewHandler(): IEventHandler;
    eventHandler: IEventHandler;
    get viewFactory(): IViewFactory;
}
