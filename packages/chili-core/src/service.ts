// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "./application";

export interface IService {
    register(app: IApplication): void;
    start(): void;
    stop(): void;
}
