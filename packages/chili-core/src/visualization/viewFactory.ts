// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { Plane } from "../math";
import { IView } from "./view";

export interface IViewFactory {
    createView(document: IDocument, name: string, workplane: Plane, dom: HTMLElement): IView;
}
