// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export type Result<T, E = string> = {
    unwrap(): T;
    expect(msg: string): T;
} & (
    | {
          readonly isOk: true;
          readonly value: T;
      }
    | {
          readonly isOk: false;
          readonly value: undefined;
          readonly error: E;
      }
);

export namespace Result {
    export function ok<T>(value: T): Result<T, never> {
        return {
            value,
            unwrap: () => value,
            isOk: true,
            expect: (_msg: string) => value,
        };
    }

    export function err<E>(error: E): Result<never, E> {
        return {
            error,
            unwrap: () => {
                throw error;
            },
            isOk: false,
            value: undefined,
            expect: (msg: string) => {
                throw new Error(msg);
            },
        };
    }
}
