// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata"; // 使用依赖注入时，必须导入

import { Logger } from "chili-core";
import { AppBuilder } from "./appBuilder";

// prettier-ignore
new AppBuilder()
    .useOcc()
    .useThree()
    .useUI()
    .build()
    .catch((err) => {
        Logger.error(err);
    });
