// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
        this.setProperty(
            "transform",
            value,
            undefined,
            {
                equals: (left, right) => left.equals(right),
            },
        );
    }
}