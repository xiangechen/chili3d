// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CAMERA_FLY_DURATION, type XYZ } from "@chili3d/core";
import { PerspectiveCamera, Vector3 } from "three";
import type { CameraController } from "../src/cameraController";
import type { ThreeView } from "../src/threeView";
import type { Axis, ViewGizmo } from "../src/viewGizmo";

let ViewGizmoCtor: typeof ViewGizmo;

beforeAll(async () => {
    // Importing the real module registers the "view-gizmo" custom element tag, but the test
    // stub (test/viewGizmo.ts, wired via the "./viewGizmo" alias used by threeView) may have
    // claimed that tag already, depending on test-file evaluation order. Skip duplicate
    // registrations so the import cannot throw in either order.
    const originalDefine = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
        if (!customElements.get(name)) {
            originalDefine(name, ctor, options);
        }
    };
    try {
        ViewGizmoCtor = (await import("../src/viewGizmo")).ViewGizmo;
    } finally {
        customElements.define = originalDefine;
    }
    // Happy-DOM rejects `new` on unregistered custom element classes, so make sure the real
    // class is registered under some tag even when the stub owns "view-gizmo".
    if (customElements.get("view-gizmo") !== ViewGizmoCtor) {
        customElements.define("view-gizmo-real", ViewGizmoCtor);
    }
});

/**
 * Happy-DOM does not implement the 2D canvas context, so stub getContext
 * with a call-counting fake for the duration of these tests.
 */
interface Fake2dContext {
    calls: { clearRect: number; fillText: number; arc: number; stroke: number };
}

let fakeContext: Fake2dContext;
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function createFake2dContext(): Fake2dContext {
    const calls = { clearRect: 0, fillText: 0, arc: 0, stroke: 0 };
    return {
        calls,
        clearRect: () => {
            calls.clearRect++;
        },
        beginPath: () => {},
        arc: () => {
            calls.arc++;
        },
        fill: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {
            calls.stroke++;
        },
        fillText: () => {
            calls.fillText++;
        },
        font: "",
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 0,
        textBaseline: "",
        textAlign: "",
    } as unknown as Fake2dContext;
}

beforeEach(() => {
    fakeContext = createFake2dContext();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() =>
        fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
});

interface MockController {
    camera: PerspectiveCamera;
    target: Vector3;
    rotate: ReturnType<typeof rs.fn>;
    setRotateCenterToSelected: ReturnType<typeof rs.fn>;
    lookAt: ReturnType<typeof rs.fn>;
}

function createGizmo(): { gizmo: ViewGizmo; cc: MockController; update: ReturnType<typeof rs.fn> } {
    const cc: MockController = {
        camera: new PerspectiveCamera(),
        target: new Vector3(0, 0, 0),
        rotate: rs.fn(),
        setRotateCenterToSelected: rs.fn(),
        lookAt: rs.fn(),
    };
    cc.camera.position.set(0, 0, 100);

    const update = rs.fn();
    const view = { cameraController: cc, update } as unknown as ThreeView;
    const gizmo = new ViewGizmoCtor(view);
    return { gizmo, cc, update };
}

function canvasOf(gizmo: ViewGizmo): HTMLCanvasElement {
    return (gizmo as any)._canvas;
}

function axesOf(gizmo: ViewGizmo): Axis[] {
    return (gizmo as any)._axes;
}

function pointerEvent(props: Record<string, unknown>): PointerEvent {
    return { stopPropagation: () => {}, ...props } as unknown as PointerEvent;
}

describe("ViewGizmo — construction and dom", () => {
    test("constructor creates a 200x200 canvas child and absolute positioning", () => {
        const { gizmo, cc } = createGizmo();

        const canvas = canvasOf(gizmo);
        expect(gizmo.children.length).toBe(1);
        expect(gizmo.children[0]).toBe(canvas);
        expect(canvas.width).toBe(200);
        expect(canvas.height).toBe(200);
        expect(gizmo.style.position).toBe("absolute");
        expect(gizmo.cameraController).toBe(cc as unknown as CameraController);
    });

    test("setDom moves the gizmo into the given element", () => {
        const { gizmo } = createGizmo();
        const dom = document.createElement("div");
        document.body.appendChild(dom);
        try {
            gizmo.setDom(dom);
            expect(dom.contains(gizmo)).toBe(true);
            expect(gizmo.parentElement).toBe(dom);
        } finally {
            dom.remove();
        }
    });

    test("dispose removes the gizmo from its parent", () => {
        const { gizmo } = createGizmo();
        const dom = document.createElement("div");
        gizmo.setDom(dom);
        expect(dom.contains(gizmo)).toBe(true);

        gizmo.dispose();
        expect(dom.contains(gizmo)).toBe(false);
    });
});

describe("ViewGizmo — pointer interaction", () => {
    test("pointerenter sets the background, pointerout resets it and clears the mouse", () => {
        const { gizmo } = createGizmo();
        document.body.appendChild(gizmo);
        try {
            canvasOf(gizmo).dispatchEvent(new PointerEvent("pointerenter"));
            expect(gizmo.style.backgroundColor).toBe("rgba(66, 66, 66, .9)");

            (gizmo as any)._mouse = new Vector3(1, 2, 0);
            canvasOf(gizmo).dispatchEvent(new PointerEvent("pointerout"));
            expect(gizmo.style.backgroundColor).toBe("transparent");
            expect((gizmo as any)._mouse).toBeUndefined();
        } finally {
            gizmo.remove();
        }
    });

    test("detached gizmo no longer reacts to canvas events", () => {
        const { gizmo } = createGizmo();
        document.body.appendChild(gizmo);
        gizmo.remove();

        canvasOf(gizmo).dispatchEvent(new PointerEvent("pointerenter"));
        expect(gizmo.style.backgroundColor).toBe("");
    });

    test("left-button drag rotates the camera by 4x the movement", () => {
        const { gizmo, cc, update } = createGizmo();

        (gizmo as any)._onPointerMove(
            pointerEvent({ buttons: 1, movementX: 2, movementY: 3, clientX: 10, clientY: 10 }),
        );

        expect(cc.rotate).toHaveBeenCalledTimes(1);
        expect(cc.rotate.mock.calls[0]).toEqual([8, 12]);
        expect((gizmo as any)._canClick).toBe(false);
        expect(update).toHaveBeenCalledTimes(1);
        // The mouse position is tracked in canvas coordinates, scaled by 2
        expect((gizmo as any)._mouse).toEqual(new Vector3(20, 20, 0));
    });

    test("pointer move without left button only tracks the mouse", () => {
        const { gizmo, cc, update } = createGizmo();

        (gizmo as any)._onPointerMove(
            pointerEvent({ buttons: 0, movementX: 2, movementY: 3, clientX: 5, clientY: 5 }),
        );

        expect(cc.rotate).not.toHaveBeenCalled();
        expect((gizmo as any)._canClick).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test("left-button move without movement keeps the gizmo clickable", () => {
        const { gizmo, cc } = createGizmo();

        (gizmo as any)._onPointerMove(
            pointerEvent({ buttons: 1, movementX: 0, movementY: 0, clientX: 5, clientY: 5 }),
        );

        expect(cc.rotate).not.toHaveBeenCalled();
        expect((gizmo as any)._canClick).toBe(true);
    });

    test("pointerdown captures the pointer and sets the rotate center", () => {
        const { gizmo, cc } = createGizmo();
        const canvas = canvasOf(gizmo);
        canvas.setPointerCapture = rs.fn();
        canvas.releasePointerCapture = rs.fn();

        (gizmo as any)._onPointerDown(pointerEvent({ pointerId: 7 }));
        expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
        expect(cc.setRotateCenterToSelected).toHaveBeenCalledTimes(1);

        (gizmo as any)._onPointerUp(pointerEvent({ pointerId: 7 }));
        expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    });
});

describe("ViewGizmo — click to align camera", () => {
    test("click right after a drag only re-arms clicking", () => {
        const { gizmo, cc } = createGizmo();
        (gizmo as any)._canClick = false;
        (gizmo as any)._selectedAxis = axesOf(gizmo)[0];

        (gizmo as any)._onClick(pointerEvent({}));

        expect((gizmo as any)._canClick).toBe(true);
        expect(cc.lookAt).not.toHaveBeenCalled();
    });

    test("click without a selected axis does nothing", () => {
        const { gizmo, cc } = createGizmo();
        (gizmo as any)._selectedAxis = undefined;

        (gizmo as any)._onClick(pointerEvent({}));

        expect(cc.lookAt).not.toHaveBeenCalled();
        expect(cc.camera.position.toArray()).toEqual([0, 0, 100]);
    });

    test.each([
        ["x", [100, 0, 0], [0, 0, 1]],
        ["-x", [-100, 0, 0], [0, 0, 1]],
        ["y", [0, 100, 0], [0, 0, 1]],
        ["z", [0, 0, 100], [0, 1, 0]],
        ["-z", [0, 0, -100], [0, -1, 0]],
    ])("click on axis %s positions the camera along that axis", (axisName, expectedPos, expectedUp) => {
        const { gizmo, cc, update } = createGizmo();
        const axis = axesOf(gizmo).find((x) => x.axis === axisName);
        expect(axis).toBeDefined();
        (gizmo as any)._selectedAxis = axis;

        (gizmo as any)._onClick(pointerEvent({}));

        expect(cc.lookAt).toHaveBeenCalledTimes(1);
        const [eye, , up, options] = cc.lookAt.mock.calls[0] as unknown as [
            XYZ,
            XYZ,
            XYZ,
            { duration: number },
        ];
        expect(eye.x).toBeCloseTo(expectedPos[0]);
        expect(eye.y).toBeCloseTo(expectedPos[1]);
        expect(eye.z).toBeCloseTo(expectedPos[2]);
        expect(up.x).toBe(expectedUp[0]);
        expect(up.y).toBe(expectedUp[1]);
        expect(up.z).toBe(expectedUp[2]);
        expect(options.duration).toBe(CAMERA_FLY_DURATION);
        expect(update).toHaveBeenCalledTimes(1);
    });
});

describe("ViewGizmo — update rendering", () => {
    test("update clears the canvas and draws all axes with labels", () => {
        const { gizmo } = createGizmo();

        gizmo.update();

        expect(fakeContext.calls.clearRect).toBe(1);
        // 6 axis bubbles, but only the 3 primary axes (x, y, z) draw a line and a label
        expect(fakeContext.calls.arc).toBe(6);
        expect(fakeContext.calls.stroke).toBe(3);
        expect(fakeContext.calls.fillText).toBe(3);
    });

    test("update projects the x axis bubble to the right edge", () => {
        const { gizmo } = createGizmo();

        gizmo.update();

        const xAxis = axesOf(gizmo).find((x) => x.axis === "x")!;
        // center (100, 100) + direction (1, 0, 0) * (100 - bubbleSize/2 - padding)
        expect(xAxis.position.x).toBeCloseTo(100 + (100 - 18 / 2 - 16));
        expect(xAxis.position.y).toBeCloseTo(100);
    });

    test("update selects the axis closest to the mouse within its size", () => {
        const { gizmo } = createGizmo();

        gizmo.update();
        const xAxis = axesOf(gizmo).find((x) => x.axis === "x")!;
        (gizmo as any)._mouse = xAxis.position.clone();

        gizmo.update();
        expect((gizmo as any)._selectedAxis?.axis).toBe("x");
    });

    test("update selects nothing when the mouse is far from every axis", () => {
        const { gizmo } = createGizmo();

        (gizmo as any)._mouse = new Vector3(0, 0, 0);
        gizmo.update();
        expect((gizmo as any)._selectedAxis).toBeUndefined();
    });

    test("selected axis is clickable right after update", () => {
        const { gizmo, cc } = createGizmo();

        gizmo.update();
        const yAxis = axesOf(gizmo).find((x) => x.axis === "y")!;
        (gizmo as any)._mouse = yAxis.position.clone();
        gizmo.update();
        expect((gizmo as any)._selectedAxis?.axis).toBe("y");

        (gizmo as any)._onClick(pointerEvent({}));
        expect(cc.lookAt).toHaveBeenCalledTimes(1);
        const [eye, , , options] = cc.lookAt.mock.calls[0] as unknown as [
            XYZ,
            XYZ,
            XYZ,
            { duration: number },
        ];
        expect(eye.y).toBeCloseTo(100);
        // clicking the cube flies the camera over rather than teleporting it
        expect(options.duration).toBe(CAMERA_FLY_DURATION);
    });
});
