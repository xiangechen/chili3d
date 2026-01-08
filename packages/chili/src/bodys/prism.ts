// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    property,
    type Result,
    serializable,
    serialze,
} from "chili-core";
import { GeoUtils } from "chili-geo";

@serializable(["document", "section", "length"])
export class PrismNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.prism";
    }

    @serialze()
    get section(): IShape {
        return this.getPrivateValue("section");
    }
    set section(value: IShape) {
        this.setPropertyEmitShapeChanged("section", value);
    }

    @serialze()
    @property("common.length")
    get length(): number {
        return this.getPrivateValue("length");
    }
    set length(value: number) {
        this.setPropertyEmitShapeChanged("length", value);
    }

    constructor(document: IDocument, face: IShape, length: number) {
        super(document);
        this.setPrivateValue("section", face);
        this.setPrivateValue("length", length);
    }

    override generateShape(): Result<IShape> {
        const normal = GeoUtils.normal(this.section as any);
        const vec = normal.multiply(this.length);
        return this.document.application.shapeFactory.prism(this.section, vec);
    }
}
