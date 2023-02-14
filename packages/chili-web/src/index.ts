// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AppBuilder, Application, Document } from "chili";
import { I18n, Plane } from "chili-core";
import { Viewport } from "chili-ui";

// prettier-ignore
let builder = new AppBuilder()
    .useOcc()
    .useThree()
    .useUI();

await builder.build();
let doc = Document.create("test");
let view = doc.viewer.createView(Viewport.current.dom, "view", Plane.XY);
view.redraw();
