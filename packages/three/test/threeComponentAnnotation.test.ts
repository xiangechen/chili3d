// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Component,
    ComponentNode,
    type Contour2D,
    DefaultFont,
    DimensionAnnotation,
    type FontOutline,
    forgetOutline,
    Matrix4,
    NodeSelectionHandler,
    rememberOutline,
    XYZ,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type Object3D, Raycaster } from "three";
import { ThreeVisual } from "../src/threeVisual";
import type { ThreeComponentObject } from "../src/threeVisualObject";
import { TestView } from "./testView";

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** A square-glyph font the annotation text pipeline can draw without any fetching. */
function fakeOutline(): FontOutline {
    const square: Contour2D = {
        start: { x: 0, y: 0 },
        segments: [
            { kind: "line", to: { x: 0, y: 700 } },
            { kind: "line", to: { x: 500, y: 700 } },
            { kind: "line", to: { x: 500, y: 0 } },
            { kind: "line", to: { x: 0, y: 0 } },
        ],
    };
    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance: 250,
        glyph: () => ({ advance: 500, contours: [structuredClone(square)] }),
    };
}

function createSceneWithComponentAnnotation() {
    const doc = new TestDocument();
    const visual = new ThreeVisual(doc, new NodeSelectionHandler(doc, true));
    doc.visual = visual;
    const view = new TestView(doc, visual.context);
    // The camera matrices are stale until the first render/update; sync them so
    // worldToScreen, raycasting and SelectionBox all use the same camera pose.
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);
    visual.context.scene.updateMatrixWorld(true);

    const anno = new DimensionAnnotation({
        document: doc,
        annotationType: "dimension",
        name: "dim",
        startPoint: new XYZ({ x: -5, y: 20, z: 0 }),
        endPoint: new XYZ({ x: -15, y: 20, z: 0 }),
        textPoint: new XYZ({ x: -10, y: 25, z: 0 }),
    });
    // The member transform shifts the dimension line to world (-8..2, 25, 0).
    anno.transform = Matrix4.fromTranslation(7, 0, 0);
    const component = new Component({ name: "comp", nodes: [anno] });
    const componentNode = new ComponentNode({
        document: doc,
        name: "comp",
        componentId: component.id,
        insert: XYZ.zero,
    });
    (componentNode as unknown as { _component: Component })._component = component;
    visual.context.addNode([componentNode]);

    const componentVisual = visual.context.getVisual(componentNode) as unknown as ThreeComponentObject;
    expect(componentVisual).toBeDefined();
    expect(componentVisual.annotations).toHaveLength(1);
    const annotationVisual = componentVisual.annotations[0];
    return { doc, visual, view, anno, componentNode, componentVisual, annotationVisual };
}

describe("ThreeComponentObject member annotations — picking", () => {
    let restoreFont: () => void;

    beforeEach(() => {
        rememberOutline(DefaultFont.family, DefaultFont.url, fakeOutline());
        restoreFont = () => forgetOutline(DefaultFont.family, DefaultFont.url);
    });
    afterEach(() => {
        restoreFont();
    });

    test("component member annotations appear in visuals() and resolve their node", async () => {
        const { visual, anno, componentVisual, annotationVisual } = createSceneWithComponentAnnotation();
        await flush();

        const visuals = visual.context.visuals();
        expect(visuals).toContain(componentVisual);
        expect(visuals).toContain(annotationVisual);
        // the maps behind NodeSelectionHandler.select and selection highlighting
        expect(visual.context.getNode(annotationVisual)).toBe(anno);
        expect(visual.context.getVisual(anno)).toBe(annotationVisual);
    });

    test("rectangle selection finds a component member annotation", async () => {
        const { view, annotationVisual } = createSceneWithComponentAnnotation();
        await flush();

        // A rect overlapping the annotation's bounds but holding neither the grip
        // dots' center nor the batch geometry's center: only the annotation pass
        // over visuals() can find it — the SelectionBox pass cannot.
        const corner1 = view.worldToScreen(new XYZ({ x: -8.5, y: 23, z: 0 }));
        const corner2 = view.worldToScreen(new XYZ({ x: -5, y: 27, z: 0 }));
        expect(view.detectVisualRect(corner1.x, corner1.y, corner2.x, corner2.y)).toContain(annotationVisual);

        const far1 = view.worldToScreen(new XYZ({ x: 40, y: 40, z: 0 }));
        const far2 = view.worldToScreen(new XYZ({ x: 50, y: 50, z: 0 }));
        expect(view.detectVisualRect(far1.x, far1.y, far2.x, far2.y)).not.toContain(annotationVisual);
    });

    test("point picking raycasts the component's annotation batch and resolves the annotation", async () => {
        const { view, annotationVisual } = createSceneWithComponentAnnotation();
        await flush();
        const batch = annotationVisual.batch;
        expect(batch).toBeDefined();

        const spy = rs.spyOn(Raycaster.prototype, "intersectObjects");
        try {
            // the middle of the dimension line, world (-3, 25, 0)
            const p = view.worldToScreen(new XYZ({ x: -3, y: 25, z: 0 }));
            const detected = view.detectVisual(p.x, p.y);

            expect(detected).toContain(annotationVisual);
            expect(spy).toHaveBeenCalled();
            const candidates = new Set(spy.mock.calls.flatMap((call) => call[0] as Object3D[]));
            for (const pickObject of batch!.pickObjects()) {
                expect(pickObject.visible).toBe(true);
                expect(candidates.has(pickObject)).toBe(true);
            }
        } finally {
            spy.mockRestore();
        }
    });

    test("hiding the component hides its member annotations from picking", async () => {
        const { view, componentNode, annotationVisual } = createSceneWithComponentAnnotation();
        await flush();

        const p = view.worldToScreen(new XYZ({ x: -3, y: 25, z: 0 }));
        const corner1 = view.worldToScreen(new XYZ({ x: -8.5, y: 23, z: 0 }));
        const corner2 = view.worldToScreen(new XYZ({ x: -5, y: 27, z: 0 }));
        expect(view.detectVisual(p.x, p.y)).toContain(annotationVisual);
        expect(view.detectVisualRect(corner1.x, corner1.y, corner2.x, corner2.y)).toContain(annotationVisual);

        componentNode.visible = false;
        expect(annotationVisual.visible).toBe(false);
        expect(view.detectVisual(p.x, p.y)).not.toContain(annotationVisual);
        expect(view.detectVisualRect(corner1.x, corner1.y, corner2.x, corner2.y)).not.toContain(
            annotationVisual,
        );

        componentNode.visible = true;
        expect(annotationVisual.visible).toBe(true);
        expect(view.detectVisualRect(corner1.x, corner1.y, corner2.x, corner2.y)).toContain(annotationVisual);
    });

    test("removing the component unregisters its member annotations", async () => {
        const { visual, anno, componentNode, componentVisual, annotationVisual } =
            createSceneWithComponentAnnotation();
        await flush();

        visual.context.removeNode([componentNode]);

        expect(visual.context.getNode(annotationVisual)).toBeUndefined();
        expect(visual.context.getVisual(anno)).toBeUndefined();
        expect(visual.context.visuals()).not.toContain(annotationVisual);
        expect(visual.context.visuals()).not.toContain(componentVisual);
    });
});
