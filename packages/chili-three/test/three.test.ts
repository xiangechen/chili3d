// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { expect, jest, test } from "@jest/globals";
import { IVisualGeometry, Material, ShapeNode, ShapeType, XY, XYZ } from "chili-core";
import { TestDocument } from "./testDocument";
import { TestNode } from "./testEdge";
import { TestView } from "./testView";

jest.mock("../src/threeRenderBuilder", () => ({
    ThreeRenderBuilder: jest.fn(),
}));

(global as any).ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
}));

describe("three test", () => {
    let doc = new TestDocument();
    doc.materials.push(new Material(doc, "test", 0x00ff00));
    let view = new TestView(doc, doc.visual.context);

    test("test view", () => {
        expect(view.screenToCameraRect(0, 0)).toEqual(new XY(-1, 1));
        expect(view.screenToCameraRect(100, 100)).toEqual(new XY(1, -1));
        let world = view.screenToWorld(50, 50);
        expect(view.worldToScreen(world)).toEqual(new XY(50, 50));
    });

    test("test context", () => {
        let context = doc.visual.context;
        let model = new TestNode(doc, XYZ.zero, new XYZ(100, 0, 0));
        context.addNode([model]);
        expect(context.getVisual(model)).not.toBeNull();
        let mouse = view.worldToScreen(new XYZ(50, 0, 0));
        let shapes = view.detectShapes(ShapeType.Shape, mouse.x, mouse.y);
        expect(shapes.length).toEqual(1);
        expect(shapes[0].shape.shapeType).toBe(ShapeType.Edge);

        let shape = context.getVisual(model) as IVisualGeometry;
        expect(shapes.at(0)?.shape).toEqual((shape?.geometryNode as ShapeNode).shape.value);
        expect(context.getNode(shape)).toEqual(model);

        context.removeNode([model]);
        expect(view.detectShapes(ShapeType.Shape, mouse.x, mouse.y).length).toEqual(0);
    });
});
