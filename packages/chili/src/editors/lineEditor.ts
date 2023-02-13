// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEditor, IView } from "chili-core";
import { LineBody } from "../bodys";

export class LineEditor implements IEditor {
    constructor(readonly entity: LineBody) {}
    onMouseMove(view: IView, e: MouseEvent): void {
        view.document.visualization.selection;
        throw new Error("Method not implemented.");
    }
    onMouseDown(view: IView, e: MouseEvent): void {
        throw new Error("Method not implemented.");
    }
    onMouseUp(view: IView, e: MouseEvent): void {
        throw new Error("Method not implemented.");
    }

    deactive(): boolean {
        throw new Error("Method not implemented.");
    }

    active(): boolean {
        return true;
    }
}
