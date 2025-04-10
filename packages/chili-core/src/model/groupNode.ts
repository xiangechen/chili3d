// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Matrix4 } from "../math";
import { Serializer } from "../serialize";
import { FolderNode } from "./folderNode";

@Serializer.register(["document", "name", "id"])
export class GroupNode extends FolderNode {
    @Serializer.serialze()
    get transform(): Matrix4 {
        return this.getPrivateValue("transform", Matrix4.identity());
    }
    set transform(value: Matrix4) {
        this.setProperty("transform", value, undefined, {
            equals: (left, right) => left.equals(right),
        });
    }
}
