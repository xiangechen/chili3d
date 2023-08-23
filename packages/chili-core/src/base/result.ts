// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export type Result<T, E = string> = {
    unwrap(): T;
} & (
    | {
          readonly status: "success";
          readonly value: T;
      }
    | {
          readonly status: "error";
          readonly error: E;
      }
);

export namespace Result {
    export function success<T>(value: T): Result<T, never> {
        return {
            status: "success",
            value,
            unwrap: () => value,
        };
    }

    export function error<E>(error: E): Result<never, E> {
        return {
            status: "error",
            error,
            unwrap: () => {
                throw error;
            },
        };
    }
}
