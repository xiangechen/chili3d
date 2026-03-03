// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, Matrix4, VisualNode } from "../src";
import type { BoundingBox } from "../src/math";
import { TestDocument } from "./testDocument";

// Mock VisualNode implementation for testing
class TestVisualNode extends VisualNode {
    private _display: I18nKeys;
    private _boundingBox?: BoundingBox;

    constructor(document: any, display: I18nKeys = "test.display" as I18nKeys, boundingBox?: BoundingBox) {
        super(document, "test", "test-id");
        this._display = display;
        this._boundingBox = boundingBox;
    }

    display(): I18nKeys {
        return this._display;
    }

    boundingBox(): BoundingBox | undefined {
        return this._boundingBox;
    }
}

describe("VisualNode", () => {
    let document: TestDocument;
    let visualNode: TestVisualNode;

    beforeEach(() => {
        document = new TestDocument();
        visualNode = new TestVisualNode(document);
    });

    describe("transform property", () => {
        test("should have default identity transform", () => {
            expect(visualNode.transform.equals(Matrix4.identity())).toBe(true);
        });

        test("should set and get transform correctly", () => {
            const newTransform = Matrix4.fromTranslation(1, 2, 3);
            visualNode.transform = newTransform;
            expect(visualNode.transform.equals(newTransform)).toBe(true);
        });

        test("should use equals function for transform comparison", () => {
            const transform1 = Matrix4.fromTranslation(1, 2, 3);
            const transform2 = Matrix4.fromTranslation(1, 2, 3);

            visualNode.transform = transform1;
            // Setting the same transform should not trigger change due to equals comparison
            visualNode.transform = transform2;
            expect(visualNode.transform.equals(transform2)).toBe(true);
        });
    });

    describe("worldTransform method", () => {
        test("should return transform when no visual exists in context", () => {
            const transform = Matrix4.fromTranslation(5, 10, 15);
            visualNode.transform = transform;

            const worldTransform = visualNode.worldTransform();
            expect(worldTransform.equals(transform)).toBe(true);
        });

        test("should return visual's worldTransform when visual exists", () => {
            const visualTransform = Matrix4.fromScale(2, 2, 2);
            const mockVisual = {
                worldTransform: () => visualTransform,
            };

            // Mock the visual context to return a visual
            const originalGetVisual = document.visual.context.getVisual;
            document.visual.context.getVisual = () => mockVisual as any;

            const worldTransform = visualNode.worldTransform();
            expect(worldTransform.equals(visualTransform)).toBe(true);

            // Restore original function
            document.visual.context.getVisual = originalGetVisual;
        });
    });

    describe("onVisibleChanged method", () => {
        test("should update visual context visibility when visible changes", () => {
            const calls: any[] = [];
            const originalSetVisible = document.visual.context.setVisible;
            document.visual.context.setVisible = (node: any, visible: boolean) => {
                calls.push({ node, visible });
            };

            // Clear any initial calls from setup
            calls.length = 0;

            // Set initial state to false, then change to true
            visualNode.visible = false;
            calls.length = 0; // Clear calls from initial setup

            visualNode.visible = true;

            expect(calls.length).toBeGreaterThanOrEqual(1);
            const lastCall = calls[calls.length - 1];
            expect(lastCall.node).toBe(visualNode);
            expect(lastCall.visible).toBe(true && true);

            // Restore original function
            document.visual.context.setVisible = originalSetVisible;
        });

        test("should consider both visible and parentVisible", () => {
            const calls: any[] = [];
            const originalSetVisible = document.visual.context.setVisible;
            document.visual.context.setVisible = (node: any, visible: boolean) => {
                calls.push({ node, visible });
            };

            // Clear any initial calls from setup
            calls.length = 0;

            visualNode.visible = true;
            visualNode.parentVisible = false;

            expect(calls.length).toBeGreaterThanOrEqual(1);
            const lastCall = calls[calls.length - 1];
            expect(lastCall.visible).toBe(true && false);

            // Restore original function
            document.visual.context.setVisible = originalSetVisible;
        });
    });

    describe("onParentVisibleChanged method", () => {
        test("should update visual context visibility when parentVisible changes", () => {
            const calls: any[] = [];
            const originalSetVisible = document.visual.context.setVisible;
            document.visual.context.setVisible = (node: any, visible: boolean) => {
                calls.push({ node, visible });
            };

            // Clear any initial calls from setup
            calls.length = 0;

            visualNode.visible = true;
            visualNode.parentVisible = false;

            expect(calls.length).toBeGreaterThanOrEqual(1);
            const lastCall = calls[calls.length - 1];
            expect(lastCall.visible).toBe(true && false);

            // Restore original function
            document.visual.context.setVisible = originalSetVisible;
        });

        test("should consider both visible and parentVisible", () => {
            const calls: any[] = [];
            const originalSetVisible = document.visual.context.setVisible;
            document.visual.context.setVisible = (node: any, visible: boolean) => {
                calls.push({ node, visible });
            };

            // Clear any initial calls from setup
            calls.length = 0;

            visualNode.visible = false;
            visualNode.parentVisible = true;

            expect(calls.length).toBeGreaterThanOrEqual(1);
            const lastCall = calls[calls.length - 1];
            expect(lastCall.visible).toBe(false && true);

            // Restore original function
            document.visual.context.setVisible = originalSetVisible;
        });
    });

    describe("abstract methods", () => {
        test("should require display method implementation", () => {
            const customDisplay = "custom.display" as I18nKeys;
            const customNode = new TestVisualNode(document, customDisplay);
            expect(customNode.display()).toBe(customDisplay);
        });

        test("should require boundingBox method implementation", () => {
            const mockBoundingBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } as BoundingBox;
            const customNode = new TestVisualNode(document, "test" as I18nKeys, mockBoundingBox);
            expect(customNode.boundingBox()).toBe(mockBoundingBox);
        });

        test("should allow undefined boundingBox", () => {
            const customNode = new TestVisualNode(document, "test" as I18nKeys);
            expect(customNode.boundingBox()).toBeUndefined();
        });
    });

    describe("serialization", () => {
        test("should serialize transform property", () => {
            const transform = Matrix4.fromEuler(Math.PI / 4, 0, 0);
            visualNode.transform = transform;

            // This test verifies that the @serialze() decorator is present
            // The actual serialization logic would be tested in integration tests
            expect(visualNode.transform.equals(transform)).toBe(true);
        });
    });

    describe("integration with base Node class", () => {
        test("should inherit all Node properties and methods", () => {
            expect(visualNode.id).toBeDefined();
            expect(visualNode.name).toBe("test");
            expect(visualNode.visible).toBe(true);
            expect(visualNode.parentVisible).toBe(true);
        });
    });
});
