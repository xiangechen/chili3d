// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    GeometryUtils,
    type IDocument,
    type IEdge,
    type ITrimmedCurve,
    type IView,
    Matrix4,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { EdgeFilter, PickTrimEdgeEventHandler, Trim } from "../../../src/commands/modify/trim";

/** Build a mock document matching the slice PickTrimEdgeEventHandler touches. */
function makeDoc(): { doc: IDocument; highlighter: any; context: any } {
    const highlighter = {
        highlightMesh: rs.fn(() => 1234),
        removeHighlightMesh: rs.fn(),
        addState: rs.fn(),
        removeState: rs.fn(),
    };
    const context = {
        boundingBoxIntersectFilter: rs.fn(() => []),
        getNode: rs.fn(),
    };
    const selection = { clearSelection: rs.fn(), setSelectedShapes: rs.fn(() => 1) };
    const doc = {
        visual: { highlighter, context, highlighterUpdate: rs.fn() },
        selection,
        application: { activeView: { update: rs.fn() } },
    } as unknown as IDocument;
    return { doc, highlighter, context };
}

/** Build a fake view with the methods highlightDetecteds/cleanHighlights touch. */
function makeView(doc: IDocument): IView {
    return {
        document: doc,
        update: rs.fn(),
    } as unknown as IView;
}

describe("Trim", () => {
    test("should have command metadata", () => {
        const data = (Trim as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.trim");
        expect(data.icon).toBe("icon-trim");
    });

    test("should extend CancelableCommand", () => {
        const cmd = new Trim();
        expect(typeof (cmd as any).executeAsync).toBe("function");
    });

    test("executeAsync should rollback and rethrow when trimAsync throws", async () => {
        const cmd = new Trim();
        const selection = { clearSelection: rs.fn() };
        const pickAsync = rs.fn(async () => {
            throw new Error("pick failed");
        });
        const doc = {
            selection,
            picker: { pickAsync },
            visual: { highlighter: { addState: rs.fn(), removeState: rs.fn() } },
            history: { disabled: true, add: rs.fn() },
        } as unknown as IDocument;
        (cmd as any)._application = { activeView: { document: doc } };

        await expect((cmd as any).executeAsync()).rejects.toThrow("pick failed");

        expect(selection.clearSelection).toHaveBeenCalledTimes(1);
        expect(pickAsync).toHaveBeenCalledTimes(1);
    });
});

describe("EdgeFilter", () => {
    test("should allow shapes with edge type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
    });

    test("should reject shapes with face type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
    });

    test("should reject shapes with wire type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
    });

    test("should reject shapes with solid type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.solid } as any)).toBe(false);
    });

    test("should reject shapes with compound type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.compound } as any)).toBe(false);
    });

    test("should reject shapes with shell type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(false);
    });
});

describe("PickTrimEdgeEventHandler", () => {
    test("selected should be undefined initially", () => {
        const { doc } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        expect(handler.selected).toBeUndefined();
    });

    test("clearSelected should reset selected to undefined", () => {
        const { doc } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);
        (handler as any).highlight = { edge: {}, segments: {}, curve: {} };
        (handler as any).select(view, new PointerEvent("pointerdown"));
        expect(handler.selected).toBeDefined();

        (handler as any).clearSelected(doc);
        expect(handler.selected).toBeUndefined();
    });

    test("select should return 0 and leave selected undefined when nothing highlighted", () => {
        const { doc } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);
        const count = (handler as any).select(view, new PointerEvent("pointerdown"));
        expect(count).toBe(0);
        expect(handler.selected).toBeUndefined();
    });

    test("select should return 1 and set selected to the current highlight", () => {
        const { doc } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);
        const highlight = { edge: { owner: "owner-1" }, segments: {}, curve: {} };
        (handler as any).highlight = highlight;

        const count = (handler as any).select(view, new PointerEvent("pointerdown"));

        expect(count).toBe(1);
        expect(handler.selected).toBe(highlight);
    });

    test("cleanHighlights should be a no-op when nothing is highlighted", () => {
        const { doc, highlighter } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        (handler as any).cleanHighlights();
        expect(highlighter.removeHighlightMesh).not.toHaveBeenCalled();
    });

    test("cleanHighlights should remove the highlighted mesh and clear state", () => {
        const { doc, highlighter } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        (handler as any).highlightedEdge = 42;
        (handler as any).highlight = { edge: {} };

        (handler as any).cleanHighlights();

        expect(highlighter.removeHighlightMesh).toHaveBeenCalledWith(42);
        expect((handler as any).highlightedEdge).toBeUndefined();
        expect((handler as any).highlight).toBeUndefined();
    });

    test("highlightDetecteds should bail out (no highlight) when detecteds is empty", () => {
        const { doc, highlighter } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);

        (handler as any).highlightDetecteds(view, []);

        expect((handler as any).highlightedEdge).toBeUndefined();
        expect(highlighter.highlightMesh).not.toHaveBeenCalled();
    });

    test("highlightDetecteds should bail out when the detected shape is not an edge", () => {
        const { doc, highlighter } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);

        const detected = {
            shape: { shapeType: ShapeTypes.face, transformedMul: rs.fn(() => ({})) },
            owner: { boundingBox: () => BoundingBox.zero },
            transform: Matrix4.identity(),
        } as unknown as VisualShapeData;

        (handler as any).highlightDetecteds(view, [detected]);

        expect((handler as any).highlightedEdge).toBeUndefined();
        expect(highlighter.highlightMesh).not.toHaveBeenCalled();
    });

    test("highlightDetecteds should highlight the trim delete-segment for a single edge with no intersections", () => {
        const { doc, highlighter, context } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);

        const trimmedEdge = {
            mesh: {
                edges: { position: new Float32Array([0, 0, 0, 1, 1, 1]) },
            },
        };
        const curve = {
            firstParameter: () => 0,
            lastParameter: () => 10,
        };
        const edge = {
            shapeType: ShapeTypes.edge,
            curve,
            trim: rs.fn(() => trimmedEdge),
            dispose: rs.fn(),
            transformedMul: rs.fn(function (this: any) {
                return this;
            }),
        } as unknown as IEdge;

        const intersectsSpy = rs.spyOn(GeometryUtils, "intersects").mockImplementation(() => []);
        context.boundingBoxIntersectFilter = rs.fn(() => []);

        const detected = {
            shape: edge,
            owner: { boundingBox: () => BoundingBox.zero },
            transform: Matrix4.identity(),
            point: new XYZ({ x: 5, y: 0, z: 0 }),
        } as unknown as VisualShapeData;

        (handler as any).highlightDetecteds(view, [detected]);

        expect(intersectsSpy).toHaveBeenCalled();
        expect(highlighter.highlightMesh).toHaveBeenCalledTimes(1);
        const meshArg = highlighter.highlightMesh.mock.calls[0][0];
        expect(meshArg.color).toBeDefined();
        expect((handler as any).highlight).toBeDefined();
        expect((handler as any).highlight!.curve).toBe(curve);

        intersectsSpy.mockRestore();
    });

    test("highlightDetecteds should bail out when multiple detecteds are passed", () => {
        const { doc, highlighter } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);

        const edge1 = {
            shapeType: ShapeTypes.edge,
            shape: { shapeType: ShapeTypes.edge },
        } as unknown as VisualShapeData;
        const edge2 = {
            shapeType: ShapeTypes.edge,
            shape: { shapeType: ShapeTypes.edge },
        } as unknown as VisualShapeData;

        (handler as any).highlightDetecteds(view, [edge1, edge2]);

        expect((handler as any).highlightedEdge).toBeUndefined();
        expect(highlighter.highlightMesh).not.toHaveBeenCalled();
    });

    test("dispose should release edges accumulated in the release stack", () => {
        const { doc } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());

        const releaseStack = (handler as any).releaseStack as Set<{ dispose: () => void }>;
        const disposeSpy = rs.fn();
        releaseStack.add({ dispose: disposeSpy });

        handler.dispose();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(releaseStack.size).toBe(0);
    });

    test("controller cancel should trigger clearSelected + cleanHighlights", () => {
        const { doc, highlighter } = makeDoc();
        const controller = new AsyncController();
        const handler = new PickTrimEdgeEventHandler(doc, controller);
        (handler as any).highlightedEdge = 7;
        (handler as any).highlight = { edge: {} };

        controller.cancel();

        expect((handler as any).highlightedEdge).toBeUndefined();
        expect(highlighter.removeHighlightMesh).toHaveBeenCalledWith(7);
        expect(handler.selected).toBeUndefined();
    });
});

/** Subset of TrimEdge needed for assertions in findSegments tests. */
interface TrimEdgeSubset {
    edge: unknown;
    curve: unknown;
    segments: {
        deleteSegment: { start: number; end: number };
        retainSegments: Array<{ start: number; end: number }>;
    };
}

/**
 * findSegments is not exported but we can test it indirectly through
 * the highlightDetecteds path. However, to ensure branch coverage of the
 * internal findSegments / allSegment / startSegment / lastSegment / centerSegment
 * functions, we test via highlightDetecteds with different intersection counts.
 */
describe("findSegments (via highlightDetecteds)", () => {
    /**
     * Build a mock curve at params [0, 10] and edge with the given
     * intersection parameters for GeometryUtils.intersects.
     */
    function driveHighlightWithIntersections(
        intersectionParams: number[],
        clickParam: number,
    ): { highlight: TrimEdgeSubset } {
        const { doc, highlighter: _highlighter, context } = makeDoc();
        const handler = new PickTrimEdgeEventHandler(doc, new AsyncController());
        const view = makeView(doc);

        const trimmedEdge = {
            mesh: { edges: { position: new Float32Array([0, 0, 0]) } },
        };
        const curve = {
            firstParameter: () => 0,
            lastParameter: () => 10,
            parameter: rs.fn(() => clickParam),
        } as unknown as ITrimmedCurve;
        const edge = {
            shapeType: ShapeTypes.edge,
            curve,
            trim: rs.fn(() => trimmedEdge),
            dispose: rs.fn(),
            transformedMul: rs.fn(function (this: any) {
                return this;
            }),
        } as unknown as IEdge;

        const intersectsSpy = rs
            .spyOn(GeometryUtils, "intersects")
            .mockImplementation(() => intersectionParams.map((p) => ({ point: XYZ.zero, parameter: p })));
        context.boundingBoxIntersectFilter = rs.fn(() => []);

        const detected = {
            shape: edge,
            owner: { boundingBox: () => BoundingBox.zero },
            transform: Matrix4.identity(),
            point: new XYZ({ x: clickParam, y: 0, z: 0 }),
        } as unknown as VisualShapeData;

        // biome-ignore lint/suspicious/noExplicitAny: protected members accessed via test helper
        (handler as any).highlightDetecteds(view, [detected]);

        intersectsSpy.mockRestore();
        return { highlight: (handler as any).highlight as TrimEdgeSubset };
    }

    test("allSegment: when intersections only have curve endpoints (2 intersections)", () => {
        // No intermediate intersections → only curve endpoints → allSegment
        const { highlight } = driveHighlightWithIntersections([], 5);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(0);
        expect(highlight.segments.deleteSegment.end).toBe(10);
        expect(highlight.segments.retainSegments).toHaveLength(0);
    });

    test("startSegment: click parameter falls in the first segment", () => {
        // Intersections at [2, 5, 8], click at parameter=1 (before first intersection)
        const { highlight } = driveHighlightWithIntersections([2, 5, 8], 1);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(0);
        expect(highlight.segments.deleteSegment.end).toBe(2);
        expect(highlight.segments.retainSegments).toHaveLength(1);
        expect(highlight.segments.retainSegments[0].start).toBe(2);
        expect(highlight.segments.retainSegments[0].end).toBe(10);
    });

    test("lastSegment: click parameter falls in the last segment", () => {
        // Intersections at [2, 5, 8], click at parameter=9 (after last intersection)
        const { highlight } = driveHighlightWithIntersections([2, 5, 8], 9);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(8);
        expect(highlight.segments.deleteSegment.end).toBe(10);
        expect(highlight.segments.retainSegments).toHaveLength(1);
        expect(highlight.segments.retainSegments[0].start).toBe(0);
        expect(highlight.segments.retainSegments[0].end).toBe(8);
    });

    test("centerSegment: click parameter falls in the middle of three intersection segments", () => {
        // Intersections at [2, 5, 8], click at parameter=6 → between 5 and 8 (i=2)
        const { highlight } = driveHighlightWithIntersections([2, 5, 8], 6);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(5);
        expect(highlight.segments.deleteSegment.end).toBe(8);
        expect(highlight.segments.retainSegments).toHaveLength(2);
        expect(highlight.segments.retainSegments[0].start).toBe(0);
        expect(highlight.segments.retainSegments[0].end).toBe(5);
        expect(highlight.segments.retainSegments[1].start).toBe(8);
        expect(highlight.segments.retainSegments[1].end).toBe(10);
    });

    test("centerSegment: click parameter in second segment of four intersections", () => {
        // Intersections at [1, 3, 6, 8], click at parameter=4 → between 3 and 6 (i=2, not first/last)
        const { highlight } = driveHighlightWithIntersections([1, 3, 6, 8], 4);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(3);
        expect(highlight.segments.deleteSegment.end).toBe(6);
        expect(highlight.segments.retainSegments).toHaveLength(2);
        expect(highlight.segments.retainSegments[0].start).toBe(0);
        expect(highlight.segments.retainSegments[0].end).toBe(3);
        expect(highlight.segments.retainSegments[1].start).toBe(6);
        expect(highlight.segments.retainSegments[1].end).toBe(10);
    });

    test("should use startSegment when click is before first unique intersection", () => {
        // Duplicate intersection values → deduplicated to [5], + curve endpoints = [0, 5, 10]
        // click at parameter 2 is < 5 (first intersection), so startSegment
        const { highlight } = driveHighlightWithIntersections([5, 5, 5], 2);
        expect(highlight).toBeDefined();
        expect(highlight.segments.deleteSegment.start).toBe(0);
        expect(highlight.segments.deleteSegment.end).toBe(5);
        expect(highlight.segments.retainSegments).toHaveLength(1);
    });
});
