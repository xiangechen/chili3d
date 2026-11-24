// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, rs, test } from "@rstest/core";
import { ArrowHandle, MeshDataUtils, nearestHandle, projectAxisValue, XYZ } from "../src";
import { createMockDocument, createMockView } from "../test-utils";

describe("nearestHandle", () => {
    const handles = [{ role: "first" as const }, { role: "second" as const }];

    test("ties go to the first handle in the list", () => {
        // two handles sharing an anchor sit at distance 0 together; the first is the one the
        // tool draws first, so the choice must not depend on iteration order drifting
        expect(nearestHandle(handles, () => 0)).toBe("first");
    });

    test("a strictly nearer handle wins", () => {
        expect(nearestHandle(handles, (handle) => (handle.role === "first" ? 8 : 2))).toBe("second");
    });

    test("the tolerance edge still counts, one pixel past it does not", () => {
        expect(nearestHandle(handles, () => 10)).toBe("first");
        expect(nearestHandle(handles, () => 10.001)).toBeUndefined();
    });
});

describe("projectAxisValue", () => {
    test("returns the signed distance from the axis origin", () => {
        const view = createMockView();
        const event = { offsetX: 440, offsetY: 300 } as PointerEvent;

        expect(projectAxisValue(view, XYZ.zero, XYZ.unitX, event)).toBeCloseTo(40, 6);
    });
});

describe("ArrowHandle", () => {
    test("tracks screen size, replaces meshes and releases camera listeners", () => {
        const document = createMockDocument();
        const displayed: number[] = [];
        document.visual.context.displayMesh = rs.fn(() => {
            displayed.push(displayed.length + 1);
            return displayed.length;
        });
        const removeMesh = rs.fn();
        document.visual.context.removeMesh = removeMesh;
        const removeCamera = rs.fn();
        let cameraChanged = () => {};
        const view = createMockView({
            document,
            direction: () => XYZ.unitNZ,
            up: () => XYZ.unitY,
            cameraController: {
                onPropertyChanged: (handler: () => void) => (cameraChanged = handler),
                removePropertyChanged: removeCamera,
            } as never,
        });
        const onCameraChanged = rs.fn();
        const handle = new ArrowHandle(document, onCameraChanged, true);

        handle.updateScale(view, XYZ.zero, XYZ.unitX);
        expect(handle.handleLength).toBeCloseTo(80, 6);
        handle.replace([
            { data: MeshDataUtils.createEdgeMesh(XYZ.zero, XYZ.unitX, 1, "solid") },
            { data: MeshDataUtils.createVertexMesh(XYZ.zero, 6, 1), kind: "vertex" },
        ]);

        expect(displayed).toEqual([1, 2]);
        const options = (document.visual.context.displayMesh as ReturnType<typeof rs.fn>).mock.calls.map(
            (call) => call[1],
        );
        expect(options.every((option) => option?.unlit === true && option?.onTop === true)).toBe(true);
        expect(options[1]?.vertexOpacity).toBe(1);

        cameraChanged();
        expect(onCameraChanged).toHaveBeenCalledWith(view);
        handle.dispose();

        expect(removeMesh.mock.calls).toEqual([[1], [2]]);
        expect(removeCamera).toHaveBeenCalledOnce();
    });
});
