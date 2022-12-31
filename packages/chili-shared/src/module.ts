// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IRegister } from "./ioc";

export interface IModule {
    type(): string;
    init(container: IRegister): void | Promise<void>;
}
