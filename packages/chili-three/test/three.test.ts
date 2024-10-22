// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { expect, jest, test } from "@jest/globals";
import { Material, ShapeNode, ShapeType, XY, XYZ } from "chili-core";
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
        context.addModel([model]);
        expect(context.getShape(model)).not.toBeNull();
        let mouse = view.worldToScreen(new XYZ(50, 0, 0));
        let shapes = view.detected(ShapeType.Shape, mouse.x, mouse.y);
        expect(shapes.length).toEqual(1);
        expect(shapes[0].shape.shapeType).toBe(ShapeType.Edge);

        let shape = context.getShape(model);
        expect(shapes.at(0)?.shape).toEqual((shape?.geometryNode as ShapeNode).shape.value);
        expect(context.getModel(shape!)).toEqual(model);

        context.removeModel([model]);
        expect(view.detected(ShapeType.Shape, mouse.x, mouse.y).length).toEqual(0);
    });
});
