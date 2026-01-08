// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    ParameterShapeNode,
    type Result,
    serializable,
    serialze,
} from "chili-core";

@serializable(["document", "edges"])
export class WireNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.wire";
    }

    @serialze()
    get edges(): IEdge[] {
        return this.getPrivateValue("edges");
    }
    set edges(values: IEdge[]) {
        this.setPropertyEmitShapeChanged("edges", values);
    }

    constructor(document: IDocument, edges: IEdge[]) {
        super(document);
        this.setPrivateValue("edges", edges);
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.wire(this.edges);
    }
}
