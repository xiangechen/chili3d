// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IView } from "../src";
import { Plane, Ray, XY, XYZ } from "../src/math";
import { TestDocument } from "./testDocument";

/**
 * Creates a mock IView with sensible defaults for snap-related unit tests.
 * All detection methods return empty arrays; rayAt/screenToWorld use
 * parameterized transformations for realistic test scenarios.
 */
export function createMockView(overrides?: Partial<IView>): IView {
    const document = new TestDocument();
    return {
        document,
        cameraController: {
            onPropertyChanged: () => {},
            removePropertyChanged: () => {},
        } as never,
        isClosed: false,
        width: 800,
        height: 600,
        mode: "solid",
        name: "test-view",
        workplane: Plane.XY,
        update: () => {},
        up: () => XYZ.unitZ,
        toImage: () => "",
        direction: () => XYZ.unitY.reverse(),
        rayAt: (mx: number, my: number) =>
            new Ray({
                point: new XYZ({ x: mx - 400, y: 300 - my, z: 500 }),
                direction: XYZ.unitZ.reverse(),
            }),
        screenToWorld: (mx: number, my: number) => new XYZ({ x: mx - 400, y: 300 - my, z: 0 }),
        worldToScreen: (point: XYZ) => new XY({ x: point.x + 400, y: point.y + 300 }),
        isolate: () => {},
        unisolate: () => {},
        resize: () => {},
        setDom: () => {},
        htmlText: () => ({ dispose: () => {} }),
        close: () => {},
        detectVisual: () => [],
        detectVisualRect: () => [],
        detectShapes: () => [],
        detectShapesRect: () => [],
        getNodes: () => [],
        getAllNodes: () => [],
        getSelectedNodes: () => [],
        setSelectedNodes: () => {},
        setSelectedShapes: () => {},
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        dispose: () => {},
        ...overrides,
    } as unknown as IView;
}

/**
 * Like createMockView, but with no-op rayAt/screenToWorld by default.
 * Handler tests that need real ray intersections should override these.
 */
export function createHandlerMockView(overrides?: Partial<IView>): IView {
    return createMockView({
        rayAt: () => new Ray({ point: XYZ.zero, direction: new XYZ({ x: 0, y: 0, z: -1 }) }),
        screenToWorld: () => XYZ.zero,
        ...overrides,
    });
}
