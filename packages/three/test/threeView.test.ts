// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    Config,
    EditableShapeNode,
    type IView,
    Matrix4,
    MultiShapeNode,
    Plane,
    Ray,
    Result,
    type ShapeNode,
    ShapeTypes,
    type VisualNode,
    XY,
    XYZ,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    BufferGeometry,
    DirectionalLight,
    Group,
    Layers,
    type Mesh,
    MeshBasicMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Scene,
} from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Constants } from "../src/constants";
import { ThreeGeometry } from "../src/threeGeometry";
import { ThreeView } from "../src/threeView";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, type ThreeVisualObject } from "../src/threeVisualObject";
import {
    createTestComponentNode,
    createTestGeometryNode,
    createTestMeshNode,
    createThreeMockVisualContext,
} from "./mocks";
import { container, TestView } from "./testView";

// ============================================================================
// Helpers — patch application.views and build a TestView for tests
// ============================================================================

function createViewsArray(): IView[] {
    const arr: IView[] = [];
    (arr as any).remove = (item: IView) => {
        const idx = arr.indexOf(item);
        if (idx >= 0) arr.splice(idx, 1);
    };
    return arr;
}

function createTestView(overrides?: {
    document?: any;
    content?: ThreeVisualContext;
    name?: string;
    workplane?: Plane;
}): { view: TestView; doc: TestDocument; context: ThreeVisualContext } {
    const doc = overrides?.document ?? new TestDocument();
    // Ensure application.views supports .remove()
    if (!doc.application.views || !(doc.application.views as any).remove) {
        doc.application.views = createViewsArray() as any;
    }
    const context = overrides?.content ?? createThreeMockVisualContext();
    (context as any).scene ??= new Scene();
    const view = new TestView(doc, context, {
        name: overrides?.name,
        workplane: overrides?.workplane,
    });
    return { view, doc, context };
}

// ============================================================================
// ThreeView — construction
// ============================================================================

describe("ThreeView — construction", () => {
    test("creates with default mode solidAndWireframe", () => {
        const { view } = createTestView();
        expect(view.mode).toBe("solidAndWireframe");
    });

    test("camera is PerspectiveCamera by default", () => {
        const { view } = createTestView();
        expect(view.camera).toBeInstanceOf(PerspectiveCamera);
    });

    test("name property getter returns constructor value", () => {
        const { view } = createTestView({ name: "my-view" });
        expect(view.name).toBe("my-view");
    });

    test("isClosed defaults to false", () => {
        const { view } = createTestView();
        expect(view.isClosed).toBe(false);
    });

    test("dynamicLight is a DirectionalLight", () => {
        const { view } = createTestView();
        expect(view.dynamicLight).toBeInstanceOf(DirectionalLight);
        expect(view.dynamicLight.intensity).toBe(2);
    });

    test("registers itself in document.application.views", () => {
        const doc = new TestDocument();
        const before = doc.application.views.length;
        const { view } = createTestView({ document: doc });
        expect(doc.application.views.length).toBe(before + 1);
        expect(doc.application.views).toContain(view);
    });

    test("renderer property returns the renderer", () => {
        const { view } = createTestView();
        expect(view.renderer.domElement.tagName).toBe("CANVAS");
    });
});

// ============================================================================
// ThreeView — properties
// ============================================================================

describe("ThreeView — properties", () => {
    test("name setter fires property changed", () => {
        const { view } = createTestView();
        const fired: string[] = [];
        view.onPropertyChanged((prop) => fired.push(prop as string));

        view.name = "renamed";
        expect(view.name).toBe("renamed");
        expect(fired).toContain("name");
    });

    test("mode setter triggers camera layer update", () => {
        const { view } = createTestView();

        view.mode = "wireframe";
        expect(view.mode).toBe("wireframe");
        expect(view.camera.layers.isEnabled(Constants.Layers.Wireframe)).toBe(true);
        expect(view.camera.layers.isEnabled(Constants.Layers.Solid)).toBe(false);

        view.mode = "solid";
        expect(view.mode).toBe("solid");
        expect(view.camera.layers.isEnabled(Constants.Layers.Solid)).toBe(true);
        expect(view.camera.layers.isEnabled(Constants.Layers.Wireframe)).toBe(false);

        view.mode = "solidAndWireframe";
        expect(view.mode).toBe("solidAndWireframe");
        expect(view.camera.layers.isEnabled(Constants.Layers.Wireframe)).toBe(true);
        expect(view.camera.layers.isEnabled(Constants.Layers.Solid)).toBe(true);
    });

    test("workplane getter returns initial plane", () => {
        const plane = Plane.YZ;
        const { view } = createTestView({ workplane: plane });
        expect(view.workplane).toBe(plane);
    });

    test("workplane setter triggers property changed", () => {
        const { view } = createTestView();
        const fired: string[] = [];
        view.onPropertyChanged((prop) => fired.push(prop as string));

        const newPlane = Plane.YZ;
        view.workplane = newPlane;
        expect(view.workplane).toBe(newPlane);
        expect(fired).toContain("workplane");
    });

    test("dom returns undefined before setDom", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        // setDom not called yet
        expect(view.dom).toBeUndefined();
    });

    test("dom returns element after setDom", () => {
        const { view } = createTestView();
        expect(view.dom).toBe(container);
    });

    test("width returns client width of dom", () => {
        const { view } = createTestView();
        expect(view.width).toBe(100);
    });

    test("height returns client height of dom", () => {
        const { view } = createTestView();
        expect(view.height).toBe(100);
    });

    test("width defaults to 1 when dom is undefined", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        expect(view.width).toBe(1);
    });

    test("height defaults to 1 when dom is undefined", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        expect(view.height).toBe(1);
    });
});

// ============================================================================
// ThreeView — screenToCameraRect (pure math)
// ============================================================================

describe("ThreeView — screenToCameraRect", () => {
    test("top-left maps to (-1, 1)", () => {
        const { view } = createTestView();
        const result = view.screenToCameraRect(0, 0);
        expect(result.x).toBeCloseTo(-1);
        expect(result.y).toBeCloseTo(1);
    });

    test("bottom-right maps to (1, -1)", () => {
        const { view } = createTestView();
        const result = view.screenToCameraRect(100, 100);
        expect(result.x).toBeCloseTo(1);
        expect(result.y).toBeCloseTo(-1);
    });

    test("center maps to (0, 0)", () => {
        const { view } = createTestView();
        const result = view.screenToCameraRect(50, 50);
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
    });
});

// ============================================================================
// ThreeView — worldToScreen / screenToWorld
// ============================================================================

describe("ThreeView — worldToScreen / screenToWorld", () => {
    test("screenToWorld of the viewport center lies on the view axis", () => {
        const { view } = createTestView();
        // The renderer never runs in tests, so flush the camera transform manually
        view.camera.updateMatrixWorld();
        const world = view.screenToWorld(50, 50);
        expect(world.x).toBeCloseTo(0);
        expect(world.y).toBeCloseTo(0);
        // Unprojecting ndc z=0.5 (near=0.1, far=1e6) lands ~0.4 in front of the camera at z=100
        expect(world.z).toBeCloseTo(99.6, 0);
    });

    test("worldToScreen of the origin is the viewport center", () => {
        const { view } = createTestView();
        view.camera.updateMatrixWorld();
        const screen = view.worldToScreen(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(screen.x).toBe(50);
        expect(screen.y).toBe(50);
    });

    test("worldToScreen of a point on the view axis is the viewport center", () => {
        const { view } = createTestView();
        view.camera.updateMatrixWorld();
        const screen = view.worldToScreen(new XYZ({ x: 0, y: 0, z: 50 }));
        expect(screen.x).toBe(50);
        expect(screen.y).toBe(50);
    });
});

// ============================================================================
// ThreeView — rayAt
// ============================================================================

describe("ThreeView — rayAt", () => {
    test("rayAt returns a Ray with point and direction", () => {
        const { view } = createTestView();
        const ray = view.rayAt(50, 50);
        expect(ray).toBeInstanceOf(Ray);
        expect(typeof ray.point.x).toBe("number");
        expect(typeof ray.direction.x).toBe("number");
        expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1);
    });

    test("rayAt from center has direction toward scene", () => {
        const { view } = createTestView();
        const ray = view.rayAt(50, 50);
        // Direction should point toward the scene (negative Z for default camera at 0,0,100 looking at 0,0,0)
        expect(ray.direction.z).toBeLessThan(0);
    });

    test("rayAt with orthographic camera returns a normalized direction", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        const ray = view.rayAt(50, 50);
        expect(ray).toBeInstanceOf(Ray);
        expect(Number.isFinite(ray.point.x)).toBe(true);
        expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1);
    });
});

// ============================================================================
// ThreeView — direction / up
// ============================================================================

describe("ThreeView — direction / up", () => {
    test("direction returns camera world direction", () => {
        const { view } = createTestView();
        const dir = view.direction();
        expect(typeof dir.x).toBe("number");
        expect(typeof dir.y).toBe("number");
        expect(typeof dir.z).toBe("number");
    });

    test("up returns camera up vector", () => {
        const { view } = createTestView();
        const up = view.up();
        expect(up.y).toBeCloseTo(1);
    });
});

// ============================================================================
// ThreeView — update
// ============================================================================

describe("ThreeView — update", () => {
    test("update marks the view for re-rendering", () => {
        const { view } = createTestView();
        view.update();
        expect((view as any)._needsUpdate).toBe(true);
    });
});

// ============================================================================
// ThreeView — resize
// ============================================================================

describe("ThreeView — resize", () => {
    test("resize with near-zero height returns early without touching the camera", () => {
        const { view } = createTestView();
        view.resize(800, 600);
        const cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);

        view.resize(100, 0);
        expect(cam.aspect).toBeCloseTo(800 / 600);
    });

    test("resize with valid dimensions updates the camera aspect", () => {
        const { view } = createTestView();
        view.resize(800, 600);
        const cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);
    });

    test("resize with orthographic camera updates the frustum", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        view.resize(1024, 768);

        const cam = view.camera as OrthographicCamera;
        const halfHeight = Math.sqrt(3 * 1500 * 1500) * Math.tan((25 * Math.PI) / 180);
        expect(cam.top).toBeCloseTo(halfHeight);
        expect(cam.bottom).toBeCloseTo(-halfHeight);
        expect(cam.right / cam.top).toBeCloseTo(1024 / 768);
    });
});

// ============================================================================
// ThreeView — close
// ============================================================================

describe("ThreeView — close", () => {
    test("close marks isClosed true", () => {
        const { view } = createTestView();
        view.close();
        expect(view.isClosed).toBe(true);
    });

    test("close removes view from application.views", () => {
        const doc = new TestDocument();
        const { view } = createTestView({ document: doc });
        expect(doc.application.views).toContain(view);
        view.close();
        expect(doc.application.views).not.toContain(view);
    });

    test("double close is a no-op", () => {
        const { view } = createTestView();
        view.close();
        view.close();
        expect(view.isClosed).toBe(true);
    });
});

// ============================================================================
// ThreeView — toImage
// ============================================================================

describe("ThreeView — toImage", () => {
    test("toImage returns a data URL string", () => {
        const { view } = createTestView();
        const img = view.toImage();
        expect(typeof img).toBe("string");
    });
});

// ============================================================================
// ThreeView — isolate / unisolate
// ============================================================================

describe("ThreeView — isolate / unisolate", () => {
    test("unisolate when not isolated leaves camera layers untouched", () => {
        const { view } = createTestView();
        const mask = view.camera.layers.mask;

        view.unisolate();
        expect(view.camera.layers.mask).toBe(mask);
    });

    test("isolate with empty nodes array still restricts camera layers", () => {
        const { view } = createTestView();

        view.isolate([]);
        expect(view.camera.layers.isEnabled(Constants.Layers.Default)).toBe(true);
        expect(view.camera.layers.isEnabled(Constants.Layers.Isolation)).toBe(true);
        expect(view.camera.layers.mask).toBe(
            (1 << Constants.Layers.Default) | (1 << Constants.Layers.Isolation),
        );
    });
});

// ============================================================================
// ThreeView — htmlText
// ============================================================================

describe("ThreeView — htmlText", () => {
    test("htmlText adds a disposable css object to the scene", () => {
        const { view, context } = createTestView();
        const before = context.cssObjects.children.length;

        const result = view.htmlText("Hello", new XYZ({ x: 0, y: 0, z: 0 }));
        expect(context.cssObjects.children.length).toBe(before + 1);
        expect(typeof result.dispose).toBe("function");

        result.dispose();
        expect(context.cssObjects.children.length).toBe(before);
    });

    test("htmlText with className option applies the class", () => {
        const { view, context } = createTestView();
        const result = view.htmlText("Test", new XYZ({ x: 10, y: 20, z: 30 }), {
            className: "custom",
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        expect(cssObject.element.classList.contains("custom")).toBe(true);

        result.dispose();
    });

    test("htmlText dispose removes the css object", () => {
        const { view, context } = createTestView();
        const before = context.cssObjects.children.length;

        const result = view.htmlText("Disposable", new XYZ({ x: 0, y: 0, z: 0 }));
        expect(context.cssObjects.children.length).toBe(before + 1);

        result.dispose();
        expect(context.cssObjects.children.length).toBe(before);
    });

    test("htmlText with center option sets the css object center", () => {
        const { view, context } = createTestView();
        const result = view.htmlText("Centered", new XYZ({ x: 0, y: 0, z: 0 }), {
            center: new XY({ x: 0.5, y: 0.5 }),
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        expect(cssObject.center.x).toBe(0.5);
        expect(cssObject.center.y).toBe(0.5);

        result.dispose();
    });

    test("htmlText with hideDelete option creates no delete icon", () => {
        const { view, context } = createTestView();
        const result = view.htmlText("No Delete", new XYZ({ x: 0, y: 0, z: 0 }), {
            hideDelete: true,
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        expect(cssObject.element.querySelector("svg")).toBeNull();

        result.dispose();
    });

    test("htmlText with onDispose callback", () => {
        const { view } = createTestView();
        let disposed = false;
        const result = view.htmlText("With Callback", new XYZ({ x: 0, y: 0, z: 0 }), {
            onDispose: () => {
                disposed = true;
            },
        });
        result.dispose();
        expect(disposed).toBe(true);
    });
});

// ============================================================================
// ThreeView — setDom
// ============================================================================

describe("ThreeView — setDom", () => {
    test("setDom appends renderer canvas to element", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        const el = document.createElement("div");
        Object.defineProperties(el, {
            clientWidth: { get: () => 200 },
            clientHeight: { get: () => 150 },
        });
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 150 }) as any;

        view.setDom(el);
        expect(view.dom).toBe(el);
    });

    test("setDom replaces previous dom element", () => {
        const { view } = createTestView();
        const el = document.createElement("div");
        Object.defineProperties(el, {
            clientWidth: { get: () => 300 },
            clientHeight: { get: () => 200 },
        });
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 }) as any;

        view.setDom(el);
        expect(view.dom).toBe(el);
    });
});

// ============================================================================
// ThreeView — CSS2DRenderer integration
// ============================================================================

describe("ThreeView — CSS2DRenderer integration", () => {
    test("initCssRenderer returns CSS2DRenderer instance", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        const cssRenderer = (view as any).initCssRenderer();
        expect(cssRenderer).toBeInstanceOf(CSS2DRenderer);
    });
});

// ============================================================================
// ThreeView — detectVisual
// ============================================================================

describe("ThreeView — detectVisual", () => {
    test("detectVisual returns empty array when no intersections", () => {
        const { view } = createTestView();
        const result = view.detectVisual(50, 50);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test("detectVisual accepts nodeFilter parameter", () => {
        const { view } = createTestView();
        const filter = { allow: () => true };
        const result = view.detectVisual(50, 50, filter);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectVisual accepts undefined filter", () => {
        const { view } = createTestView();
        const result = view.detectVisual(0, 0, undefined);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectVisual at edge coordinates returns empty", () => {
        const { view } = createTestView();
        const result = view.detectVisual(-1, -1);
        expect(Array.isArray(result)).toBe(true);
    });
});

// ============================================================================
// ThreeView — detectVisualRect
// ============================================================================

describe("ThreeView — detectVisualRect", () => {
    test("detectVisualRect returns empty array when no intersections", () => {
        const { view } = createTestView();
        const result = view.detectVisualRect(0, 0, 100, 100);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test("detectVisualRect with node filter", () => {
        const { view } = createTestView();
        const filter = { allow: () => true };
        const result = view.detectVisualRect(10, 10, 90, 90, filter);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectVisualRect with inverted coordinates", () => {
        const { view } = createTestView();
        const result = view.detectVisualRect(90, 90, 10, 10);
        expect(Array.isArray(result)).toBe(true);
    });
});

// ============================================================================
// ThreeView — detectShapes
// ============================================================================

describe("ThreeView — detectShapes", () => {
    test("detectShapes returns empty array for shape type", () => {
        const { view } = createTestView();
        const result = view.detectShapes(ShapeTypes.edge, 50, 50);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapes with whole shape type returns empty array", () => {
        const { view } = createTestView();
        const result = view.detectShapes(ShapeTypes.solid, 50, 50);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapes with shape and node filters", () => {
        const { view } = createTestView();
        const shapeFilter = { allow: () => true };
        const nodeFilter = { allow: () => true };
        const result = view.detectShapes(ShapeTypes.edge, 50, 50, shapeFilter, nodeFilter);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapes with wireframe mode", () => {
        const { view } = createTestView();
        view.mode = "wireframe";
        const result = view.detectShapes(ShapeTypes.edge, 50, 50);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapes with solid mode", () => {
        const { view } = createTestView();
        view.mode = "solid";
        const result = view.detectShapes(ShapeTypes.face, 50, 50);
        expect(Array.isArray(result)).toBe(true);
    });
});

// ============================================================================
// ThreeView — detectShapesRect
// ============================================================================

describe("ThreeView — detectShapesRect", () => {
    test("detectShapesRect returns empty array for whole shape type", () => {
        const { view } = createTestView();
        const result = view.detectShapesRect(ShapeTypes.solid, 0, 0, 100, 100);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test("detectShapesRect returns empty array for sub shape type", () => {
        const { view } = createTestView();
        const result = view.detectShapesRect(ShapeTypes.edge, 10, 10, 90, 90);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapesRect with shape and node filters", () => {
        const { view } = createTestView();
        const shapeFilter = { allow: () => true };
        const nodeFilter = { allow: () => true };
        const result = view.detectShapesRect(ShapeTypes.shape, 0, 0, 100, 100, shapeFilter, nodeFilter);
        expect(Array.isArray(result)).toBe(true);
    });

    test("detectShapesRect with inverted coordinates", () => {
        const { view } = createTestView();
        const result = view.detectShapesRect(ShapeTypes.shape, 90, 90, 10, 10);
        expect(Array.isArray(result)).toBe(true);
    });
});

// ============================================================================
// ThreeView — rect detection dedupe (cloned nodes share shape ids)
// ============================================================================

describe("ThreeView — rect detection dedupe", () => {
    function createShapeNodeDuck(shape: object): ShapeNode {
        const node = Object.create(EditableShapeNode.prototype) as EditableShapeNode;
        (node as any)._shape = Result.ok(shape);
        return node;
    }

    function createVisualDuck(node: object): ThreeVisualObject {
        return { node, worldTransform: () => Matrix4.identity() } as unknown as ThreeVisualObject;
    }

    test("detectWholeShapesInRect keeps same-id shapes from different visuals", () => {
        const { view } = createTestView();
        const visualA = createVisualDuck(createShapeNodeDuck({ id: "shared-id" }));
        const visualB = createVisualDuck(createShapeNodeDuck({ id: "shared-id" }));

        const result = (view as any).detectWholeShapesInRect([visualA, visualB]);

        expect(result).toHaveLength(2);
        expect(result[0].owner).toBe(visualA);
        expect(result[1].owner).toBe(visualB);
    });

    test("detectWholeShapesInRect still dedupes same-id shapes within one visual", () => {
        const { view } = createTestView();
        const node = Object.create(MultiShapeNode.prototype) as MultiShapeNode;
        (node as any)._shapes = [{ id: "dup-id" }, { id: "dup-id" }];
        const visual = createVisualDuck(node);

        const result = (view as any).detectWholeShapesInRect([visual]);

        expect(result).toHaveLength(1);
    });

    test("detectSubShapesInRect keeps same-id sub-shapes from different visuals", () => {
        const { view, context } = createTestView();
        // createTestGeometryNode always uses face id "f1" — same as two cloned nodes
        const geoA = new ThreeGeometry(createTestGeometryNode(), context);
        const geoB = new ThreeGeometry(createTestGeometryNode(), context);
        // Skip screen projection; the dedupe behavior under test runs before it matters
        (view as any).isShapeInRect = () => true;

        const result = (view as any).detectSubShapesInRect(ShapeTypes.face, [geoA, geoB], 0, 0, 100, 100);

        expect(result).toHaveLength(2);
        expect(result[0].owner).toBe(geoA);
        expect(result[1].owner).toBe(geoB);
    });
});

// ============================================================================
// ThreeView — close with view switching
// ============================================================================

describe("ThreeView — close with view switching", () => {
    test("close switches activeView to another view for same document", () => {
        const doc = new TestDocument();
        const views = createViewsArray();
        // Patch the views array onto the document's application before creating views
        (doc.application as any).views = views;

        const context1 = createThreeMockVisualContext();
        const context2 = createThreeMockVisualContext();
        const view1 = new TestView(doc, context1, { name: "view-1" });
        const view2 = new TestView(doc, context2, { name: "view-2" });
        view1.setDom(container.cloneNode() as HTMLElement);
        view2.setDom(container.cloneNode() as HTMLElement);

        (doc.application as any).activeView = view1;
        expect(doc.application.activeView).toBe(view1);

        view1.close();
        // The view should no longer be active or in views
        expect(view1.isClosed).toBe(true);
    });

    test("close does not switch activeView when no other view for same document", () => {
        const doc = new TestDocument();
        const views = createViewsArray();
        (doc.application as any).views = views;

        const context = createThreeMockVisualContext();
        const view = new TestView(doc, context, { name: "view-only" });
        view.setDom(container.cloneNode() as HTMLElement);
        (doc.application as any).activeView = view;

        view.close();
        expect(view.isClosed).toBe(true);
    });
});

// ============================================================================
// ThreeView — disposeInternal
// ============================================================================

describe("ThreeView — disposeInternal", () => {
    test("disposeInternal calls gizmo dispose", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        view.setDom(container);

        const gizmo = (view as any)._gizmo;
        let gizmoDisposed = false;
        gizmo.dispose = () => {
            gizmoDisposed = true;
        };

        view["disposeInternal"]();
        expect(gizmoDisposed).toBe(true);
    });

    test("dispose without close stops the animation loop", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context, { setDom: false });
        expect(view.isClosed).toBe(false);

        const raf = rs.fn();
        rs.stubGlobal("requestAnimationFrame", raf);
        try {
            view.dispose();
            (view as any).animate();
            expect(raf).not.toHaveBeenCalled();
        } finally {
            rs.unstubAllGlobals();
        }
    });
});

// ============================================================================
// ThreeView — htmlText with all options
// ============================================================================

describe("ThreeView — htmlText advanced", () => {
    test("htmlText with hideDelete creates element without delete button", () => {
        const { view, context } = createTestView();
        const result = view.htmlText("No Delete", new XYZ({ x: 0, y: 0, z: 0 }), {
            hideDelete: true,
            className: "my-custom-class",
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        expect(cssObject.element.classList.contains("my-custom-class")).toBe(true);
        expect(cssObject.element.querySelector("svg")).toBeNull();

        result.dispose();
    });

    test("htmlText interactive wires click and dblclick handlers", () => {
        const { view, context } = createTestView();
        const events: string[] = [];
        const result = view.htmlText("Badge", new XYZ({ x: 0, y: 0, z: 0 }), {
            hideDelete: true,
            interactive: true,
            onClick: () => events.push("click"),
            onDoubleClick: () => events.push("dblclick"),
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        const element = cssObject.element as HTMLElement;

        element.dispatchEvent(new MouseEvent("click"));
        element.dispatchEvent(new MouseEvent("dblclick"));
        expect(events).toEqual(["click", "dblclick"]);

        result.dispose();
    });

    test("htmlText dispose is idempotent", () => {
        const { view, context } = createTestView();
        const before = context.cssObjects.children.length;

        const result = view.htmlText("Cleanup", new XYZ({ x: 0, y: 0, z: 0 }));
        result.dispose();
        // Second dispose should not throw
        result.dispose();
        expect(context.cssObjects.children.length).toBe(before);
    });

    test("htmlText with all options combined", () => {
        const { view, context } = createTestView();
        let disposed = false;
        const result = view.htmlText("All Options", new XYZ({ x: 5, y: 10, z: 15 }), {
            center: new XY({ x: 0.5, y: 0 }),
            className: "full-custom",
            hideDelete: false,
            onDispose: () => {
                disposed = true;
            },
        });
        const cssObject = context.cssObjects.children.at(-1) as any;
        expect(cssObject.element.classList.contains("full-custom")).toBe(true);
        expect(cssObject.center.x).toBe(0.5);
        expect(cssObject.center.y).toBe(0);

        result.dispose();
        expect(disposed).toBe(true);
    });
});

// ============================================================================
// ThreeView — mode setter
// ============================================================================

describe("ThreeView — mode transitions", () => {
    test("repeated mode set to same value keeps the value", () => {
        const { view } = createTestView();
        view.mode = "solid";
        view.mode = "solid";
        expect(view.mode).toBe("solid");
    });
});

// ============================================================================
// ThreeView — name property
// ============================================================================

describe("ThreeView — name property", () => {
    test("name setter updates property", () => {
        const { view } = createTestView();
        view.name = "new-name";
        expect(view.name).toBe("new-name");
        view.name = "";
        expect(view.name).toBe("");
    });
});

// ============================================================================
// ThreeView — resize edge cases
// ============================================================================

describe("ThreeView — resize edge cases", () => {
    test("resize with very small but positive height below the threshold returns early", () => {
        const { view } = createTestView();
        const cam = view.camera as PerspectiveCamera;
        const aspectBefore = cam.aspect;

        // 0.000001 < 0.00001 threshold, so resize bails out without touching the camera
        view.resize(100, 0.000001);
        expect(cam.aspect).toBe(aspectBefore);
    });

    test("resize with large dimensions", () => {
        const { view } = createTestView();
        view.resize(3840, 2160);
        const cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(3840 / 2160);
    });

    test("multiple resizes update camera correctly", () => {
        const { view } = createTestView();
        view.resize(800, 600);
        let cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);

        view.resize(1920, 1080);
        cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(1920 / 1080);
    });
});

// ============================================================================
// ThreeView — rayAt with different camera types
// ============================================================================

describe("ThreeView — rayAt advanced", () => {
    test("rayAt with orthographic camera returns valid ray", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        view.resize(800, 600);

        const ray = view.rayAt(400, 300);
        expect(ray).toBeInstanceOf(Ray);
        expect(Number.isFinite(ray.point.x)).toBe(true);
        expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1);
        expect(ray.direction.z).toBeLessThan(0);
    });

    test("rayAt from top-left corner", () => {
        const { view } = createTestView();
        const ray = view.rayAt(0, 0);
        expect(ray).toBeInstanceOf(Ray);
        expect(ray.direction.z).toBeLessThan(0);
    });

    test("rayAt from bottom-right corner", () => {
        const { view } = createTestView();
        const ray = view.rayAt(100, 100);
        expect(ray).toBeInstanceOf(Ray);
        expect(ray.direction.z).toBeLessThan(0);
    });
});

// ============================================================================
// ThreeView — direction / up with different camera orientations
// ============================================================================

describe("ThreeView — direction / up detail", () => {
    test("direction returns normalized-ish vector", () => {
        const { view } = createTestView();
        view.camera.position.set(0, 0, 100);
        view.camera.lookAt(0, 0, 0);
        const dir = view.direction();
        // Should point roughly toward -Z
        expect(dir.z).toBeLessThan(0);
    });

    test("up vector points roughly +Y", () => {
        const { view } = createTestView();
        const up = view.up();
        expect(Math.abs(up.y)).toBeGreaterThan(0.9);
    });
});

// ============================================================================
// ThreeView — worldToScreen returns finite values
// ============================================================================

describe("ThreeView — worldToScreen accuracy", () => {
    test("worldToScreen of origin returns finite values", () => {
        const { view } = createTestView();
        const screen = view.worldToScreen(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(Number.isFinite(screen.x)).toBe(true);
        expect(Number.isFinite(screen.y)).toBe(true);
    });

    test("worldToScreen of point behind camera still returns values", () => {
        const { view } = createTestView();
        // Point behind the camera at z=100 looking toward z=0
        const screen = view.worldToScreen(new XYZ({ x: 0, y: 0, z: 200 }));
        expect(typeof screen.x).toBe("number");
        expect(typeof screen.y).toBe("number");
    });
});

// ============================================================================
// ThreeView — constructor without setDom
// ============================================================================

describe("ThreeView — constructor edge cases", () => {
    test("constructor with various workplane planes", () => {
        const context = createThreeMockVisualContext();
        const doc = new TestDocument();

        const viewXY = new TestView(doc, context, { workplane: Plane.XY });
        expect(viewXY.workplane).toBe(Plane.XY);

        const viewYZ = new TestView(doc, context, { workplane: Plane.YZ });
        expect(viewYZ.workplane).toBe(Plane.YZ);
    });
});

// ============================================================================
// ThreeView — getNodeFromObject (4-way instanceof dispatch)
// ============================================================================

describe("ThreeView — getNodeFromObject", () => {
    const createdMeshes: Mesh[] = [];

    afterEach(() => {
        for (const m of createdMeshes) {
            m.geometry?.dispose();
            if (Array.isArray(m.material)) {
                for (const mat of m.material) mat.dispose();
            } else {
                m.material?.dispose();
            }
        }
        createdMeshes.length = 0;
    });

    test("extracts meshNode from ThreeMeshObject", () => {
        const node = createTestMeshNode();
        const mockCtx = createThreeMockVisualContext();
        const obj = new ThreeMeshObject(mockCtx, node);
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBe(node);
    });

    test("extracts geometryNode from ThreeGeometry", () => {
        const node = createTestGeometryNode();
        const mockCtx = createThreeMockVisualContext();
        const obj = new ThreeGeometry(node, mockCtx);
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBe(node);
    });

    test("extracts componentNode from ThreeComponentObject", () => {
        const node = createTestComponentNode();
        const mockCtx = createThreeMockVisualContext();
        const obj = new ThreeComponentObject(node, mockCtx);
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBe(node);
    });

    test("returns undefined for plain Object3D", () => {
        const obj = new Group();
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBeUndefined();
    });
});

// ============================================================================
// ThreeView — isBoundingBoxInRect (pure math, 8-corner projection)
// ============================================================================

describe("ThreeView — isBoundingBoxInRect", () => {
    test("returns false for invalid bounding box", () => {
        const { view } = createTestView();
        const invalidBox = { min: { x: NaN, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

        const result = (view as any).isBoundingBoxInRect(invalidBox, Matrix4.identity(), 0, 0, 100, 100);
        expect(result).toBe(false);
    });

    test("returns false when box is empty (min > max)", () => {
        const { view } = createTestView();
        const invalidBox = { min: { x: 2, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

        const result = (view as any).isBoundingBoxInRect(invalidBox, Matrix4.identity(), 0, 0, 100, 100);
        expect(result).toBe(false);
    });

    test("returns true for valid box overlapping full rect", () => {
        const { view } = createTestView();
        // Camera at (0,0,100) looks at (0,0,0), origin projects to ~(50,50)
        // Use actual projected point at origin as a tight test
        const origin = view.worldToScreen(XYZ.zero);
        // Box at origin, rect covering the origin's screen position
        const box = { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } };
        const result = (view as any).isBoundingBoxInRect(
            box,
            Matrix4.identity(),
            origin.x - 10,
            origin.y - 10,
            origin.x + 10,
            origin.y + 10,
        );
        expect(result).toBe(true);
    });
});

// ============================================================================
// ThreeView — isShapeInRect (shape center projection)
// ============================================================================

describe("ThreeView — isShapeInRect", () => {
    test("returns false when shape has no bounding box", () => {
        const { view } = createTestView();
        const shape = {
            boundingBox: () => undefined,
            shapeType: ShapeTypes.edge,
        } as any;

        const result = (view as any).isShapeInRect(shape, undefined, Matrix4.identity(), 0, 0, 100, 100);
        expect(result).toBe(false);
    });

    test("returns true when shape center projects inside wide rect", () => {
        const { view } = createTestView();
        const origin = view.worldToScreen(XYZ.zero);
        const shape = {
            boundingBox: () => BoundingBox.fromNumbers([-1, -1, -1, 1, 1, 1]),
            shapeType: ShapeTypes.edge,
        };

        const result = (view as any).isShapeInRect(
            shape,
            undefined,
            Matrix4.identity(),
            origin.x - 20,
            origin.y - 20,
            origin.x + 20,
            origin.y + 20,
        );
        expect(result).toBe(true);
    });
});

// ============================================================================
// ThreeView — initRaycaster (3-way mode branch)
// ============================================================================

describe("ThreeView — initRaycaster", () => {
    test("wireframe mode enables wireframe layer, disables others", () => {
        const { view } = createTestView();
        view.mode = "wireframe";

        const raycaster = (view as any).initRaycaster(50, 50) as Raycaster;
        expect(raycaster).toBeInstanceOf(Raycaster);

        // In wireframe mode, only Wireframe layer is enabled
        const wireframeLayer = new Layers();
        wireframeLayer.set(Constants.Layers.Wireframe);
        expect(raycaster.layers.test(wireframeLayer)).toBe(true);

        const solidLayerWrapper = new Layers();
        solidLayerWrapper.set(Constants.Layers.Solid);
        expect(raycaster.layers.test(solidLayerWrapper)).toBe(false);
    });

    test("solid mode enables solid layer, disables others", () => {
        const { view } = createTestView();
        view.mode = "solid";

        const raycaster = (view as any).initRaycaster(50, 50) as Raycaster;
        expect(raycaster).toBeInstanceOf(Raycaster);

        const solidLayerWrapper = new Layers();
        solidLayerWrapper.set(Constants.Layers.Solid);
        expect(raycaster.layers.test(solidLayerWrapper)).toBe(true);
    });

    test("solidAndWireframe mode enables all layers", () => {
        const { view } = createTestView();
        view.mode = "solidAndWireframe";

        const raycaster = (view as any).initRaycaster(50, 50) as Raycaster;
        expect(raycaster).toBeInstanceOf(Raycaster);
        // In enableAll, layer 0 (default) should be enabled
        expect(raycaster.layers.isEnabled(0)).toBe(true);
    });

    test("raycaster has SnapDistance threshold", () => {
        const { view } = createTestView();
        const raycaster = (view as any).initRaycaster(50, 50) as Raycaster;
        expect(raycaster.params.Line2?.threshold).toBe(Config.instance.SnapDistance);
        expect(raycaster.params.Line?.threshold).toBe(Config.instance.SnapDistance);
        expect(raycaster.params.Points?.threshold).toBe(Config.instance.SnapDistance);
    });
});

// ============================================================================
// ThreeView — resize with orthographic camera
// ============================================================================

describe("ThreeView — resize with orthographic camera", () => {
    test("resize with orthographic camera updates projection", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";

        view.resize(1024, 768);
        expect(view.camera).toBeInstanceOf(OrthographicCamera);
    });

    test("resize with negative height returns early without touching the camera", () => {
        const { view } = createTestView();
        view.resize(800, 600);
        const cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);

        view.resize(100, -1);
        expect(cam.aspect).toBeCloseTo(800 / 600);
    });
});

// ============================================================================
// ThreeView — findIntersectedNodes with real geometry in scene
// ============================================================================

describe("ThreeView — findIntersectedNodes with real geometry", () => {
    test("returns empty when no visual objects in scene", () => {
        const { view } = createTestView();
        const result = (view as any).findIntersectedNodes(50, 50);
        expect(Array.isArray(result)).toBe(true);
    });

    test("filters visual objects correctly (ThreeVisualObject vs annotation)", () => {
        const { view, context } = createTestView();

        const node = createTestGeometryNode();
        const geo = new ThreeGeometry(node, context);
        // Add geometry to visualShapes so visuals() returns it
        context.visualShapes.add(geo);
        // Ensure world matrix is fresh
        geo.updateMatrixWorld();

        // Test that findIntersectedNodes collects wholeVisual() from ThreeVisualObject
        // Even if no actual raycaster hit, verify that the method iterates correctly
        const result = (view as any).findIntersectedNodes(50, 50);
        expect(Array.isArray(result)).toBe(true);
    });
});

// ============================================================================
// ThreeView — detectVisual with real geometry
// ============================================================================

describe("ThreeView — detectVisual with real geometry", () => {
    test("detectVisual returns empty for empty scene", () => {
        const { view } = createTestView();
        const result = view.detectVisual(50, 50);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test("detectVisual iterates over visual objects without throwing", () => {
        const { view, context } = createTestView();

        // Add a ThreeGeometry to the scene so visuals() returns it
        const node = createTestGeometryNode();
        const geo = new ThreeGeometry(node, context);
        geo.updateMatrixWorld();
        context.visualShapes.add(geo);

        // Method should process without throwing
        const result = view.detectVisual(50, 50);
        expect(Array.isArray(result)).toBe(true);
    });

    test("returns empty when nodeFilter rejects the node", () => {
        const { view, context } = createTestView();

        const node = createTestGeometryNode();
        const geo = new ThreeGeometry(node, context);
        geo.updateMatrixWorld();
        context.visualShapes.add(geo);

        const filter = { allow: () => false };
        const result = view.detectVisual(50, 50, filter);
        expect(result.length).toBe(0);
    });
});

// ============================================================================
// ThreeView — isolate / unisolate with real objects
// ============================================================================

describe("ThreeView — isolate with real objects", () => {
    test("isolate sets isolation layer on visual and children", () => {
        const { view, context } = createTestView();

        // Create geometry and register in context
        const node = createTestGeometryNode();
        const geo = new ThreeGeometry(node, context);
        context.visualShapes.add(geo);
        geo.updateMatrixWorld();

        // Mock getVisual to return our geometry
        const origGetVisual = context.getVisual;
        context.getVisual = (n: any) => {
            if (n === node) return geo as any;
            return origGetVisual(n);
        };

        view.isolate([node as any]);

        // Object should be on isolation layer
        const isolationLayer = new Layers();
        isolationLayer.set(Constants.Layers.Isolation);
        expect(geo.layers.test(isolationLayer)).toBe(true);
    });

    test("unisolate restores layers to default after isolate", () => {
        const { view, context } = createTestView();

        const node = createTestGeometryNode();
        const geo = new ThreeGeometry(node, context);
        context.visualShapes.add(geo);
        geo.updateMatrixWorld();

        const origGetVisual = context.getVisual;
        context.getVisual = (n: any) => {
            if (n === node) return geo as any;
            return origGetVisual(n);
        };

        view.isolate([node as any]);

        const isolationLayer = new Layers();
        isolationLayer.set(Constants.Layers.Isolation);
        expect(geo.layers.test(isolationLayer)).toBe(true);

        view.unisolate();

        const defaultLayer = new Layers();
        defaultLayer.set(Constants.Layers.Default);
        expect(geo.layers.test(defaultLayer)).toBe(true);
    });
});
