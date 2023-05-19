// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { expect, jest, test } from "@jest/globals";
import { GeometryModel, Model, Plane, RenderData, ShapeType, XY, XYZ } from "chili-core";
import { TestDocument } from "./testDocument";
import { TestView } from "./testView";
import { TestBody } from "./testEdge";
import { shaderFunctions } from "three-mesh-bvh";

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
        let body = new TestBody(doc, XYZ.zero, new XYZ(100, 0, 0));
        let model = new GeometryModel(doc, "test model", body);
        doc.visual.context.addModel([model]);
        expect(doc.visual.context.getShape(model)).not.toBeNull();
        let mouse = view.worldToScreen(new XYZ(0, 0, 0));
        var shapes = doc.visual.context.detectedShapes(ShapeType.Shape, view, mouse.x, mouse.y, false);
        expect(shapes.length).toEqual(1);
    });
});
