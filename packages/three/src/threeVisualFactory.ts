// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IEventHandler, IVisual, IVisualFactory } from "@chili3d/core";
import { ThreeVisual } from "./threeVisual";

export class ThreeVisulFactory implements IVisualFactory {
    readonly kernelName = "three";

    constructor(readonly createEventHandler: (document: IDocument) => IEventHandler) { }

    create(document: IDocument): IVisual {
        return new ThreeVisual(document, this.createEventHandler(document));
    }
}
