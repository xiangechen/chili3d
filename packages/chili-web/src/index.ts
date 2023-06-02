// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { AppBuilder, BoxBody, Document } from "chili";
import { Application, GeometryModel, Model, Plane, XYZ } from "chili-core";
import { ThreeVisual } from "chili-three/src/threeVisual";
import { BoxGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial } from "three";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();

builder.build().then(() => {
    let doc = new Document("test");
    Application.instance.activeDocument = doc;

    console.log("creating models");

    // for (let i = 0; i < 10000; i++) {
    //     let plane = new Plane(new XYZ(800 * Math.random() - 400, 800 * Math.random() - 400, 800 * Math.random() - 400), XYZ.unitZ, XYZ.unitX)
    //     let body = new BoxBody(doc, plane, 20, 20, 20);
    //     GeometryModel.create(doc, `model-${i}`, body);
    // }

    // let scene = (Application.instance.activeDocument.visual as ThreeVisual).scene
    // for ( let i = 0; i < 10000; i ++ ) {
    //     const geometry = new BoxGeometry( 20, 20, 20 );
    //     const object = new Mesh(geometry, new MeshBasicMaterial({color: Math.random() * 0xffffff}))
    //     object.position.x = Math.random() * 800 - 400;
    //     object.position.y = Math.random() * 800 - 400;
    //     object.position.z = Math.random() * 800 - 400;
    //     scene.add( object );
    // }
});
