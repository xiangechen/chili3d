// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AppBuilder } from "chili";
import { Viewport } from "chili-ui";
import { Plane } from "chili-shared";
import { addBox } from "./sample";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();

let app = await builder.build();
let doc = app.newDocument("test");
doc.viewer.createView(Viewport.current.dom, "view", Plane.XY);

addBox(doc, "box1", 5, 5);
