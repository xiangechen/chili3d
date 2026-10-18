// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";
import { type BoundingBox, Matrix4 } from "../math";
import { serialize } from "../serialize";
import { Node } from "./node";

/**
 * How a node's placement is applied:
 *
 * - `direct` — the node carries its own `transform` (a plain shape, a component instance).
 * - `feature` — the node owns a parametric definition; a move is recorded as a feature so it
 *   survives a rebuild (`ParametricBodyNode`).
 * - `none` — the node is an input defined in world space and must not be moved (`SketchNode`).
 */
export type TransformMode = "direct" | "feature" | "none";

export abstract class VisualNode extends Node {
    abstract display(): I18nKeys;

    @serialize()
    get transform(): Matrix4 {
        return this.getPrivateValue("transform", Matrix4.identity());
    }
    set transform(value: Matrix4) {
        this.setProperty("transform", value, undefined, {
            equals: (left, right) => left.equals(right),
        });
    }

    /** See {@link TransformMode}. */
    get transformMode(): TransformMode {
        return "direct";
    }

    /**
     * Applies a world-space incremental transform. Returns false when the node refuses it
     * (a sketch, whose geometry is defined in world space).
     */
    applyTransform(transform: Matrix4): boolean {
        const current = (this as { transform?: Matrix4 }).transform ?? Matrix4.identity();
        this.transform = current.multiply(transform);
        return true;
    }

    /**
     * Clones the node and applies the given world-space incremental transform to the
     * copy. A node that refuses the hook (a sketch) still gets the placement written
     * directly, so the copy is not silently left behind.
     */
    cloneTransformed(transform: Matrix4): this {
        const clone = this.clone();
        if (!clone.applyTransform(transform)) {
            const current = (clone as { transform?: Matrix4 }).transform ?? Matrix4.identity();
            clone.transform = current.multiply(transform);
        }
        return clone;
    }

    /** True when copying this node yields an instance that still reads this node's geometry. */
    get copiesAsInstance(): boolean {
        return false;
    }

    /**
     * Makes the copy a copy-and-place operation creates (Move with clone, Array). Plain
     * nodes clone independently; a parametric body returns an instance of itself, so the
     * copy follows the source's sketch and features instead of duplicating them.
     */
    cloneForCopy(transform: Matrix4): VisualNode {
        return this.cloneTransformed(transform);
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
