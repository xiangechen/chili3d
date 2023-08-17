// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger } from "chili-core";
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
    })
    .catch((err) => {
        Logger.error(err);
    });
