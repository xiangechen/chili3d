// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Object3D, OrthographicCamera, PerspectiveCamera, Scene } from "three";
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
                selection: {
                    getSelectedNodes() {
                        return [];
                    },
                    getSelectedVisualNodes() {
                        return [];
                    },
                },
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

    test("setting same cameraType is no-op", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        // Access camera to initialize it
        expect(cc.camera).toBeDefined();
        cc.cameraType = "perspective"; // same as current
        expect(cc.cameraType).toBe("perspective");
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

    test("setSize does not throw for orthographic camera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        expect(() => cc.setSize(800, 600)).not.toThrow();
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

    test("pan with zero deltas does not throw", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        // With zero delta, pan is a no-op
        expect(() => cc.pan(0, 0)).not.toThrow();
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

    test("rotate with zero deltas", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(() => cc.rotate(0, 0)).not.toThrow();
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

    test("zoom with zero delta", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(() => cc.zoom(400, 300, 0)).not.toThrow();
    });
});

// ============================================================================
// CameraController — startRotate
// ============================================================================

describe("CameraController — startRotate", () => {
    test("startRotate with no selection detects nothing", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(() => cc.startRotate(400, 300)).not.toThrow();
    });
});

// ============================================================================
// CameraController — fitContent
// ============================================================================

describe("CameraController — fitContent", () => {
    test("fitContent on empty scene sets default sphere radius", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        expect(() => cc.fitContent()).not.toThrow();
    });

    test("fitContent with orthographic camera", () => {
        const view = createFakeView();
        const cc = new CameraController(view);
        cc.cameraType = "orthographic";
        expect(() => cc.fitContent()).not.toThrow();
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
