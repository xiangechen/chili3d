// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

/**
 * Color, RGBA format.
 * [0, 0, 0, 0] ~ [1, 1, 1, 1
 */
export class Color {
    constructor(readonly r: number, readonly g: number, readonly b: number, readonly a: number) {}

    /**
     *
     * @param hex 0xRRGGBB
     * @returns
     */
    static fromHex(hex: number): Color {
        let r = (hex >> 16) & 0xff;
        let g = (hex >> 8) & 0xff;
        let b = hex & 0xff;
        return new Color(r / 255, g / 255, b / 255, 1);
    }

    /**
     *
     * @param hex 0xRRGGBB
     * @returns
     */
    static fromHexStr(hex: string): Color {
        return Color.fromHex(parseInt(hex, 16));
    }

    static fromRGB(r: number, g: number, b: number): Color {
        return new Color(r, g, b, 1);
    }

    static fromRGBA(r: number, g: number, b: number, a: number): Color {
        return new Color(r, g, b, a);
    }

    static fromHSV(h: number, s: number, v: number): Color {
        return Color.fromHSVA(h, s, v, 1);
    }

    static fromHSVA(h: number, s: number, v: number, a: number): Color {
        let r = 0,
            g = 0,
            b = 0;
        if (s == 0) {
            r = g = b = v;
        } else {
            let i = Math.floor(h * 6);
            let f = h * 6 - i;
            let p = v * (1 - s);
            let q = v * (1 - f * s);
            let t = v * (1 - (1 - f) * s);
            switch (i % 6) {
                case 0:
                    (r = v), (g = t), (b = p);
                    break;
                case 1:
                    (r = q), (g = v), (b = p);
                    break;
                case 2:
                    (r = p), (g = v), (b = t);
                    break;
                case 3:
                    (r = p), (g = q), (b = v);
                    break;
                case 4:
                    (r = t), (g = p), (b = v);
                    break;
                case 5:
                    (r = v), (g = p), (b = q);
                    break;
            }
        }
        return new Color(r, g, b, a);
    }

    static fromHSL(h: number, s: number, l: number): Color {
        return Color.fromHSLA(h, s, l, 1);
    }

    static fromHSLA(h: number, s: number, l: number, a: number): Color {
        let r = 0,
            g = 0,
            b = 0;
        if (s == 0) {
            r = g = b = l;
        } else {
            let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            let p = 2 * l - q;
            r = Color.hue2rgb(p, q, h + 1 / 3);
            g = Color.hue2rgb(p, q, h);
            b = Color.hue2rgb(p, q, h - 1 / 3);
        }
        return new Color(r, g, b, a);
    }

    static hue2rgb(p: number, q: number, t: number): number {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    static random(): Color {
        return new Color(Math.random(), Math.random(), Math.random(), 1);
    }

    static randomAlpha(): Color {
        return new Color(Math.random(), Math.random(), Math.random(), Math.random());
    }

    static randomGray(): Color {
        let v = Math.random();
        return new Color(v, v, v, 1);
    }

    static randomGrayAlpha(): Color {
        let v = Math.random();
        return new Color(v, v, v, Math.random());
    }

    static randomRGB(): Color {
        return new Color(Math.random(), Math.random(), Math.random(), 1);
    }

    static randomRGBA(): Color {
        return new Color(Math.random(), Math.random(), Math.random(), Math.random());
    }

    toString(): string {
        return `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
    }

    toHexStr(): string {
        return "#" + Color.toHex(this.r) + Color.toHex(this.g) + Color.toHex(this.b);
    }

    static toHex(n: number): string {
        let hex = Math.round(n * 255).toString(16);
        if (hex.length < 2) {
            hex = "0" + hex;
        }
        return hex;
    }

    toHSV(): { h: number; s: number; v: number } {
        let r = this.r,
            g = this.g,
            b = this.b;
        let max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        let h = 0,
            s = 0,
            v = max;
        let d = max - min;
        if (max != 0) {
            s = d / max;
        }
        if (max == min) {
            h = 0;
        } else {
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }
        return { h, s, v };
    }
}

export class Colors {
    static readonly Red = new Color(1, 0, 0, 1);
    static readonly Green = new Color(0, 1, 0, 1);
    static readonly Blue = new Color(0, 0, 1, 1);
    static readonly White = new Color(1, 1, 1, 1);
    static readonly Black = new Color(0, 0, 0, 1);
    static readonly Yellow = new Color(1, 1, 0, 1);
    static readonly Cyan = new Color(0, 1, 1, 1);
    static readonly Magenta = new Color(1, 0, 1, 1);
    static readonly Gray = new Color(0.5, 0.5, 0.5, 1);
    static readonly LightGray = new Color(0.8, 0.8, 0.8, 1);
    static readonly DarkGray = new Color(0.2, 0.2, 0.2, 1);
    static readonly Transparent = new Color(0, 0, 0, 0);
    static readonly Orange = new Color(1, 0.5, 0, 1);
    static readonly Brown = new Color(0.6, 0.4, 0.2, 1);
    static readonly Pink = new Color(1, 0.6, 0.6, 1);
    static readonly Purple = new Color(0.6, 0.2, 0.8, 1);
    static readonly Lime = new Color(0.6, 1, 0.2, 1);
    static readonly Teal = new Color(0.2, 0.6, 0.6, 1);
    static readonly Sky = new Color(0.2, 0.6, 1, 1);
    static readonly Indigo = new Color(0.2, 0.2, 0.6, 1);
    static readonly Olive = new Color(0.6, 0.6, 0.2, 1);
    static readonly Maroon = new Color(0.6, 0.2, 0.2, 1);
}
