// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "../math";
import { serializable, serialze } from "../serialize";
import { FolderNode } from "./folderNode";

@serializable(["document", "name", "id"])
export class GroupNode extends FolderNode {
    @serialze()
    get transform(): Matrix4 {
        return this.getPrivateValue("transform", Matrix4.identity());
    }
    set transform(value: Matrix4) {
        this.setProperty("transform", value, undefined, {
            equals: (left, right) => left.equals(right),
        });
    }
}
