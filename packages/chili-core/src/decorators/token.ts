// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

const TokenMap = new Map<Constructor, Token>();

export type Constructor = new (...args: any[]) => any;

export class Token {
    static readonly VisulizationFactory = new Token("VisulizationFactory");
    static readonly ShapeFactory = new Token("ShapeFactory");

    static set(token: Token) {
        return (ctor: new (...args: any[]) => any) => {
            TokenMap.set(ctor, token);
        };
    }

    static get(ctor: Constructor): Token | undefined {
        return TokenMap.get(ctor);
    }

    constructor(readonly token: string) {}
}
