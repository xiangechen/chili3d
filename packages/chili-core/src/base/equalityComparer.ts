// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface IEqualityComparer<T> {
    equals(left: T, right: T): boolean;
}
