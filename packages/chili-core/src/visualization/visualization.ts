// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Plane } from "../math";
import { IEventHandler } from "./eventHandler";
import { ISelection } from "./selection";
import { IView } from "./view";
import { IVisualizationContext } from "./visualizationContext";

export interface IVisualization {
    get context(): IVisualizationContext;
    get selection(): ISelection;
    get viewHandler(): IEventHandler;
    get eventHandler(): IEventHandler;
    set eventHandler(value: IEventHandler);
    createView(name: string, container: HTMLElement, workplane: Plane): IView;
}
