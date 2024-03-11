// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

// Copy from nanoid: https://github.com/ai/nanoid/blob/main/non-secure/index.js

// This alphabet uses `A-Za-z0-9_-` symbols.
// The order of characters is optimized for better gzip and brotli compression.
// References to the same file (works both for gzip and brotli):
// `'use`, `andom`, and `rict'`
// References to the brotli default dictionary:
// `-26T`, `1983`, `40px`, `75px`, `bush`, `jack`, `mind`, `very`, and `wolf`
let alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export class Id {
    static generate(size = 21) {
        let id = "";
        // A compact alternative for `for (var i = 0; i < step; i++)`.
        let i = size;
        while (i--) {
            // `| 0` is more compact and faster than `Math.floor()`.
            id += alphabet[(Math.random() * 64) | 0];
        }
        return id;
    }
}
