// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    namespace FS {
        export let root: any;
        export let mounts: any[];
        export let devices: {};
        export let streams: any[];
        export let nextInode: number;
        export let nameTable: any;
        export let currentPath: string;
        export let initialized: boolean;
        export let ignorePermissions: boolean;
        export { ErrnoError };
        export let genericErrors: {};
        export let filesystems: any;
        export let syncFSRequests: number;
        export { FSStream };
        export { FSNode };
        export function lookupPath(
            path: any,
            opts?: {},
        ): {
            path: string;
            node: any;
        };
        export function getPath(node: any): any;
        export function hashName(parentid: any, name: any): number;
        export function hashAddNode(node: any): void;
        export function hashRemoveNode(node: any): void;
        export function lookupNode(parent: any, name: any): any;
        export function createNode(parent: any, name: any, mode: any, rdev: any): any;
        export function destroyNode(node: any): void;
        export function isRoot(node: any): boolean;
        export function isMountpoint(node: any): boolean;
        export function isFile(mode: any): boolean;
        export function isDir(mode: any): boolean;
        export function isLink(mode: any): boolean;
        export function isChrdev(mode: any): boolean;
        export function isBlkdev(mode: any): boolean;
        export function isFIFO(mode: any): boolean;
        export function isSocket(mode: any): boolean;
        export function flagsToPermissionString(flag: any): string;
        export function nodePermissions(node: any, perms: any): 0 | 2;
        export function mayLookup(dir: any): any;
        export function mayCreate(dir: any, name: any): any;
        export function mayDelete(dir: any, name: any, isdir: any): any;
        export function mayOpen(node: any, flags: any): any;
        export let MAX_OPEN_FDS: number;
        export function nextfd(): number;
        export function getStreamChecked(fd: any): any;
        export function getStream(fd: any): any;
        export function createStream(stream: any, fd?: number): any;
        export function closeStream(fd: any): void;
        export function dupStream(origStream: any, fd?: number): any;
        export namespace chrdev_stream_ops {
            function open(stream: any): void;
            function llseek(): never;
        }
        export function major(dev: any): number;
        export function minor(dev: any): number;
        export function makedev(ma: any, mi: any): number;
        export function registerDevice(dev: any, ops: any): void;
        export function getDevice(dev: any): any;
        export function getMounts(mount: any): any[];
        export function syncfs(populate: any, callback: any): void;
        export function mount(type: any, opts: any, mountpoint: any): any;
        export function unmount(mountpoint: any): void;
        export function lookup(parent: any, name: any): any;
        export function mknod(path: any, mode: any, dev: any): any;
        export function create(path: any, mode: any): any;
        export function mkdir(path: any, mode: any): any;
        export function mkdirTree(path: any, mode: any): void;
        export function mkdev(path: any, mode: any, dev: any): any;
        export function symlink(oldpath: any, newpath: any): any;
        export function rename(old_path: any, new_path: any): void;
        export function rmdir(path: any): void;
        export function readdir(path: any): any;
        export function unlink(path: any): void;
        export function readlink(path: any): any;
        export function stat(path: any, dontFollow: any): any;
        export function lstat(path: any): any;
        export function chmod(path: any, mode: any, dontFollow: any): void;
        export function lchmod(path: any, mode: any): void;
        export function fchmod(fd: any, mode: any): void;
        export function chown(path: any, uid: any, gid: any, dontFollow: any): void;
        export function lchown(path: any, uid: any, gid: any): void;
        export function fchown(fd: any, uid: any, gid: any): void;
        export function truncate(path: any, len: any): void;
        export function ftruncate(fd: any, len: any): void;
        export function utime(path: any, atime: any, mtime: any): void;
        export function open(path: any, flags: any, mode: any): any;
        export function close(stream: any): void;
        export function isClosed(stream: any): boolean;
        export function llseek(stream: any, offset: any, whence: any): any;
        export function read(stream: any, buffer: any, offset: any, length: any, position: any): any;
        export function write(
            stream: any,
            buffer: any,
            offset: any,
            length: any,
            position: any,
            canOwn: any,
        ): any;
        export function allocate(stream: any, offset: any, length: any): void;
        export function mmap(stream: any, length: any, position: any, prot: any, flags: any): any;
        export function msync(stream: any, buffer: any, offset: any, length: any, mmapFlags: any): any;
        export function ioctl(stream: any, cmd: any, arg: any): any;
        export function readFile(path: any, opts?: {}): any;
        export function writeFile(path: any, data: any, opts?: {}): void;
        export function cwd(): any;
        export function chdir(path: any): void;
        export function createDefaultDirectories(): void;
        export function createDefaultDevices(): void;
        export function createSpecialDirectories(): void;
        export function createStandardStreams(input: any, output: any, error: any): void;
        export function staticInit(): void;
        export function init(input: any, output: any, error: any): void;
        export function quit(): void;
        export function findObject(path: any, dontResolveLastLink: any): any;
        export function analyzePath(
            path: any,
            dontResolveLastLink: any,
        ): {
            isRoot: boolean;
            exists: boolean;
            error: number;
            name: any;
            path: any;
            object: any;
            parentExists: boolean;
            parentPath: any;
            parentObject: any;
        };
        export function createPath(parent: any, path: any, canRead: any, canWrite: any): any;
        export function createFile(
            parent: any,
            name: any,
            properties: any,
            canRead: any,
            canWrite: any,
        ): any;
        export function createDataFile(
            parent: any,
            name: any,
            data: any,
            canRead: any,
            canWrite: any,
            canOwn: any,
        ): void;
        export function createDevice(parent: any, name: any, input: any, output: any): any;
        export function forceLoadFile(obj: any): boolean;
        export function createLazyFile(parent: any, name: any, url: any, canRead: any, canWrite: any): any;
    }
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
declare class ErrnoError {
    constructor(errno: any);
    name: string;
    errno: any;
}
declare class FSStream {
    shared: {};
    set object(val: any);
    get object(): any;
    node: any;
    get isRead(): boolean;
    get isWrite(): boolean;
    get isAppend(): number;
    set flags(val: any);
    get flags(): any;
    set position(val: any);
    get position(): any;
}
declare class FSNode {
    constructor(parent: any, name: any, mode: any, rdev: any);
    parent: any;
    mount: any;
    mounted: any;
    id: number;
    name: any;
    mode: any;
    node_ops: {};
    stream_ops: {};
    rdev: any;
    readMode: number;
    writeMode: number;
    set read(val: boolean);
    get read(): boolean;
    set write(val: boolean);
    get write(): boolean;
    get isFolder(): any;
    get isDevice(): any;
}
interface WasmModule {}

export interface FaceMesher {
    getPosition(): any;
    getNormal(): any;
    getUV(): any;
    getIndex(): any;
    getGroups(): any;
    getFaces(): any;
    delete(): void;
}

export interface EdgeMesher {
    getPosition(): any;
    getGroups(): any;
    getEdges(): any;
    delete(): void;
}

export interface FaceVector {
    size(): number;
    get(_0: number): TopoDS_Face | undefined;
    push_back(_0: TopoDS_Face): void;
    resize(_0: number, _1: TopoDS_Face): void;
    set(_0: number, _1: TopoDS_Face): boolean;
    delete(): void;
}

export interface EdgeVector {
    size(): number;
    get(_0: number): TopoDS_Edge | undefined;
    push_back(_0: TopoDS_Edge): void;
    resize(_0: number, _1: TopoDS_Edge): void;
    set(_0: number, _1: TopoDS_Edge): boolean;
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
    FaceMesher: { new (_0: TopoDS_Shape, _1: number): FaceMesher };
    EdgeMesher: { new (_0: TopoDS_Shape, _1: number): EdgeMesher };
    FaceVector: { new (): FaceVector };
    EdgeVector: { new (): EdgeVector };
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
