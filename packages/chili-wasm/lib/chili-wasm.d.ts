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

export interface FaceMesh {
    getPosition(): any;
    getNormal(): any;
    getUV(): any;
    getIndex(): any;
    getGroups(): any;
    delete(): void;
}

export interface gp_Pnt {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Vec {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Dir {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Ax1 {
    readonly location: gp_Pnt;
    readonly direction: gp_Dir;
    delete(): void;
}

export interface gp_Ax2 {
    readonly location: gp_Pnt;
    readonly direction: gp_Dir;
    readonly xDirection: gp_Dir;
    readonly yDirection: gp_Dir;
    delete(): void;
}

export interface TopoDS_Shape {
    isNull(): boolean;
    delete(): void;
}

export interface TopoDS_Vertex extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Edge extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Wire extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Face extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Shell extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Solid extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Compound extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_CompSolid extends TopoDS_Shape {
    delete(): void;
}

export interface ShapeFactory {
    delete(): void;
}

interface EmbindModule {
    FaceMesh: { new (_0: TopoDS_Shape): FaceMesh; test_5000(): number };
    gp_Pnt: { new (_0: number, _1: number, _2: number): gp_Pnt };
    gp_Vec: { new (_0: number, _1: number, _2: number): gp_Vec };
    gp_Dir: { new (_0: number, _1: number, _2: number): gp_Dir };
    gp_Ax1: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax1 };
    gp_Ax2: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax2; new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax2 };
    TopoDS_Shape: {};
    TopoDS_Vertex: {};
    TopoDS_Edge: {};
    TopoDS_Wire: {};
    TopoDS_Face: {};
    TopoDS_Shell: {};
    TopoDS_Solid: {};
    TopoDS_Compound: {};
    TopoDS_CompSolid: {};
    ShapeFactory: { makeBox(_0: gp_Ax2, _1: number, _2: number, _3: number): TopoDS_Shape };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory(options?: unknown): Promise<MainModule>;
