// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Token } from "../token";

export interface IRegister {
    register<T>(token: Token, ctor: new (...args: any[]) => T): void;
    registerSingleton<T>(token: Token, ctor: new (...args: any[]) => T): void;
}
