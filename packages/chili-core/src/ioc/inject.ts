// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { inject as tsyringeInject, injectable as tsyringeInjectable } from "tsyringe";

import { Token } from "../token";

export function injectable<T>(): (target: new (...args: any[]) => T) => void {
    return tsyringeInjectable<T>();
}

export function inject(token: Token): (target: any, propertyKey: string | symbol, parameterIndex: number) => any {
    return tsyringeInject(token.token);
}
