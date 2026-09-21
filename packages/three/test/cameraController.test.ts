// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
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
} from "three";
import { CameraController } from "../src/cameraController";
import { Constants } from "../src/constants";
import type { ThreeHighlighter } from "../src/threeHighlighter";
import type { ThreeView } from "../src/threeView";
import type { ThreeVisualContext } from "../src/threeVisualContext";

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
});

// ============================================================================
// CameraController — fitContent
// ============================================================================

describe("CameraController — fitContent", () => {
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
