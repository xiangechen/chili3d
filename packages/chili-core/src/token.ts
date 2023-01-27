// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

const TokenMetaKey = Symbol("TokenMetaKey");

export class Token {
    static readonly VisulizationFactory = new Token("VisulizationFactory");
    static readonly ShapeFactory = new Token("ShapeFactory");

    static set(token: Token) {
        return (ctor: new (...args: any[]) => any) => {
            Reflect.defineMetadata(TokenMetaKey, token, ctor);
        };
    }

    static get(ctor: new (...args: any[]) => any): Token | undefined {
        return Reflect.getMetadata(TokenMetaKey, ctor);
    }

    constructor(readonly token: string) {}
}
