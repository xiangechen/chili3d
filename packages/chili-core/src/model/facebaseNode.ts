// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Property } from "../property";
import { Serializer } from "../serialize";
import { ParameterShapeNode } from "./shapeNode";

export abstract class FacebaseNode extends ParameterShapeNode {
    @Serializer.serialze()
    @Property.define("command.faceable.isFace")
    get isFace() {
        return this.getPrivateValue("isFace", false);
    }
    set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
