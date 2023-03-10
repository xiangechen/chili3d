// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { Document } from "chili";
import { Plane } from "chili-core";
import { Viewport } from "chili-ui";
import { AppBuilder } from "./appBuilder";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();
await builder.build();

let doc = Document.create("test");
let view = doc.visualization.viewFactory.create("view", Plane.XY, Viewport.current.dom);
view.redraw();
