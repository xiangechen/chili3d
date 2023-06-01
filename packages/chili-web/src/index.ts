// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { AppBuilder, BoxBody, Document } from "chili";
import { Application, GeometryModel, Model, Plane, XYZ } from "chili-core";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();

builder.build().then(() => {
    let doc = new Document("test");
    Application.instance.activeDocument = doc;

    // let models = new Array<Model>(10000);
    // console.log("creating models");

    // for (let i = 0; i < 100; i++) {
    //     for (let j = 0; j < 100; j++) {
    //         let plane = new Plane(new XYZ(i * 11, j * 11, 0), XYZ.unitZ, XYZ.unitX)
    //         let body = new BoxBody(doc, plane, 10, 10, 10);
    //         models.push(new GeometryModel(doc, `model-${i}-${j}`, body));
    //     }
    // }
    // console.log("adding models");

    // doc.nodes.add(...models);
    // doc.visual.viewer.redraw()
});
