// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Token {
    static readonly VisulizationFactory = new Token("VisulizationFactory");
    static readonly EdgeFactory = new Token("EdgeFactory");
    static readonly VertexFactory = new Token("VertexFactory");

    static set(token: Token) {
        return (ctor: new (...args: any[]) => any) => {
            ctor.prototype.token = token;
        };
    }

    static get(ctor: new (...args: any[]) => any): Token | undefined {
        return ctor.prototype.token;
    }

    constructor(readonly token: string) {}
}
