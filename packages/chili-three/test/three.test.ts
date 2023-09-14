// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { expect, test } from "@jest/globals";
import { GeometryModel, ShapeType, XY, XYZ } from "chili-core";
import { TestDocument } from "./testDocument";
import { TestBody } from "./testEdge";
import { TestView } from "./testView";

describe("three test", () => {
    let doc = new TestDocument();
    let view = new TestView(doc.visual.viewer, doc.visual.scene);

    test("test view", () => {
        view.lookAt(new XYZ(0, 0, 10), new XYZ(0, 0, 0));
        expect(view.screenToCameraRect(0, 0)).toEqual(new XY(-1, 1));
        expect(view.screenToCameraRect(100, 100)).toEqual(new XY(1, -1));
        let world = view.screenToWorld(0, 0);
        expect(view.worldToScreen(world)).toEqual(new XY(0, 0));
    });

    test("test context", () => {
        let context = doc.visual.context;
        let body = new TestBody(doc, XYZ.zero, new XYZ(100, 0, 0));
        let model = new GeometryModel(doc, "test model", body);
        context.addModel([model]);
        expect(context.getShape(model)).not.toBeNull();
        let mouse = view.worldToScreen(new XYZ(100, 0, 0));
        let shapes = view.detected(ShapeType.Shape, mouse.x, mouse.y);
        expect(shapes.length).toEqual(1);
        expect(shapes[0].shape.shapeType).toBe(ShapeType.Edge);

        let shape = context.getShape(model);
        expect(shapes.at(0)?.shape).toEqual(shape?.shape);
        expect(context.getModel(shape!)).toEqual(model);

        context.removeModel([model]);
        expect(view.detected(ShapeType.Shape, mouse.x, mouse.y).length).toEqual(0);
    });
});
