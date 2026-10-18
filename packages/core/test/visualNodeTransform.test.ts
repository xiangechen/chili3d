// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BoundingBox, cloneForCopyNode, type I18nKeys, Id, Matrix4, VisualNode } from "../src";
import { TestDocument } from "../test-utils";

class TestVisualNode extends VisualNode {
    display(): I18nKeys {
        return "common.name";
    }

    boundingBox(): BoundingBox | undefined {
        return undefined;
    }

    override clone(): this {
        const clone = new TestVisualNode(this.document, this.name, Id.generate());
        clone.transform = this.transform;
        return clone as this;
    }
}

/** Overrides the copy hook without opting into the instance model. */
class OverrideOnlyVisualNode extends TestVisualNode {
    override cloneForCopy(_transform: Matrix4): this {
        return this.clone();
    }

    override clone(): this {
        return new OverrideOnlyVisualNode(this.document, this.name, Id.generate()) as this;
    }
}

class RefusingVisualNode extends TestVisualNode {
    override applyTransform(_transform: Matrix4): boolean {
        return false;
    }

    override clone(): this {
        const clone = new RefusingVisualNode(this.document, this.name, Id.generate());
        clone.transform = this.transform;
        return clone as this;
    }
}

describe("VisualNode transform hooks", () => {
    let node: TestVisualNode;

    beforeEach(() => {
        node = new TestVisualNode(new TestDocument() as any, "hook test", Id.generate());
    });

    test("a plain node applies a world-space increment directly", () => {
        expect(node.transformMode).toBe("direct");

        const applied = node.applyTransform(Matrix4.fromTranslation(10, 20, 30));

        expect(applied).toBe(true);
        expect(node.transform.equals(Matrix4.fromTranslation(10, 20, 30))).toBe(true);
    });

    test("increments compose in application order", () => {
        node.applyTransform(Matrix4.fromTranslation(10, 0, 0));
        node.applyTransform(Matrix4.fromTranslation(0, 5, 0));

        expect(node.transform.equals(Matrix4.fromTranslation(10, 5, 0))).toBe(true);
    });

    test("an explicit cloneForCopy override wins even without copiesAsInstance", () => {
        const override = new OverrideOnlyVisualNode(new TestDocument() as any, "override", Id.generate());
        expect(override.copiesAsInstance).toBe(false);

        const copy = cloneForCopyNode(override, Matrix4.fromTranslation(5, 0, 0));

        expect(copy).toBeInstanceOf(OverrideOnlyVisualNode);
        // The override's own result (no placement), not the generic transformed clone.
        expect(copy.transform.equals(Matrix4.identity())).toBe(true);
    });

    test("cloneTransformed falls back to a direct placement when the hook refuses", () => {
        const refusing = new RefusingVisualNode(new TestDocument() as any, "refusing", Id.generate());
        refusing.transform = Matrix4.fromTranslation(1, 0, 0);

        const clone = refusing.cloneTransformed(Matrix4.fromTranslation(0, 2, 0));

        expect(clone.transform.equals(Matrix4.fromTranslation(1, 2, 0))).toBe(true);
    });

    test("cloneTransformed carries the increment onto an independent copy", () => {
        node.applyTransform(Matrix4.fromTranslation(3, 0, 0));

        const clone = node.cloneTransformed(Matrix4.fromTranslation(0, 4, 0));

        expect(clone).not.toBe(node);
        expect(clone.transform.equals(Matrix4.fromTranslation(3, 4, 0))).toBe(true);
        expect(node.transform.equals(Matrix4.fromTranslation(3, 0, 0))).toBe(true);
    });
});
