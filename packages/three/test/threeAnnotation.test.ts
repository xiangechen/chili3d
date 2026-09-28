// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    angularDimensionLayout,
    BoundingBox,
    Component,
    ComponentNode,
    type Contour2D,
    DefaultFont,
    DIMENSION_TEXT_HEIGHT,
    DimensionAnnotation,
    type DimensionLayout,
    defaultFontService,
    diameterDimensionLayout,
    dimensionLayoutScale,
    type FontOutline,
    forgetOutline,
    type IApplication,
    type INode,
    type IView,
    linearDimensionLayout,
    Matrix4,
    ObservableCollection,
    type RefSegmentAnnotation,
    radialDimensionLayout,
    rememberOutline,
    Signal,
    XYZ,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    type InterleavedBufferAttribute,
    Layers,
    Mesh,
    MeshBasicMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    Points,
    Vector2,
    Vector3,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { AnnotationBatch } from "../src/annotationBatch";
import { Constants } from "../src/constants";
import {
    type ThreeAnnotation,
    ThreeDimensionAnnotation,
    ThreeRefSegmentAnnotation,
} from "../src/threeAnnotation";
import { ThreeComponentObject } from "../src/threeVisualObject";
import { createTestComponentNode, createTestContext } from "./mocks";

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
        glyph: (codePoint) =>
            codePoint === 32
                ? { advance: 250, contours: [] }
                : // a per-character advance, so a changed text really re-lays out
                  { advance: 400 + (codePoint % 5) * 40, contours: [structuredClone(square)] },
    };
}

/** Serves `fakeOutline` to the annotation text pipeline, and takes it away again. */
function stubAnnotationFont() {
    rememberOutline(DefaultFont.family, DefaultFont.url, fakeOutline());
    return () => forgetOutline(DefaultFont.family, DefaultFont.url);
}

function createRefSegment(): RefSegmentAnnotation {
    const startPoint = new XYZ({ x: 0, y: 0, z: 0 });
    const endPoint = new XYZ({ x: 10, y: 10, z: 10 });
    return {
        startPoint,
        endPoint,
        transform: Matrix4.identity(),
        visible: true,
        parentVisible: true,
        color: 0xffff00,
        boundingBox: () => BoundingBox.fromPoints([startPoint, endPoint]),
        onPropertyChanged: rs.fn(),
        removePropertyChanged: rs.fn(),
    } as unknown as RefSegmentAnnotation;
}

/** The property-change listener a visual registered on its mock annotation. */
function changeListener(annotation: RefSegmentAnnotation) {
    const onPropertyChanged = annotation.onPropertyChanged as unknown as ReturnType<typeof rs.fn>;
    expect(onPropertyChanged).toHaveBeenCalledTimes(1);
    return onPropertyChanged.mock.calls[0][0] as (property: string) => void;
}

function batchParts(visual: ThreeAnnotation): { batch: AnnotationBatch; lines: LineSegments2; texts: Mesh } {
    const batch = visual.batch;
    expect(batch).toBeDefined();
    const [lines, texts] = batch!.pickObjects();
    expect(lines).toBeInstanceOf(LineSegments2);
    expect(texts).toBeInstanceOf(Mesh);
    return { batch: batch!, lines: lines as LineSegments2, texts: texts as Mesh };
}

function linePositions(lines: LineSegments2): Float32Array {
    const attribute = lines.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute;
    expect(attribute).toBeDefined();
    return attribute.data.array as Float32Array;
}

function expectPositionsClose(actual: ArrayLike<number>, expected: readonly number[]) {
    expect(actual.length).toBe(expected.length);
    expected.forEach((value, index) => {
        expect(actual[index]).toBeCloseTo(value, 5);
    });
}

function createMockView(camera: PerspectiveCamera | OrthographicCamera) {
    const update = rs.fn();
    const onPropertyChanged = rs.fn();
    const removePropertyChanged = rs.fn();
    const toXYZ = (v: { x: number; y: number; z: number }) => new XYZ(v.x, v.y, v.z);
    const view = {
        isClosed: false,
        update,
        cameraController: {
            cameraPosition: toXYZ(camera.position),
            cameraType: camera instanceof PerspectiveCamera ? "perspective" : "orthographic",
            onPropertyChanged,
            removePropertyChanged,
        },
        direction: () => toXYZ(camera.getWorldDirection(new Vector3())),
        up: () => toXYZ(camera.up),
    } as unknown as IView;
    return { view, update, onPropertyChanged, removePropertyChanged };
}

describe("ThreeRefSegmentAnnotation", () => {
    test("creates annotation object", () => {
        const { context } = createTestContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createRefSegment());

        expect(annotation.annotation.startPoint.x).toBe(0);
        expect(annotation.annotation.endPoint.x).toBe(10);
        expect(annotation.locked).toBe(false);
        expect(annotation.transform.equals(Matrix4.identity())).toBe(true);
        expect(annotation.worldTransform().equals(Matrix4.identity())).toBe(true);
    });

    test("writes its segment into the parent's batch once added", async () => {
        const { context } = createTestContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createRefSegment());
        expect(annotation.batch).toBeUndefined();

        context.visualShapes.add(annotation);
        const { lines } = batchParts(annotation);
        await flush();

        expect(Array.from(linePositions(lines))).toEqual([0, 0, 0, 10, 10, 10]);
    });

    test("highlight and unhighlight switch the batch color", () => {
        const { context } = createTestContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createRefSegment());

        expect(annotation.batchColor).toBe(0xffff00);
        annotation.highlight();
        expect(annotation.batchColor).toBe(0x00ffff);
        annotation.unhighlight();
        expect(annotation.batchColor).toBe(0xffff00);
    });

    test("bakes the transform into the batch geometry", async () => {
        const { context } = createTestContext();
        const model = createRefSegment();
        const annotation = new ThreeRefSegmentAnnotation(context, model);
        context.visualShapes.add(annotation);
        const { lines } = batchParts(annotation);
        await flush();

        model.transform = Matrix4.fromTranslation(1, 0, 0);
        changeListener(model)("transform");
        await flush();

        expect(annotation.transform.equals(Matrix4.fromTranslation(1, 0, 0))).toBe(true);
        expect(Array.from(linePositions(lines))).toEqual([1, 0, 0, 11, 10, 10]);
    });

    test("rebuilds the segment when an endpoint changes", async () => {
        const { context } = createTestContext();
        const model = createRefSegment();
        const annotation = new ThreeRefSegmentAnnotation(context, model);
        context.visualShapes.add(annotation);
        const { lines } = batchParts(annotation);
        await flush();

        model.startPoint = new XYZ({ x: 1, y: 2, z: 3 });
        changeListener(model)("startPoint");
        await flush();

        expect(Array.from(linePositions(lines))).toEqual([1, 2, 3, 10, 10, 10]);
    });

    test("an invisible annotation contributes nothing to the batch", async () => {
        const { context } = createTestContext();
        const model = createRefSegment();
        const annotation = new ThreeRefSegmentAnnotation(context, model);
        context.visualShapes.add(annotation);
        const { lines } = batchParts(annotation);
        await flush();
        expect(lines.visible).toBe(true);

        (model as { visible: boolean }).visible = false;
        changeListener(model)("visible");
        await flush();
        expect(lines.visible).toBe(false);
    });

    test("boundingBoxIntersectFilter skips annotations instead of throwing", async () => {
        const { context } = createTestContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createRefSegment());
        context.visualShapes.add(annotation);
        await flush();

        const box = { min: new XYZ(-100, -100, -100), max: new XYZ(100, 100, 100) };
        expect(context.boundingBoxIntersectFilter(box)).toEqual([]);
    });

    test("dispose unsubscribes and unregisters from the batch", async () => {
        const { context } = createTestContext();
        const model = createRefSegment();
        const annotation = new ThreeRefSegmentAnnotation(context, model);
        context.visualShapes.add(annotation);
        const batch = annotation.batch;
        await flush();

        annotation.dispose();
        await flush();
        await flush();

        expect(model.removePropertyChanged).toHaveBeenCalledTimes(1);
        expect(annotation.batch).toBeUndefined();
        expect(batch!.parent).toBeNull();
    });

    test("boundingBox comes from the annotation", () => {
        const { context } = createTestContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createRefSegment());

        const box = annotation.boundingBox();
        expect(box).toBeDefined();
        expect(box!.min.x).toBe(0);
        expect(box!.max.x).toBe(10);
        expect(box!.max.z).toBe(10);
    });
});

describe("ThreeDimensionAnnotation", () => {
    const VIEWPORT = new Vector2(800, 600);
    let restoreFont: () => void;

    beforeEach(() => {
        restoreFont = stubAnnotationFont();
    });
    afterEach(() => {
        restoreFont();
    });

    function createDimension() {
        return new DimensionAnnotation({
            document: new TestDocument(),
            annotationType: "dimension",
            name: "dim",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(5, 8, 0),
        });
    }

    /** A dimension whose document reports selection through a real signal. */
    function createSelectableDimension() {
        const onNodeChanged = new Signal<(selected: INode[]) => void>();
        let selected: INode[] = [];
        const document = new TestDocument({
            selection: {
                onNodeChanged,
                getSelectedNodes: () => selected,
            } as unknown as TestDocument["selection"],
        });
        const annotation = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dim",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(5, 8, 0),
        });
        return {
            annotation,
            select: (nodes: INode[]) => {
                selected = nodes;
                onNodeChanged.emit(nodes);
            },
        };
    }

    async function createVisual(annotation: DimensionAnnotation) {
        const { context, visual: ivisual } = createTestContext();
        const update = rs.fn();
        ivisual.update = update;
        const visual = new ThreeDimensionAnnotation(context, annotation);
        context.visualShapes.add(visual);
        await flush();
        return { context, update, visual, ...batchParts(visual) };
    }

    function createContextWithView(document: unknown) {
        const { context } = createTestContext();
        const update = rs.fn();
        (context as { visual: unknown }).visual = { update, document };
        return { context, update };
    }

    /** An IView whose camera controller and direction mirror the given three camera. */
    function handlePositions(handles: Points): number[] {
        return [...(handles.geometry.getAttribute("position").array as Float32Array)];
    }

    function textPositions(texts: Mesh): Float32Array {
        return texts.geometry.getAttribute("position").array as Float32Array;
    }

    function expectLayout(annotation: DimensionAnnotation): DimensionLayout {
        const layout = linearDimensionLayout(
            annotation.startPoint,
            annotation.endPoint,
            annotation.textPoint,
            dimensionLayoutScale(annotation.textHeight),
        );
        expect(layout).toBeDefined();
        if (layout === undefined) throw new Error("layout should exist for these points");
        return layout;
    }

    test("builds the layout geometry and the text in the batch", async () => {
        const annotation = createDimension();
        const { lines, texts, visual } = await createVisual(annotation);

        const layout = expectLayout(annotation);
        expectPositionsClose(linePositions(lines), layout.segments);
        // the solid arrowheads lead the triangle mesh, then the five square
        // glyphs of "10.00" at two triangles each
        const positions = textPositions(texts);
        expectPositionsClose(positions.slice(0, layout.triangles.length), layout.triangles);
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 5 * 2 * 3);
        expect(texts.visible).toBe(true);
        expect(visual.locked).toBe(false);
        expect(visual.transform.equals(Matrix4.identity())).toBe(true);
    });

    test("centers the text on the layout anchor at the annotation's text height", async () => {
        const annotation = createDimension();
        const { texts } = await createVisual(annotation);

        const layout = expectLayout(annotation);
        const anchor = layout.textPosition;
        // skip the arrowhead triangles leading the mesh
        const positions = textPositions(texts).slice(layout.triangles.length);
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
            minX = Math.min(minX, positions[i]);
            maxX = Math.max(maxX, positions[i]);
            minY = Math.min(minY, positions[i + 1]);
            maxY = Math.max(maxY, positions[i + 1]);
        }
        // x centers the advance box like troika's anchorX, which differs from the
        // ink center by the last glyph's side bearing; y centers the ink exactly
        expect((minX + maxX) / 2).toBeCloseTo(anchor.x, 1);
        expect((minY + maxY) / 2).toBeCloseTo(anchor.y, 4);
        // the fake glyph is 0.7 em tall; one em is the text height in world units
        expect(maxY - minY).toBeCloseTo(0.7 * DIMENSION_TEXT_HEIGHT, 4);
    });

    test("rebuilds the batch when an annotation point changes", async () => {
        const annotation = createDimension();
        const { lines, update } = await createVisual(annotation);
        const before = Array.from(linePositions(lines));

        annotation.startPoint = new XYZ(3, 0, 0);
        await flush();

        expect(update).toHaveBeenCalled();
        expectPositionsClose(linePositions(lines), expectLayout(annotation).segments);
        expect(Array.from(linePositions(lines))).not.toEqual(before);
    });

    test("rescales the whole annotation when the text height changes", async () => {
        const annotation = createDimension();
        const { lines, texts } = await createVisual(annotation);
        const before = Array.from(linePositions(lines));

        annotation.textHeight = 7;
        await flush();

        const layout = expectLayout(annotation);
        expectPositionsClose(linePositions(lines), layout.segments);
        expect(Array.from(linePositions(lines))).not.toEqual(before);
        const ys = Array.from(textPositions(texts).slice(layout.triangles.length)).filter(
            (_, i) => i % 3 === 1,
        );
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.7 * 7, 4);
    });

    test("keeps a fixed world size whatever the camera distance is", async () => {
        const annotation = createDimension();
        const { lines, texts, visual } = await createVisual(annotation);
        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 5000);
        camera.position.set(500, 500, 500);
        camera.lookAt(0, 0, 0);
        visual.updateForView(createMockView(camera).view);
        await flush();

        const layout = expectLayout(annotation);
        expectPositionsClose(linePositions(lines), layout.segments);
        const ys = Array.from(textPositions(texts).slice(layout.triangles.length)).filter(
            (_, i) => i % 3 === 1,
        );
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.7 * DIMENSION_TEXT_HEIGHT, 4);
    });

    test("mirrors the text around its anchor when seen from behind", async () => {
        const annotation = createDimension();
        const { texts, visual } = await createVisual(annotation);
        const anchor = expectLayout(annotation).textPosition;
        const arrowCount = expectLayout(annotation).triangles.length;
        const before = Array.from(textPositions(texts));

        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 2000);
        camera.position.set(5, 20, -100);
        camera.lookAt(0, 0, 0);
        visual.updateForView(createMockView(camera).view);
        await flush();

        const flipped = textPositions(texts);
        expect(Array.from(flipped)).not.toEqual(before);
        // the arrowheads keep their world orientation — only the text flips
        expect(Array.from(flipped.slice(0, arrowCount))).toEqual(before.slice(0, arrowCount));
        // the dimension runs along +X: x mirrors around the anchor, y stays
        for (let i = arrowCount; i < flipped.length; i += 3) {
            expect(flipped[i]).toBeCloseTo(2 * anchor.x - before[i], 4);
            expect(flipped[i + 1]).toBeCloseTo(before[i + 1], 4);
        }
    });

    test("does not rewrite the text while the camera stays on the same side", async () => {
        const annotation = createDimension();
        const { texts, visual } = await createVisual(annotation);
        const before = textPositions(texts);

        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 2000);
        camera.position.set(5, 20, 100);
        camera.lookAt(0, 0, 0);
        visual.updateForView(createMockView(camera).view);
        await flush();

        expect(textPositions(texts)).toBe(before);
    });

    test("bakes the annotation transform into the batch slices", async () => {
        const annotation = createDimension();
        const { lines, visual } = await createVisual(annotation);

        annotation.transform = Matrix4.fromTranslation(5, 0, 0);
        await flush();

        expect(visual.transform.equals(Matrix4.fromTranslation(5, 0, 0))).toBe(true);
        const expected = expectLayout(annotation).segments.map((value, index) =>
            index % 3 === 0 ? value + 5 : value,
        );
        expectPositionsClose(linePositions(lines), expected);
    });

    test("updates the text when the measured value changes", async () => {
        const annotation = createDimension();
        const { texts } = await createVisual(annotation);
        // two arrowhead triangles, then five glyph quads
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 5 * 6);
        const before = Array.from(textPositions(texts));

        annotation.endPoint = new XYZ(20, 0, 0);
        await flush();

        // "20.00" — still five glyphs, but re-laid out around the new midpoint
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 5 * 6);
        expect(Array.from(textPositions(texts))).not.toEqual(before);
    });

    test("shows the text override instead of the measured value", async () => {
        const annotation = createDimension();
        const { texts } = await createVisual(annotation);
        const before = texts.geometry.getAttribute("position").count;

        annotation.textOverride = "Ø<>";
        await flush();

        // "Ø10.00" — one glyph more
        expect(texts.geometry.getAttribute("position").count).toBe(before + 6);
    });

    test("draws the arrowheads before the font arrives, then adds the text on load", async () => {
        restoreFont();
        const annotation = createDimension();
        const { texts } = await createVisual(annotation);
        // no glyphs yet, but the two arrowhead triangles already draw
        expect(texts.visible).toBe(true);
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3);

        restoreFont = stubAnnotationFont();
        const listeners = (defaultFontService as unknown as { _listeners: Set<() => void> })._listeners;
        listeners.forEach((listener) => listener());
        await flush();

        expect(texts.visible).toBe(true);
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 5 * 6);
    });

    test("highlight and unhighlight recolor the batch slices", async () => {
        const annotation = createDimension();
        const { texts, visual } = await createVisual(annotation);

        visual.highlight();
        await flush();
        let colors = texts.geometry.getAttribute("color");
        expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([0, 1, 1]);

        visual.unhighlight();
        await flush();
        colors = texts.geometry.getAttribute("color");
        expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 1, 0]);
    });

    test("contributes nothing while the points coincide", async () => {
        const annotation = createDimension();
        const { lines, texts } = await createVisual(annotation);

        annotation.startPoint = new XYZ(10, 0, 0);
        await flush();
        expect(lines.visible).toBe(false);
        expect(texts.visible).toBe(false);

        annotation.startPoint = new XYZ(0, 0, 0);
        await flush();
        expect(lines.visible).toBe(true);
        expect(texts.visible).toBe(true);
        // two extension lines and the dimension line; the arrowheads are triangles
        expect(linePositions(lines).length).toBe(18);
    });

    test("is visible and pickable in every view mode", async () => {
        const annotation = createDimension();
        const { lines, texts } = await createVisual(annotation);

        const layer = new Layers();
        for (const mode of [Constants.Layers.Default, Constants.Layers.Wireframe, Constants.Layers.Solid]) {
            layer.set(mode);
            expect(lines.layers.test(layer)).toBe(true);
            expect(texts.layers.test(layer)).toBe(true);
        }
    });

    test("supports orthographic cameras", async () => {
        const annotation = createDimension();
        const { lines, visual } = await createVisual(annotation);
        const camera = new OrthographicCamera(-40, 40, 30, -30, 0.1, 2000);
        camera.zoom = 2;
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        visual.updateForView(createMockView(camera).view);
        await flush();

        expectPositionsClose(linePositions(lines), expectLayout(annotation).segments);
    });

    test("subscribes to camera changes of its document's view", async () => {
        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 2000);
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        const { view, update, onPropertyChanged, removePropertyChanged } = createMockView(camera);
        const document = { application: { views: [view] } };
        (view as { document: unknown }).document = document;
        const { context } = createContextWithView(document);
        const visual = new ThreeDimensionAnnotation(context, createDimension());
        context.visualShapes.add(visual);
        await flush();

        expect(onPropertyChanged).toHaveBeenCalledTimes(1);

        update.mockClear();
        const handler = onPropertyChanged.mock.calls[0][0] as () => void;
        handler();
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(update).toHaveBeenCalled();

        visual.dispose();
        expect(removePropertyChanged).toHaveBeenCalledTimes(1);
    });

    test("drops a closed view and subscribes to the next one", async () => {
        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 2000);
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        const views = new ObservableCollection<IView>();
        const document = new TestDocument({ application: { views } as unknown as IApplication });
        const annotation = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dim",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(5, 8, 0),
        });
        const first = createMockView(camera);
        (first.view as { document: unknown }).document = document;
        views.push(first.view);

        const { context } = createContextWithView(document);
        const visual = new ThreeDimensionAnnotation(context, annotation);
        context.visualShapes.add(visual);
        await flush();
        expect(first.onPropertyChanged).toHaveBeenCalledTimes(1);

        (first.view as { isClosed: boolean }).isClosed = true;
        const second = createMockView(camera);
        (second.view as { document: unknown }).document = document;
        views.push(second.view);
        await flush();

        expect(first.removePropertyChanged).toHaveBeenCalledTimes(1);
        expect(second.onPropertyChanged).toHaveBeenCalledTimes(1);
        visual.dispose();
    });

    test("orients the text when the view is registered after the visual is created", async () => {
        const views = new ObservableCollection<IView>();
        const document = new TestDocument({ application: { views } as unknown as IApplication });
        const annotation = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dim",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(5, 8, 0),
        });
        const { context } = createContextWithView(document);
        const visual = new ThreeDimensionAnnotation(context, annotation);
        context.visualShapes.add(visual);
        await flush();
        const { texts } = batchParts(visual);
        const before = Array.from(textPositions(texts));

        // behind the dimension plane: registering the view applies the anti-mirror flip
        const camera = new PerspectiveCamera(50, VIEWPORT.x / VIEWPORT.y, 0.1, 2000);
        camera.position.set(5, 20, -100);
        camera.lookAt(0, 0, 0);
        const { view, update, onPropertyChanged } = createMockView(camera);
        (view as { document: unknown }).document = document;
        views.push(view);
        await flush();

        expect(update).toHaveBeenCalled();
        expect(onPropertyChanged).toHaveBeenCalledTimes(1);
        const flipped = textPositions(texts);
        expect(Array.from(flipped)).not.toEqual(before);
        const anchor = expectLayout(annotation).textPosition;
        // the arrowheads lead the mesh and do not flip; the glyphs mirror around the anchor
        const arrowCount = expectLayout(annotation).triangles.length;
        for (let i = arrowCount; i < flipped.length; i += 3) {
            expect(flipped[i]).toBeCloseTo(2 * anchor.x - before[i], 4);
        }
    });

    test("dispose releases resources and stops reacting to the annotation", async () => {
        const annotation = createDimension();
        const { lines, texts, update, visual } = await createVisual(annotation);
        const batch = visual.batch!;

        visual.dispose();
        await flush();
        await flush();

        expect(batch.parent).toBeNull();
        update.mockClear();
        annotation.startPoint = new XYZ(1, 2, 3);
        await flush();
        expect(update).not.toHaveBeenCalled();
        expect(lines.visible).toBe(false);
        expect(texts.visible).toBe(false);
    });

    test("grip dots stay hidden while the annotation is not selected", async () => {
        const { annotation, select } = createSelectableDimension();
        const { visual } = await createVisual(annotation);
        const [handles] = visual.wholeVisual() as [Points];

        expect(handles).toBeInstanceOf(Points);
        expect(handles.visible).toBe(false);

        select([annotation]);
        expect(handles.visible).toBe(true);
        // one dot at each of start, end and text
        expect(handlePositions(handles)).toEqual([0, 0, 0, 10, 0, 0, 5, 8, 0]);

        select([]);
        expect(handles.visible).toBe(false);
    });

    test("grip dots follow the points when the annotation is rebuilt", async () => {
        const { annotation, select } = createSelectableDimension();
        const { visual } = await createVisual(annotation);
        const [handles] = visual.wholeVisual() as [Points];

        select([annotation]);
        annotation.startPoint = new XYZ(1, 2, 3);
        await flush();
        expect(handlePositions(handles).slice(0, 3)).toEqual([1, 2, 3]);
    });

    test("grip dots hide when the layout degenerates, even while selected", async () => {
        const { annotation, select } = createSelectableDimension();
        const { visual } = await createVisual(annotation);
        const [handles] = visual.wholeVisual() as [Points];

        select([annotation]);
        expect(handles.visible).toBe(true);

        annotation.endPoint = annotation.startPoint;
        await flush();
        expect(handles.visible).toBe(false);
    });

    test("dispose stops reacting to selection changes", async () => {
        const { annotation, select } = createSelectableDimension();
        const { visual } = await createVisual(annotation);
        const [handles] = visual.wholeVisual() as [Points];

        visual.dispose();
        select([annotation]);
        expect(handles.visible).toBe(false);
    });

    test("lays out a radial dimension and prefixes its text", async () => {
        const annotation = new DimensionAnnotation({
            document: new TestDocument(),
            annotationType: "dimension",
            name: "dim",
            dimensionType: "radial",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(20, 3, 0),
        });
        const { lines, texts } = await createVisual(annotation);

        const layout = radialDimensionLayout(
            annotation.startPoint,
            annotation.endPoint,
            annotation.textPoint,
            dimensionLayoutScale(annotation.textHeight),
        );
        expectPositionsClose(linePositions(lines), layout!.segments);
        // "R10.00" — six glyphs at two triangles each, after the one arrowhead
        expect(texts.geometry.getAttribute("position").count).toBe(1 * 3 + 6 * 2 * 3);
    });

    test("lays out a diameter dimension across the center", async () => {
        const annotation = new DimensionAnnotation({
            document: new TestDocument(),
            annotationType: "dimension",
            name: "dim",
            dimensionType: "diameter",
            startPoint: new XYZ(-10, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(14, 2, 0),
        });
        const { lines, texts } = await createVisual(annotation);

        const layout = diameterDimensionLayout(
            annotation.startPoint,
            annotation.endPoint,
            annotation.textPoint,
            dimensionLayoutScale(annotation.textHeight),
        );
        expectPositionsClose(linePositions(lines), layout!.segments);
        // "Ø20.00" — six glyphs at two triangles each, after the two arrowheads
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 6 * 2 * 3);
    });

    test("lays out an angular dimension and grips the vertex too", async () => {
        const { annotation, select } = createSelectableDimension();
        annotation.dimensionType = "angular";
        annotation.centerPoint = new XYZ(0, 0, 0);
        annotation.startPoint = new XYZ(1, 0, 0);
        annotation.endPoint = new XYZ(0, 1, 0);
        annotation.textPoint = new XYZ(20, 20, 0);
        const { lines, texts, visual } = await createVisual(annotation);

        const layout = angularDimensionLayout(
            annotation.centerPoint!,
            annotation.startPoint,
            annotation.endPoint,
            annotation.textPoint,
            dimensionLayoutScale(annotation.textHeight),
        );
        expectPositionsClose(linePositions(lines), layout!.segments);
        // "90.0°" — five glyphs at two triangles each, after the two arrowheads
        expect(texts.geometry.getAttribute("position").count).toBe(2 * 3 + 5 * 2 * 3);

        // grips at start, end, vertex and text
        const [handles] = visual.wholeVisual() as [Points];
        select([annotation]);
        expect(handlePositions(handles)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 20, 20, 0]);
    });
});

describe("ThreeComponentObject member annotations", () => {
    let restoreFont: () => void;

    beforeEach(() => {
        restoreFont = stubAnnotationFont();
    });
    afterEach(() => {
        restoreFont();
    });

    function contextWithMaterial() {
        const { context, scene, visual } = createTestContext();
        context.materialMap.set("mat-1", new MeshBasicMaterial());
        return { context, scene, visual };
    }

    function memberDimension(document: TestDocument) {
        return new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dim",
            startPoint: new XYZ(0, 0, 0),
            endPoint: new XYZ(10, 0, 0),
            textPoint: new XYZ(5, 8, 0),
        });
    }

    test("renders each member annotation, placed by the member transform", async () => {
        const document = new TestDocument();
        const { context } = contextWithMaterial();
        const node = createTestComponentNode();
        const anno = memberDimension(document);
        anno.transform = Matrix4.fromTranslation(7, 0, 0);
        (node.component.nodes as unknown[]).push(anno);

        const obj = new ThreeComponentObject(node, context);
        await flush();

        expect(obj.annotations).toHaveLength(1);
        const visual = obj.annotations[0];
        expect(visual).toBeInstanceOf(ThreeDimensionAnnotation);
        expect(visual.parent).toBe(obj);
        expect(visual.transform.equals(Matrix4.fromTranslation(7, 0, 0))).toBe(true);

        // drawn through the batch of the component object, transform baked in
        const { lines, texts } = batchParts(visual);
        const layout = linearDimensionLayout(
            anno.startPoint,
            anno.endPoint,
            anno.textPoint,
            dimensionLayoutScale(anno.textHeight),
        )!;
        const shiftX = (values: readonly number[]) =>
            values.map((value, index) => (index % 3 === 0 ? value + 7 : value));
        expectPositionsClose(linePositions(lines), shiftX(layout.segments));
        const triangles = texts.geometry.getAttribute("position").array as Float32Array;
        expectPositionsClose(triangles.slice(0, layout.triangles.length), shiftX(layout.triangles));
        obj.dispose();
    });

    test("accumulates the transforms of nested component members", async () => {
        const document = new TestDocument();
        const { context } = contextWithMaterial();
        const anno = memberDimension(document);
        anno.transform = Matrix4.fromTranslation(3, 0, 0);
        const innerComponent = new Component({ name: "inner", nodes: [anno] });
        const innerNode = new ComponentNode({
            document,
            name: "inner",
            componentId: innerComponent.id,
            insert: XYZ.zero,
        });
        (innerNode as unknown as { _component: Component })._component = innerComponent;
        innerNode.transform = Matrix4.fromTranslation(2, 0, 0);
        const node = createTestComponentNode();
        (node.component.nodes as unknown[]).push(innerNode);

        const obj = new ThreeComponentObject(node, context);
        await flush();

        expect(obj.annotations).toHaveLength(1);
        const visual = obj.annotations[0] as ThreeDimensionAnnotation;
        // member 3 + nested component 2
        expect(visual.transform.equals(Matrix4.fromTranslation(5, 0, 0))).toBe(true);

        // the batch geometry is baked with the same accumulated transform
        const { lines, texts } = batchParts(visual);
        const layout = linearDimensionLayout(
            anno.startPoint,
            anno.endPoint,
            anno.textPoint,
            dimensionLayoutScale(anno.textHeight),
        )!;
        const shiftX = (values: readonly number[]) =>
            values.map((value, index) => (index % 3 === 0 ? value + 5 : value));
        expectPositionsClose(linePositions(lines), shiftX(layout.segments));
        const triangles = texts.geometry.getAttribute("position").array as Float32Array;
        expectPositionsClose(triangles.slice(0, layout.triangles.length), shiftX(layout.triangles));

        // the glyphs bake it too — annotation.transform alone would drop the nested +2
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = layout.triangles.length; i < triangles.length; i += 3) {
            minX = Math.min(minX, triangles[i]);
            maxX = Math.max(maxX, triangles[i]);
        }
        expect((minX + maxX) / 2).toBeCloseTo(layout.textPosition.x + 5, 1);
        obj.dispose();
    });

    test("dispose disposes the member annotation visuals and their batch", async () => {
        const document = new TestDocument();
        const { context } = contextWithMaterial();
        const node = createTestComponentNode();
        (node.component.nodes as unknown[]).push(memberDimension(document));
        const obj = new ThreeComponentObject(node, context);
        const visual = obj.annotations[0] as ThreeDimensionAnnotation;
        const batch = visual.batch!;
        await flush();

        obj.dispose();
        await flush();
        await flush();

        expect(obj.annotations).toHaveLength(0);
        expect(visual.batch).toBeUndefined();
        expect(batch.parent).toBeNull();
    });
});
