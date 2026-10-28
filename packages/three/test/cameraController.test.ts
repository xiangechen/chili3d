// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type IDocument, type OrbitMode } from "@chili3d/core";
import { createMockSelection } from "@chili3d/core/test-utils";
import {
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Scene,
    Vector3,
} from "three";
import { CameraController } from "../src/cameraController";
import { Constants } from "../src/constants";
import type { ThreeHighlighter } from "../src/threeHighlighter";
import type { ThreeView } from "../src/threeView";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import { ThreeMeshObject } from "../src/threeVisualObject";
import { createTestMeshNode, createThreeMockVisualContext } from "./mocks";

/**
 * Create a minimal fake ThreeView that CameraController needs for its operations.
 * Only the properties/methods actually called by the tested code are provided.
 */
function createFakeView(overrides: Partial<ThreeView> = {}): ThreeView {
    const scene = new Scene();
    const visualShapes = new Object3D();
    scene.add(visualShapes);

    return {
        get mode() {
            return "solidAndWireframe" as const;
        },
        get document(): IDocument {
            return {
                selection: createMockSelection(),
                visual: {
                    context: {
                        visualShapes,
                        getVisual() {
                            return undefined;
                        },
                        getNode() {
                            return undefined;
                        },
                    },
                },
            } as unknown as IDocument;
        },
        screenToCameraRect(_x: number, _y: number) {
            return { x: 0, y: 0 };
        },
        content: {
            visualShapes,
        } as unknown as ThreeVisualContext,
        detectVisual(_x: number, _y: number) {
            return [];
        },
        highlighter: {} as ThreeHighlighter,
        ...overrides,
    } as unknown as ThreeView;
}

// ============================================================================
// CameraController — construction and defaults
// ============================================================================

describe("CameraController — construction", () => {
    test("creates with perspective camera by default", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(cc.cameraType).toBe("perspective");
        expect(cc.camera).toBeInstanceOf(PerspectiveCamera);
    });

    test("camera starts at default position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        // Default position: (1500, 1500, 1500)
        expect(cc.cameraPosition.x).toBeCloseTo(1500);
        expect(cc.cameraPosition.y).toBeCloseTo(1500);
        expect(cc.cameraPosition.z).toBeCloseTo(1500);
    });

    test("target defaults to origin", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(cc.target.x).toBe(0);
        expect(cc.target.y).toBe(0);
        expect(cc.target.z).toBe(0);
    });

    test("cameraUp defaults to Y-up", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        // Three.js cameras default up is (0, 1, 0)
        expect(cc.cameraUp.y).toBeCloseTo(1);
    });
});

// ============================================================================
// CameraController — cameraType switching
// ============================================================================

describe("CameraController — cameraType", () => {
    test("switching to orthographic creates OrthographicCamera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        expect(cc.cameraType).toBe("orthographic");
        expect(cc.camera).toBeInstanceOf(OrthographicCamera);
    });

    test("switching back to perspective", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        cc.cameraType = "perspective";
        expect(cc.cameraType).toBe("perspective");
        expect(cc.camera).toBeInstanceOf(PerspectiveCamera);
    });

    test("setting same cameraType keeps the camera instance", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const camera = cc.camera;
        cc.cameraType = "perspective"; // same as current
        expect(cc.cameraType).toBe("perspective");
        expect(cc.camera).toBe(camera);
    });
});

// ============================================================================
// CameraController — lookAt
// ============================================================================

describe("CameraController — lookAt", () => {
    test("lookAt sets eye position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.lookAt({ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
        expect(cc.cameraPosition.x).toBeCloseTo(100);
        expect(cc.cameraPosition.y).toBeCloseTo(0);
        expect(cc.cameraPosition.z).toBeCloseTo(0);
    });

    test("lookAt sets target", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.lookAt({ x: 100, y: 100, z: 100 }, { x: 10, y: 20, z: 30 }, { x: 0, y: 0, z: 1 });
        expect(cc.target.x).toBeCloseTo(10);
        expect(cc.target.y).toBeCloseTo(20);
        expect(cc.target.z).toBeCloseTo(30);
    });
});

// ============================================================================
// CameraController — setSize
// ============================================================================

describe("CameraController — setSize", () => {
    test("setSize updates aspect ratio for perspective camera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.setSize(800, 600);
        const cam = cc.camera as PerspectiveCamera;
        expect(cam.aspect).toBeCloseTo(800 / 600);
    });

    test("setSize updates the frustum for orthographic camera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        cc.setSize(800, 600);

        const cam = cc.camera as OrthographicCamera;
        const distance = Math.sqrt(3 * 1500 * 1500);
        const halfHeight = distance * Math.tan((25 * Math.PI) / 180);
        expect(cam.top).toBeCloseTo(halfHeight);
        expect(cam.bottom).toBeCloseTo(-halfHeight);
        expect(cam.right / cam.left).toBeCloseTo(-1);
        expect(cam.right / cam.top).toBeCloseTo(800 / 600);
    });
});

// ============================================================================
// CameraController — pan
// ============================================================================

describe("CameraController — pan", () => {
    test("pan moves target from initial position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const origTarget = cc.target.clone();
        cc.pan(100, 0);
        // Target should have moved
        expect(cc.target.x).not.toBeCloseTo(origTarget.x);
    });

    test("pan with zero deltas keeps target and position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.pan(0, 0);
        expect(cc.target.x).toBe(0);
        expect(cc.target.y).toBe(0);
        expect(cc.target.z).toBe(0);
        expect(cc.cameraPosition.x).toBeCloseTo(1500);
        expect(cc.cameraPosition.y).toBeCloseTo(1500);
        expect(cc.cameraPosition.z).toBeCloseTo(1500);
    });
});

// ============================================================================
// CameraController — rotate
// ============================================================================

describe("CameraController — rotate", () => {
    test("rotate changes camera position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const origPos = cc.cameraPosition;
        cc.rotate(10, 0);
        // Rotation should have changed the position
        expect(cc.cameraPosition.x).not.toBeCloseTo(origPos.x);
    });

    test("rotate with zero deltas repositions the camera on the +Z axis of the target", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const distance = Math.sqrt(3 * 1500 * 1500);
        cc.rotate(0, 0);
        // With an identity camera quaternion the eye is placed at target + (0, 0, distance)
        expect(cc.cameraPosition.x).toBeCloseTo(0);
        expect(cc.cameraPosition.y).toBeCloseTo(0);
        expect(cc.cameraPosition.z).toBeCloseTo(distance);
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(distance);
    });
});

// ============================================================================
// CameraController — zoom
// ============================================================================

describe("CameraController — zoom", () => {
    test("zoom changes camera position", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const origDist = cc.cameraPosition.distanceTo(cc.cameraTarget);
        cc.zoom(400, 300, 120);
        const newDist = cc.cameraPosition.distanceTo(cc.cameraTarget);
        // Zoom should change the distance
        expect(newDist).not.toBeCloseTo(origDist);
    });

    test("zoom with zero delta still applies the negative zoom factor", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        const origDist = cc.cameraPosition.distanceTo(cc.cameraTarget);
        cc.zoom(400, 300, 0);
        // delta=0 takes the `delta > 0 ? f : -f` else-branch, so the distance
        // is scaled by (1 - 0.1) instead of staying unchanged.
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(origDist * 0.9);
    });
});

// ============================================================================
// CameraController — startRotate
// ============================================================================

describe("CameraController — startRotate", () => {
    test("startRotate with no selection and no detected shape sets no rotate center", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.startRotate(400, 300);
        expect((cc as any)._rotateCenter).toBeUndefined();

        // Without a rotate center, rotate orbits the target and keeps it fixed
        cc.rotate(10, 0);
        expect(cc.target.x).toBeCloseTo(0);
        expect(cc.target.y).toBeCloseTo(0);
        expect(cc.target.z).toBeCloseTo(0);
    });

    test("selected geometry ignores invalid children when choosing the rotate center", () => {
        const shape = new Object3D();
        const validGeometry = new BufferGeometry();
        validGeometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([10, 10, 10, 20, 20, 20]), 3),
        );
        const invalidGeometry = new BufferGeometry();
        invalidGeometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
        invalidGeometry.computeBoundingBox();
        invalidGeometry.boundingBox!.min.set(Number.NaN, Number.NaN, Number.NaN);
        invalidGeometry.boundingBox!.max.set(Number.NaN, Number.NaN, Number.NaN);
        shape.add(new Mesh(validGeometry, new MeshBasicMaterial()));
        shape.add(new Mesh(invalidGeometry, new MeshBasicMaterial()));

        const node = {};
        const selection = { ...createMockSelection(), getSelectedNodes: () => [node] };
        const document = {
            selection,
            visual: { context: { getVisual: () => shape } },
        } as unknown as IDocument;
        const cc = new CameraController(createFakeView({ document }));

        cc.startRotate(0, 0);
        expect((cc as any)._rotateCenter.toArray()).toEqual([15, 15, 15]);
        cc.rotate(20, 10);
        expect([...cc.cameraPosition.toArray(), ...cc.target.toArray()].every(Number.isFinite)).toBe(true);
    });

    test("detected geometry without a valid box leaves the camera finite", () => {
        const visual = new ThreeMeshObject(createThreeMockVisualContext(), createTestMeshNode());
        const geometry = (visual.mesh as Mesh).geometry;
        geometry.boundingBox!.min.set(Number.NaN, Number.NaN, Number.NaN);
        geometry.boundingBox!.max.set(Number.NaN, Number.NaN, Number.NaN);
        const view = createFakeView({ detectVisual: () => [visual] });
        const cc = new CameraController(view);

        cc.startRotate(0, 0);
        expect((cc as any)._rotateCenter).toBeUndefined();
        cc.rotate(20, 10);
        expect([...cc.cameraPosition.toArray(), ...cc.target.toArray()].every(Number.isFinite)).toBe(true);
    });
});

// ============================================================================
// CameraController — fitContent
// ============================================================================

describe("CameraController — fitContent", () => {
    function addMesh(shapes: Object3D, halfSize: number) {
        const geo = new BufferGeometry();
        const s = halfSize;
        geo.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([-s, -s, -s, s, -s, -s, s, s, s, -s, s, s]), 3),
        );
        const mesh = new Mesh(geo, new MeshBasicMaterial());
        shapes.add(mesh);
        return mesh;
    }

    function addBoxMesh(view: ThreeView, halfSize: number) {
        const geo = new BufferGeometry();
        const s = halfSize;
        geo.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([-s, -s, -s, s, -s, -s, s, s, s, -s, s, s]), 3),
        );
        const mesh = new Mesh(geo, new MeshBasicMaterial());
        (view.content.visualShapes as Object3D).add(mesh);
        return mesh;
    }

    test("fitContent with scope all ignores the selection", () => {
        const visualShapes = new Object3D();
        const selected = addMesh(visualShapes, 1);
        addMesh(visualShapes, 100);
        const selection = { ...createMockSelection(), getSelectedVisualNodes: () => [selected] };
        const context = {
            visualShapes,
            getVisual: (shape: unknown) => shape,
            getNode: () => undefined,
        };
        const view = createFakeView({
            document: { selection, visual: { context } } as unknown as IDocument,
            content: context as unknown as ThreeVisualContext,
        });

        const all = new CameraController(view);
        all.fitContent({ duration: 0, scope: "all" });
        const allDistance = all.cameraPosition.distanceTo(all.cameraTarget);

        const auto = new CameraController(view);
        auto.fitContent({ duration: 0, scope: "auto" });
        const autoDistance = auto.cameraPosition.distanceTo(auto.cameraTarget);

        // "all" frames the 100-half-size body; "auto" would frame only the selected 1-half-size one.
        expect(allDistance).toBeGreaterThan(autoDistance * 10);
    });

    test("fitContent uses the requested aspect to pick the limiting field of view", () => {
        const view = createFakeView();
        addBoxMesh(view, 10);

        const landscape = new CameraController(view);
        landscape.fitContent({ duration: 0, aspect: 2 });
        const landscapeDistance = landscape.cameraPosition.distanceTo(landscape.cameraTarget);

        const portrait = new CameraController(view);
        portrait.fitContent({ duration: 0, aspect: 0.5 });
        const portraitDistance = portrait.cameraPosition.distanceTo(portrait.cameraTarget);

        // A portrait frame is limited by the narrower horizontal half-angle, so it stands farther
        // back than the same content framed for a landscape capture.
        expect(portraitDistance).toBeGreaterThan(landscapeDistance);
    });

    test("fitContent on empty scene falls back to the default sphere radius", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.fitContent();

        // Empty scene produces an invalid sphere, so SHAPE_EMPTY_SIZE (800) is used
        const expectedDistance = 800 / Math.sin((25 * Math.PI) / 180);
        expect(cc.target.x).toBeCloseTo(0);
        expect(cc.target.y).toBeCloseTo(0);
        expect(cc.target.z).toBeCloseTo(0);
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(expectedDistance);
        expect(cc.camera.near).toBeCloseTo(expectedDistance / 1000);
        expect(cc.camera.far).toBeCloseTo(expectedDistance * 100);
    });

    test("fitContent frames the bounding sphere of the scene content", () => {
        const view = createFakeView();
        addBoxMesh(view, 10);
        const cc = new CameraController(view);
        cc.fitContent();

        const radius = Math.sqrt(3 * 10 * 10);
        const expectedDistance = radius / Math.sin((25 * Math.PI) / 180);
        expect(cc.target.x).toBeCloseTo(0);
        expect(cc.target.y).toBeCloseTo(0);
        expect(cc.target.z).toBeCloseTo(0);
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(expectedDistance);
    });

    test("fitContent ignores invalid geometry and completes the camera transition", () => {
        const view = createFakeView();
        addBoxMesh(view, 10);
        const invalidGeometry = new BufferGeometry();
        invalidGeometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
        invalidGeometry.computeBoundingBox();
        invalidGeometry.boundingBox?.min.set(Number.NaN, Number.NaN, Number.NaN);
        invalidGeometry.boundingBox?.max.set(Number.NaN, Number.NaN, Number.NaN);
        (view.content.visualShapes as Object3D).add(new Mesh(invalidGeometry, new MeshBasicMaterial()));
        const cc = new CameraController(view);

        cc.fitContent({ duration: 300 });
        cc.tick(100);
        cc.tick(100);
        cc.tick(100);

        const position = cc.cameraPosition;
        expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
        expect(position.distanceTo(cc.cameraTarget)).toBeCloseTo(
            Math.sqrt(3 * 10 * 10) / Math.sin((25 * Math.PI) / 180),
        );
    });

    test("fitContent ignores reference geometry (datum plane display squares)", () => {
        const visualShapes = new Object3D();
        const part = addMesh(visualShapes, 10);
        const nested = new Object3D();
        visualShapes.add(nested);
        const plane = addMesh(nested, 250);
        const reference = { isReferenceGeometry: true };
        const document = {
            selection: createMockSelection(),
            visual: {
                context: {
                    visualShapes,
                    getNode: (visual: unknown) => (visual === plane ? reference : undefined),
                },
            },
        } as unknown as IDocument;
        const view = createFakeView({
            document,
            content: { visualShapes } as unknown as ThreeVisualContext,
        });
        const cc = new CameraController(view);
        cc.fitContent();

        // The 500 mm datum square must not decide the framing.
        const radius = Math.sqrt(3 * 10 * 10);
        const expectedDistance = radius / Math.sin((25 * Math.PI) / 180);
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(expectedDistance);
        expect(part.parent).toBe(visualShapes);
    });

    test("fitContent with orthographic camera updates the frustum", () => {
        const view = createFakeView();
        addBoxMesh(view, 10);
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        cc.fitContent();

        const radius = Math.sqrt(3 * 10 * 10);
        const expectedDistance = radius / Math.sin((25 * Math.PI) / 180);
        const cam = cc.camera as OrthographicCamera;
        expect(cam.top).toBeCloseTo(expectedDistance * Math.tan((25 * Math.PI) / 180));
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(expectedDistance);
    });
});

// ============================================================================
// CameraController — setCameraLayer
// ============================================================================

describe("CameraController — setCameraLayer", () => {
    test("wireframe mode enables wireframe layer", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.setCameraLayer(cc.camera, "wireframe");
        expect(cc.camera.layers.isEnabled(Constants.Layers.Wireframe)).toBe(true);
    });

    test("solid mode enables solid layer", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.setCameraLayer(cc.camera, "solid");
        expect(cc.camera.layers.isEnabled(Constants.Layers.Solid)).toBe(true);
    });

    test("solidAndWireframe mode enables all layers", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.setCameraLayer(cc.camera, "solidAndWireframe");
        // Both layers should be enabled
        expect(cc.camera.layers.isEnabled(Constants.Layers.Wireframe)).toBe(true);
        expect(cc.camera.layers.isEnabled(Constants.Layers.Solid)).toBe(true);
    });
});

// ============================================================================
// CameraController — updateCameraPosionTarget
// ============================================================================

describe("CameraController — updateCameraPosionTarget", () => {
    test("updateCameraPosionTarget syncs camera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.lookAt({ x: 200, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
        expect(cc.camera.position.x).toBeCloseTo(200);
    });
});

// ============================================================================
// CameraController — orbit mode
// ============================================================================

describe("CameraController — orbit mode", () => {
    const originalOrbitMode = Config.instance.orbitMode;

    afterEach(() => {
        Config.instance.orbitMode = originalOrbitMode;
    });

    function withOrbitMode(mode: OrbitMode) {
        Config.instance.orbitMode = mode;
        const cc = new CameraController(createFakeView());
        // Start from the pose the app opens on rather than the controller's un-oriented identity state.
        cc.lookAt({ x: 1500, y: 1500, z: 1500 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
        return cc;
    }

    function drag(cc: CameraController, times: number, dx: number, dy: number) {
        for (let index = 0; index < times; index++) cc.rotate(dx, dy);
    }

    /** How far the world Z axis has rolled off the screen's vertical, in the camera's own frame. */
    function roll(cc: CameraController) {
        return new Vector3(0, 0, 1).applyQuaternion(cc.camera.quaternion.clone().invert()).x;
    }

    function horizontalDragAfterPitch(mode: OrbitMode) {
        const cc = withOrbitMode(mode);
        drag(cc, 7, 0, 25);
        const pitched = { up: cc.cameraUp, position: cc.cameraPosition };
        cc.rotate(30, 0);
        return { pitched, up: cc.cameraUp, position: cc.cameraPosition };
    }

    test("a turntable drag cannot roll the view off the world's vertical", () => {
        const cc = withOrbitMode("turntable");
        drag(cc, 6, 40, 25);

        // World Z stays in the plane the screen's vertical axis spans: the view never tilts sideways.
        expect(roll(cc)).toBeCloseTo(0, 6);
    });

    test("a trackball drag rolls the view off the world's vertical", () => {
        const cc = withOrbitMode("trackball");
        drag(cc, 6, 40, 25);

        expect(Math.abs(roll(cc))).toBeGreaterThan(0.5);
    });

    test("switching back to the turntable stops adding roll without straightening the view", () => {
        const cc = withOrbitMode("trackball");
        drag(cc, 6, 40, 25);
        const rolled = roll(cc);
        expect(Math.abs(rolled)).toBeGreaterThan(0.5);

        // A settings change re-aims the drag, not the pose on screen: the view stays rolled,
        // and the turntable's promise is only that its own drags add no further roll.
        Config.instance.orbitMode = "turntable";
        drag(cc, 6, 40, 25);
        expect(roll(cc)).toBeCloseTo(rolled, 6);
    });

    test("a trackball yaw turns about the camera's own up, a turntable yaw about world Z", () => {
        const trackball = horizontalDragAfterPitch("trackball");
        // The drag did turn the camera around its target...
        expect(trackball.position.x).not.toBeCloseTo(trackball.pitched.position.x);
        // ...about its own up axis, which the turn therefore leaves where it was.
        expect(trackball.up.x).toBeCloseTo(trackball.pitched.up.x);
        expect(trackball.up.y).toBeCloseTo(trackball.pitched.up.y);
        expect(trackball.up.z).toBeCloseTo(trackball.pitched.up.z);

        const turntable = horizontalDragAfterPitch("turntable");
        expect(turntable.up.x).not.toBeCloseTo(turntable.pitched.up.x);
    });
});

// ============================================================================
// CameraController — transitions
// ============================================================================

describe("CameraController — transitions", () => {
    function advance(cc: CameraController, steps = 3) {
        for (let i = 0; i < steps; i++) {
            cc.tick(100);
        }
    }

    test("no transition is running on a fresh controller", () => {
        const cc = new CameraController(createFakeView());
        expect(cc.tick(16)).toBe(false);
    });

    test("a fly-to holds the camera until frames arrive", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 300, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });

        expect(cc.cameraPosition.x).toBeCloseTo(1500);
    });

    test("a fly-to lands on the requested pose and then reports itself done", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 300, y: 40, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });

        expect(cc.tick(100)).toBe(true);
        expect(cc.tick(100)).toBe(true);
        expect(cc.tick(100)).toBe(true);

        expect(cc.cameraPosition.x).toBeCloseTo(300);
        expect(cc.cameraPosition.y).toBeCloseTo(40);
        expect(cc.cameraTarget.x).toBeCloseTo(10);
        expect(cc.tick(16)).toBe(false);
    });

    test("settle lands on the pose a fly-to was heading to", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 300, y: 40, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 1000 });
        expect(cc.tick(100)).toBe(true);

        cc.settle();

        // The destination, not the midpoint the frame happened to be at.
        expect(cc.cameraPosition.x).toBeCloseTo(300);
        expect(cc.cameraPosition.y).toBeCloseTo(40);
        expect(cc.cameraTarget.x).toBeCloseTo(10);
        expect(cc.tick(16)).toBe(false);
    });

    test("a late frame cannot skip the rest of a fly-to", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });

        cc.tick(10_000); // a background tab waking up

        expect(cc.cameraPosition.z).toBeGreaterThan(1000);
        expect(cc.cameraPosition.z).toBeLessThan(1500);
    });

    test("a fly-to turns the up vector instead of snapping it", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { duration: 300 });

        cc.tick(150);

        const up = cc.cameraUp;
        expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1);
        expect(up.x).toBeGreaterThan(0);
        expect(up.x).toBeLessThan(1);
    });

    test("an orthographic fly-to keeps the frustum in step with the distance", () => {
        const cc = new CameraController(createFakeView());
        cc.cameraType = "orthographic";
        cc.lookAt({ x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });

        advance(cc);

        expect((cc.camera as OrthographicCamera).top).toBeCloseTo(200 * Math.tan((25 * Math.PI) / 180));
    });

    test("fitContent with a duration flies rather than snapping", () => {
        const cc = new CameraController(createFakeView());
        const distance = 800 / Math.sin((25 * Math.PI) / 180);

        cc.fitContent({ duration: 300 });
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(Math.hypot(1500, 1500, 1500));

        advance(cc);
        expect(cc.cameraPosition.distanceTo(cc.cameraTarget)).toBeCloseTo(distance);
    });

    test("a fitContent right after a lookAt frames the direction the lookAt asked for", () => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });
        cc.fitContent({ duration: 300 });

        advance(cc);

        // the top-down axis survives: the framing must not average in the pose the camera is
        // mid-way from, which would leave it parked off to the side
        expect(cc.cameraPosition.x).toBeCloseTo(0);
        expect(cc.cameraPosition.y).toBeCloseTo(0);
        expect(cc.cameraPosition.z).toBeCloseTo(800 / Math.sin((25 * Math.PI) / 180));
    });

    test.each([
        ["pan", (cc: CameraController) => cc.pan(10, 10)],
        ["rotate", (cc: CameraController) => cc.rotate(10, 10)],
        ["zoom", (cc: CameraController) => cc.zoom(50, 50, 5)],
        ["startRotate", (cc: CameraController) => cc.startRotate(50, 50)],
    ])("%s takes the camera over from a fly-to in flight", (_name, takeOver) => {
        const cc = new CameraController(createFakeView());
        cc.lookAt({ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { duration: 300 });
        cc.tick(100);

        takeOver(cc);
        const position = cc.cameraPosition;

        expect(cc.tick(100)).toBe(false);
        expect(cc.cameraPosition.z).toBeCloseTo(position.z);
    });
});
