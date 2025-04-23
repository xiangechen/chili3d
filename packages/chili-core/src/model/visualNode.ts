// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18nKeys } from "../i18n";
import { BoundingBox, Matrix4 } from "../math";
import { Serializer } from "../serialize";
import { Node } from "./node";

export abstract class VisualNode extends Node {
    abstract display(): I18nKeys;

    @Serializer.serialze()
    get transform(): Matrix4 {
        return this.getPrivateValue("transform", Matrix4.identity());
    }
    set transform(value: Matrix4) {
        this.setProperty(
            "transform",
            value,
            (_p, oldMatrix) => {
                this.onTransformChanged(value, oldMatrix);
            },
            {
                equals: (left, right) => left.equals(right),
            },
        );
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    abstract boundingBox(): BoundingBox | undefined;

    protected onTransformChanged(newMatrix: Matrix4, oldMatrix: Matrix4): void {}
}
