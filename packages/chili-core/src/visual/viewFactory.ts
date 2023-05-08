// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Plane } from "../math";
import { IView } from "./view";

export interface IViewFactory {
    create(name: string, workplane: Plane, dom: HTMLElement): IView;
}
