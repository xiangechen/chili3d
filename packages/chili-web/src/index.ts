// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { Application, Logger } from "chili-core";
import { Document } from "chili";
import { AppBuilder } from "./appBuilder";
import { Loading } from "./loading";

let loading = new Loading();
document.body.appendChild(loading);

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useOcc()
    .useThree()
    .useUI()
    .build()
    .then(x => {
        document.body.removeChild(loading)
        Application.instance.activeDocument = new Document("test")
    })
    .catch((err) => {
        Logger.error(err);
    });
