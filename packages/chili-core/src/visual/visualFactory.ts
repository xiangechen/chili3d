// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { IVisual } from "./visual";

export interface IVisualFactory {
    readonly kernelName: string;
    create(document: IDocument): IVisual;
}
