// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShapeConverter } from "./shapeConverter";
import type { IShapeFactory } from "./shapeFactory";

export interface IShapeProvider {
    readonly factory: IShapeFactory;
    readonly converter: IShapeConverter;
}
