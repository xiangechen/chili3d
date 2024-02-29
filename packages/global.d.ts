// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

declare module "*.module.css" {
    const classes: any;
    export default classes;
}

declare module "*.wasm" {
    const fun: string;
    export default fun;
}
