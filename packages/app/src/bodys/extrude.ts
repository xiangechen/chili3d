// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    GeometryUtils,
    type I18nKeys,
    type IDocument,
    type IFace,
    type IShape,
    ParameterShapeNode,
    property,
    type Result,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";

export interface PrismOptions {
    document: IDocument;
    section: IShape;
    length: number;
}

@serializable()
export class ExtrudeNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.extrude";
    }

    @serialize()
    get section(): IShape {
        return this.getPrivateValue("section");
    }
    set section(value: IShape) {
        this.setPropertyEmitShapeChanged("section", value);
    }

    @serialize()
    @property("common.length")
    get length(): number {
        return this.getPrivateValue("length");
    }
    set length(value: number) {
        this.setPropertyEmitShapeChanged("length", value);
    }

    constructor(options: PrismOptions) {
        super({ document: options.document });
        this.setPrivateValue("section", options.section);
        this.setPrivateValue("length", options.length);
    }

    override generateShape(): Result<IShape> {
        const normal = GeometryUtils.normal(this.section as any);
        const vec = normal.multiply(this.length);
        if (this.section.shapeType === ShapeTypes.face) {
            const sur = (this.section as IFace).surface();
            if (!sur.isPlanar()) {
                return shapeFactory.makeThickSolidBySimple(this.section, this.length);
            }
        }
        return shapeFactory.prism(this.section, vec);
    }
}
