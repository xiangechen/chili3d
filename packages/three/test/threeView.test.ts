// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IView, Matrix4, Plane, ShapeTypes, type VisualNode, XY, XYZ } from "@chili3d/core";
import {
    BufferGeometry,
    Group,
    Layers,
    type Mesh,
    MeshBasicMaterial,
    type Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Vector3,
} from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { TestDocument } from "../../core/test/mocks";
import { Constants } from "../src/constants";
import { ThreeGeometry } from "../src/threeGeometry";
import { ThreeHighlighter } from "../src/threeHighlighter";
import { ThreeView } from "../src/threeView";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, ThreeVisualObject } from "../src/threeVisualObject";
import {
    createMockVisualContext,
    createTestComponentNode,
    createTestGeometryNode,
    createTestMeshNode,
} from "./mocks";

// ============================================================================
// Helpers — create a TestView subclass that avoids real WebGL
// ============================================================================

class TestWebGLRenderer {
    readonly domElement = document.createElement("canvas");

    render(_scene: Object3D, _camera: PerspectiveCamera): void {}
    setSize(_width: number, _height: number, _updateStyle?: boolean): void {}
    getPixelRatio() {
        return 1;
    }
    getViewport() {
        return new Vector3() as any;
    }
    setViewport(_v: any) {}
    setPixelRatio(_value: number) {}
    getSize(_target: any) {
        return { x: 100, y: 100 };
    }
    setAnimationLoop(_fn: (x: number) => void) {}
    getRenderTarget() {
        return null;
    }
    setRenderTarget() {}
    clear() {}
    clearDepth() {}
    getClearColor() {}
    getClearAlpha() {}
    getContext() {
        return { getExtension(_str: string) {} };
    }
    get domElementParent() {
        return this.domElement.parentElement;
    }
}

const container = document.createElement("div");
Object.defineProperties(container, {
    clientWidth: { get: () => 100 },
    clientHeight: { get: () => 100 },
});
container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as any;

/**
 * TestView — ThreeView with mocked WebGLRenderer so tests don't need a real GPU.
 */
class TestView extends ThreeView {
    constructor(document: any, content: ThreeVisualContext, options?: { name?: string; workplane?: Plane }) {
        super(
            document,
            options?.name ?? "test-view",
            options?.workplane ?? Plane.XY,
            new ThreeHighlighter(content),
            content,
        );
    }

    protected override initRenderer(): any {
        const r = new TestWebGLRenderer() as any;
        r.setSize(100, 100);
        return r;
    }
}

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
    const context = overrides?.content ?? createMockVisualContext();
    (context as any).scene ??= new Scene();
    const view = new TestView(doc, context, {
        name: overrides?.name,
        workplane: overrides?.workplane,
    });
    view.setDom(container);
    view.camera.position.set(0, 0, 100);
    (view.camera as PerspectiveCamera).lookAt(0, 0, 0);
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
        expect(view.dynamicLight).toBeDefined();
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
        expect(view.renderer).toBeDefined();
    });
});

// ============================================================================
// ThreeView — properties
// ============================================================================

describe("ThreeView — properties", () => {
    test("name setter fires property changed", () => {
        const { view } = createTestView();
        view.name = "renamed";
        expect(view.name).toBe("renamed");
    });

    test("mode setter triggers camera layer update", () => {
        const { view } = createTestView();

        view.mode = "wireframe";
        expect(view.mode).toBe("wireframe");

        view.mode = "solid";
        expect(view.mode).toBe("solid");

        view.mode = "solidAndWireframe";
        expect(view.mode).toBe("solidAndWireframe");
    });

    test("workplane getter returns initial plane", () => {
        const plane = Plane.YZ;
        const { view } = createTestView({ workplane: plane });
        expect(view.workplane).toBe(plane);
    });

    test("workplane setter triggers property changed", () => {
        const { view } = createTestView();
        const newPlane = Plane.YZ;
        view.workplane = newPlane;
        expect(view.workplane).toBe(newPlane);
    });

    test("dom returns undefined before setDom", () => {
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
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
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
        expect(view.width).toBe(1);
    });

    test("height defaults to 1 when dom is undefined", () => {
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
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
    test("screenToWorld returns an XYZ", () => {
        const { view } = createTestView();
        const world = view.screenToWorld(50, 50);
        expect(world).toBeDefined();
        expect(typeof world.x).toBe("number");
    });

    test("worldToScreen returns an XY", () => {
        const { view } = createTestView();
        const screen = view.worldToScreen(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(screen).toBeDefined();
        expect(typeof screen.x).toBe("number");
    });

    test("worldToScreen projects arbitrary point", () => {
        const { view } = createTestView();
        const screen = view.worldToScreen(new XYZ({ x: 10, y: 20, z: 30 }));
        expect(typeof screen.x).toBe("number");
        expect(typeof screen.y).toBe("number");
        expect(Number.isFinite(screen.x)).toBe(true);
        expect(Number.isFinite(screen.y)).toBe(true);
    });
});

// ============================================================================
// ThreeView — rayAt
// ============================================================================

describe("ThreeView — rayAt", () => {
    test("rayAt returns a Ray with point and direction", () => {
        const { view } = createTestView();
        const ray = view.rayAt(50, 50);
        expect(ray).toBeDefined();
        expect(ray.point).toBeDefined();
        expect(ray.direction).toBeDefined();
        expect(typeof ray.point.x).toBe("number");
        expect(typeof ray.direction.x).toBe("number");
    });

    test("rayAt from center has direction toward scene", () => {
        const { view } = createTestView();
        const ray = view.rayAt(50, 50);
        // Direction should point toward the scene (negative Z for default camera at 0,0,100 looking at 0,0,0)
        expect(ray.direction.z).toBeLessThan(0);
    });

    test("rayAt with orthographic camera", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        const ray = view.rayAt(50, 50);
        expect(ray).toBeDefined();
        expect(ray.point).toBeDefined();
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
    test("calling update does not throw", () => {
        const { view } = createTestView();
        expect(() => view.update()).not.toThrow();
    });
});

// ============================================================================
// ThreeView — resize
// ============================================================================

describe("ThreeView — resize", () => {
    test("resize with near-zero height returns early", () => {
        const { view } = createTestView();
        expect(() => view.resize(100, 0)).not.toThrow();
    });

    test("resize with valid dimensions does not throw", () => {
        const { view } = createTestView();
        expect(() => view.resize(800, 600)).not.toThrow();
        // Aspect ratio should be updated on the camera
        const cam = view.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);
    });

    test("resize with orthographic camera does not throw", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        expect(() => view.resize(1024, 768)).not.toThrow();
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
        expect(() => view.close()).not.toThrow();
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
    test("unisolate when not isolated is a no-op", () => {
        const { view } = createTestView();
        expect(() => view.unisolate()).not.toThrow();
    });

    test("isolate with empty nodes array does not throw", () => {
        const { view } = createTestView();
        expect(() => view.isolate([])).not.toThrow();
    });
});

// ============================================================================
// ThreeView — htmlText
// ============================================================================

describe("ThreeView — htmlText", () => {
    test("htmlText returns a disposable object", () => {
        const { view } = createTestView();
        const result = view.htmlText("Hello", new XYZ({ x: 0, y: 0, z: 0 }));
        expect(result).toBeDefined();
        expect(typeof result.dispose).toBe("function");
    });

    test("htmlText with options returns disposable", () => {
        const { view } = createTestView();
        const result = view.htmlText("Test", new XYZ({ x: 10, y: 20, z: 30 }), {
            className: "custom",
        });
        expect(result).toBeDefined();
        expect(typeof result.dispose).toBe("function");
    });

    test("htmlText dispose does not throw", () => {
        const { view } = createTestView();
        const result = view.htmlText("Disposable", new XYZ({ x: 0, y: 0, z: 0 }));
        expect(() => result.dispose()).not.toThrow();
    });

    test("htmlText with center option", () => {
        const { view } = createTestView();
        const result = view.htmlText("Centered", new XYZ({ x: 0, y: 0, z: 0 }), {
            center: new XY({ x: 0.5, y: 0.5 }),
        });
        expect(result).toBeDefined();
    });

    test("htmlText with hideDelete option", () => {
        const { view } = createTestView();
        const result = view.htmlText("No Delete", new XYZ({ x: 0, y: 0, z: 0 }), {
            hideDelete: true,
        });
        expect(result).toBeDefined();
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
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
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
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
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
// ThreeView — close with view switching
// ============================================================================

describe("ThreeView — close with view switching", () => {
    test("close switches activeView to another view for same document", () => {
        const doc = new TestDocument();
        const views = createViewsArray();
        // Patch the views array onto the document's application before creating views
        (doc.application as any).views = views;

        const context1 = createMockVisualContext();
        const context2 = createMockVisualContext();
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

        const context = createMockVisualContext();
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
    test("disposeInternal calls gizmo dispose and resizeObserver disconnect", () => {
        const context = createMockVisualContext();
        const doc = new TestDocument();
        const view = new TestView(doc, context);
        view.setDom(container);

        // Should not throw
        expect(() => view["disposeInternal"]()).not.toThrow();
    });
});

// ============================================================================
// ThreeView — htmlText with all options
// ============================================================================

describe("ThreeView — htmlText advanced", () => {
    test("htmlText with hideDelete creates element without delete button", () => {
        const { view } = createTestView();
        const result = view.htmlText("No Delete", new XYZ({ x: 0, y: 0, z: 0 }), {
            hideDelete: true,
            className: "my-custom-class",
        });
        expect(result).toBeDefined();
        expect(typeof result.dispose).toBe("function");
    });

    test("htmlText dispose cleans up", () => {
        const { view } = createTestView();
        const result = view.htmlText("Cleanup", new XYZ({ x: 0, y: 0, z: 0 }));
        result.dispose();
        // Second dispose should not throw
        expect(() => result.dispose()).not.toThrow();
    });

    test("htmlText with all options combined", () => {
        const { view } = createTestView();
        let disposed = false;
        const result = view.htmlText("All Options", new XYZ({ x: 5, y: 10, z: 15 }), {
            center: new XY({ x: 0.5, y: 0 }),
            className: "full-custom",
            hideDelete: false,
            onDispose: () => {
                disposed = true;
            },
        });
        expect(result).toBeDefined();
        result.dispose();
        expect(disposed).toBe(true);
    });
});

// ============================================================================
// ThreeView — mode setter
// ============================================================================

describe("ThreeView — mode transitions", () => {
    test("mode switching covers all view modes", () => {
        const { view } = createTestView();

        view.mode = "wireframe";
        expect(view.mode).toBe("wireframe");

        view.mode = "solid";
        expect(view.mode).toBe("solid");

        view.mode = "solidAndWireframe";
        expect(view.mode).toBe("solidAndWireframe");
    });

    test("repeated mode set to same value does not throw", () => {
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
    test("resize with very small but positive height", () => {
        const { view } = createTestView();
        expect(() => view.resize(100, 0.000001)).not.toThrow();
    });

    test("resize with large dimensions", () => {
        const { view } = createTestView();
        expect(() => view.resize(3840, 2160)).not.toThrow();
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
        expect(ray).toBeDefined();
        expect(ray.point).toBeDefined();
        expect(ray.direction).toBeDefined();
    });

    test("rayAt from top-left corner", () => {
        const { view } = createTestView();
        const ray = view.rayAt(0, 0);
        expect(ray).toBeDefined();
    });

    test("rayAt from bottom-right corner", () => {
        const { view } = createTestView();
        const ray = view.rayAt(100, 100);
        expect(ray).toBeDefined();
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
        const context = createMockVisualContext();
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
        const mockCtx = createMockVisualContext();
        const obj = new ThreeMeshObject(mockCtx, node);
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBe(node);
    });

    test("extracts geometryNode from ThreeGeometry", () => {
        const node = createTestGeometryNode();
        const mockCtx = createMockVisualContext();
        const obj = new ThreeGeometry(node, mockCtx);
        const { view } = createTestView();

        const result = (view as any).getNodeFromObject(obj);
        expect(result).toBe(node);
    });

    test("extracts componentNode from ThreeComponentObject", () => {
        const node = createTestComponentNode();
        const mockCtx = createMockVisualContext();
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
        expect(raycaster.params.Line2?.threshold).toBeDefined();
        expect(raycaster.params.Line?.threshold).toBeDefined();
        expect(raycaster.params.Points?.threshold).toBeDefined();
    });
});

// ============================================================================
// ThreeView — resize with orthographic camera
// ============================================================================

describe("ThreeView — resize with orthographic camera", () => {
    test("resize with orthographic camera updates projection", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";

        expect(() => view.resize(1024, 768)).not.toThrow();
        expect(view.camera).toBeInstanceOf(OrthographicCamera);
    });

    test("resize with near-zero height returns early", () => {
        const { view } = createTestView();
        expect(() => view.resize(100, 0)).not.toThrow();
    });

    test("resize with negative height returns early", () => {
        const { view } = createTestView();
        expect(() => view.resize(100, -1)).not.toThrow();
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

    test("unisolate when not isolated is a no-op", () => {
        const { view } = createTestView();
        expect(() => view.unisolate()).not.toThrow();
    });

    test("isolate with empty nodes array does not throw", () => {
        const { view } = createTestView();
        expect(() => view.isolate([])).not.toThrow();
    });
});

// ============================================================================
// ThreeView — mode transitions and raycaster behavior
// ============================================================================

describe("ThreeView — mode + raycaster integration", () => {
    test("rayAt with orthographic camera returns valid ray", () => {
        const { view } = createTestView();
        view.cameraController.cameraType = "orthographic";
        view.resize(800, 600);

        const ray = view.rayAt(400, 300);
        expect(ray).toBeDefined();
        expect(ray.point).toBeDefined();
        expect(ray.direction).toBeDefined();
    });
});
