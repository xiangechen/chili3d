// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, IVisual, IVisualFactory } from "chili-core";

import { ThreeVisual } from "./threeVisual";

export class ThreeVisulFactory implements IVisualFactory {
    readonly kernelName = "three";
    create(document: IDocument): IVisual {
        return new ThreeVisual(document);
    }
}
