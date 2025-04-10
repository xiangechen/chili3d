// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

declare module "*.module.css" {
    const classes: any;
    export default classes;
}

declare module "*.wasm" {
    const fun: string;
    export default fun;
}

declare module "*.cur" {
    const cur: string;
    export default cur;
}

declare module "*.svg" {
    const icon: string;
    export default icon;
}

declare module "*.jpg" {
    const path: string;
    export default path;
}

declare var __APP_VERSION__: string;
declare var __DOCUMENT_VERSION__: string;
