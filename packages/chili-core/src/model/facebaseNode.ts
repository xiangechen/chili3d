// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Property } from "../property";
import { Serializer } from "../serialize";
import { ParameterShapeNode } from "./shapeNode";

export abstract class FacebaseNode extends ParameterShapeNode {
    @Serializer.serialze()
    @Property.define("option.command.isFace")
    get isFace() {
        return this.getPrivateValue("isFace", false);
    }
    set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
