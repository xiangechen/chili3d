// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShapeConverter, IShapeFactory, IShapeProvider } from "@chili3d/core";
import { OccShapeConverter } from "./converter";
import { ShapeFactory } from "./factory";

export class OccShapeProvider implements IShapeProvider {
    readonly factory: IShapeFactory;
    readonly converter: IShapeConverter;

    constructor() {
        this.factory = new ShapeFactory();
        this.converter = new OccShapeConverter();
    }
}
