// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Model } from "./model";

export interface IModelManager {
    get count(): number;
    add(...models: Model[]): void;
    get(id: string): Model | undefined;
    getMany(...ids: string[]): Model[];
    remove(...models: Model[]): void;
}
