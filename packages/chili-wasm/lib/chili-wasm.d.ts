// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPF32: any;
    let HEAPF64: any;
    let HEAP_DATA_VIEW: any;
    let HEAP8: any;
    let HEAPU8: any;
    let HEAP16: any;
    let HEAPU16: any;
    let HEAP32: any;
    let HEAPU32: any;
    let HEAP64: any;
    let HEAPU64: any;
}
interface WasmModule {}

type EmbindString = ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string;
export interface MyClass {
    x: number;
    readonly x_readonly: number;
    incrementX(): void;
    delete(): void;
}

export interface Point3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface Vector3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface UnitVector3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

interface EmbindModule {
    MyClass: { new (_0: number, _1: EmbindString): MyClass; getStringFromInstance(_0: MyClass): string };
    addTest(_0: number, _1: number): number;
    Point3: { new (_0: number, _1: number, _2: number): Point3 };
    makePnt(_0: number, _1: number, _2: number): Point3;
    Vector3: { new (_0: number, _1: number, _2: number): Vector3 };
    UnitVector3: { new (_0: number, _1: number, _2: number): UnitVector3 };
    makeDir(_0: Point3, _1: Point3): UnitVector3;
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory(options?: unknown): Promise<MainModule>;
