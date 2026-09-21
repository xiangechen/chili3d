// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IEventHandler, IView } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { AmbientLight, AxesHelper, Scene } from "three";
import { ThreeMeshExporter } from "../src/meshExporter";
import { ThreeHighlighter } from "../src/threeHighlighter";
import { ThreeVisual } from "../src/threeVisual";
import { ThreeVisualContext } from "../src/threeVisualContext";

class TestEventHandler implements IEventHandler {
    isEnabled = true;
    pointerMove(_view: IView, _event: PointerEvent): void {}
    pointerDown(_view: IView, _event: PointerEvent): void {}
    pointerUp(_view: IView, _event: PointerEvent): void {}
    keyDown(_view: IView, _event: KeyboardEvent): void {}
    dispose(): void {}
}

describe("ThreeVisual", () => {
    const createdVisuals: ThreeVisual[] = [];

    afterEach(() => {
        for (const v of createdVisuals) {
            if (v.scene.children.length > 0) {
                v.dispose();
            }
        }
        createdVisuals.length = 0;
    });

    function createTestVisual() {
        const doc = new TestDocument();
        const eventHandler = new TestEventHandler();
        const visual = new ThreeVisual(doc, eventHandler);
        createdVisuals.push(visual);
        return { doc, visual, eventHandler };
    }

    test("initScene creates a scene with the axes helper and no flat fill light", () => {
        const { visual } = createTestVisual();
        expect(visual.scene).toBeInstanceOf(Scene);
        expect(visual.scene.children.some((x) => x instanceof AxesHelper)).toBe(true);
        // The fill light is the image-based environment the context builds, not an AmbientLight
        expect(visual.scene.children.some((x) => x instanceof AmbientLight)).toBe(false);
    });

    test("context, highlighter, meshExporter are initialized", () => {
        const { visual } = createTestVisual();
        expect(visual.context).toBeInstanceOf(ThreeVisualContext);
        expect(visual.highlighter).toBeInstanceOf(ThreeHighlighter);
        expect(visual.meshExporter).toBeInstanceOf(ThreeMeshExporter);
    });

    test("defaultEventHandler and viewHandler are initialized", () => {
        const { visual } = createTestVisual();
        expect(typeof visual.defaultEventHandler.pointerMove).toBe("function");
        expect(typeof visual.viewHandler.pointerMove).toBe("function");
        expect(visual.eventHandler).toBe(visual.defaultEventHandler);
    });

    test("eventHandler can be swapped", () => {
        const { visual } = createTestVisual();
        const newHandler = new TestEventHandler();
        visual.eventHandler = newHandler;
        expect(visual.eventHandler).toBe(newHandler);
    });

    test("dispose clears scene children", () => {
        const { visual } = createTestVisual();
        const scene = visual.scene;
        expect(scene.children.length).toBeGreaterThan(0);

        visual.dispose();
        expect(scene.children.length).toBe(0);
    });
});
