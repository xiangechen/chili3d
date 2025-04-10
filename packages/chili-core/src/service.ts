// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IApplication } from "./application";

export interface IService {
    register(app: IApplication): void;
    start(): void;
    stop(): void;
}
