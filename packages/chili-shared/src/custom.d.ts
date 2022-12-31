// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

declare module "*.module.css" {
    const classes: { [key: string]: string };
    export default classes;
}

declare module "*.wasm" {
    const fun: string;
    export default fun;
}
