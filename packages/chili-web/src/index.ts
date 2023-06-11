// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { AppBuilder, BoxBody, Document } from "chili";
import { Application, GeometryModel, IModel, Logger, Plane, XYZ } from "chili-core";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();

builder
    .build()
    .then(() => {
        let doc = new Document("test");
        Application.instance.activeDocument = doc;

        // console.log("creating models");
        // const models: IModel[] = []
        // for (let i = 0; i < 2000; i++) {
        //     let plane = new Plane(new XYZ(800 * Math.random() - 400, 800 * Math.random() - 400, 800 * Math.random() - 400), XYZ.unitZ, XYZ.unitX)
        //     let body = new BoxBody(doc, plane, 20, 20, 20);
        //     let model = new GeometryModel(doc, `model-${i}`, body);
        //     models.push(model)
        // }
        // console.log("adding models");
        // doc.addNode(...models);
    })
    .catch((err) => {
        Logger.error(err);
    });
