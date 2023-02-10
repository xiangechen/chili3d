// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ModelObject } from "./modelObject";

export interface IModelManager {
    get count(): number;
    add(...models: ModelObject[]): void;
    get(id: string): ModelObject | undefined;
    getMany(...ids: string[]): ModelObject[];
    remove(...models: ModelObject[]): void;
}
