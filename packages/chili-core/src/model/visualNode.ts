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
        this.setProperty("transform", value, undefined, {
            equals: (left, right) => left.equals(right),
        });
    }

    worldTransform(): Matrix4 {
        const visual = this.document.visual.context.getVisual(this);
        if (visual) {
            return visual.worldTransform();
        }
        return this.transform;
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    abstract boundingBox(): BoundingBox | undefined;
}
