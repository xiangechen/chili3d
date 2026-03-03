var Module = (() => {
    return async function (moduleArg = {}) {
        var moduleRtn;

        var Module = moduleArg;
        var readyPromiseResolve, readyPromiseReject;
        var readyPromise = new Promise((resolve, reject) => {
            readyPromiseResolve = resolve;
            readyPromiseReject = reject;
        });
        var ENVIRONMENT_IS_WEB = true;
        var ENVIRONMENT_IS_WORKER = false;
        var arguments_ = [];
        var thisProgram = "./this.program";
        var quit_ = (status, toThrow) => {
            throw toThrow;
        };
        var _scriptName = import.meta.url;
        var scriptDirectory = "";
        function locateFile(path) {
            if (Module["locateFile"]) {
                return Module["locateFile"](path, scriptDirectory);
            }
            return scriptDirectory + path;
        }
        var readAsync, readBinary;
        if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
            try {
                scriptDirectory = new URL(".", _scriptName).href;
            } catch {}
            {
                readAsync = async (url) => {
                    var response = await fetch(url, { credentials: "same-origin" });
                    if (response.ok) {
                        return response.arrayBuffer();
                    }
                    throw new Error(response.status + " : " + response.url);
                };
            }
        } else {
        }
        var out = console.log.bind(console);
        var err = console.error.bind(console);
        var wasmBinary;
        var wasmMemory;
        var ABORT = false;
        var EXITSTATUS;
        function assert(condition, text) {
            if (!condition) {
                abort(text);
            }
        }
        var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAP64, HEAPU64, HEAPF64;
        var runtimeInitialized = false;
        function updateMemoryViews() {
            var b = wasmMemory.buffer;
            HEAP8 = new Int8Array(b);
            HEAP16 = new Int16Array(b);
            HEAPU8 = new Uint8Array(b);
            HEAPU16 = new Uint16Array(b);
            HEAP32 = new Int32Array(b);
            HEAPU32 = new Uint32Array(b);
            HEAPF32 = new Float32Array(b);
            HEAPF64 = new Float64Array(b);
            HEAP64 = new BigInt64Array(b);
            HEAPU64 = new BigUint64Array(b);
        }
        function preRun() {
            if (Module["preRun"]) {
                if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
                while (Module["preRun"].length) {
                    addOnPreRun(Module["preRun"].shift());
                }
            }
            callRuntimeCallbacks(onPreRuns);
        }
        function initRuntime() {
            runtimeInitialized = true;
            if (!Module["noFSInit"] && !FS.initialized) FS.init();
            TTY.init();
            wasmExports["ka"]();
            FS.ignorePermissions = false;
        }
        function postRun() {
            if (Module["postRun"]) {
                if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
                while (Module["postRun"].length) {
                    addOnPostRun(Module["postRun"].shift());
                }
            }
            callRuntimeCallbacks(onPostRuns);
        }
        var runDependencies = 0;
        var dependenciesFulfilled = null;
        function getUniqueRunDependency(id) {
            return id;
        }
        function addRunDependency(id) {
            runDependencies++;
            Module["monitorRunDependencies"]?.(runDependencies);
        }
        function removeRunDependency(id) {
            runDependencies--;
            Module["monitorRunDependencies"]?.(runDependencies);
            if (runDependencies == 0) {
                if (dependenciesFulfilled) {
                    var callback = dependenciesFulfilled;
                    dependenciesFulfilled = null;
                    callback();
                }
            }
        }
        function abort(what) {
            Module["onAbort"]?.(what);
            what = "Aborted(" + what + ")";
            err(what);
            ABORT = true;
            what += ". Build with -sASSERTIONS for more info.";
            var e = new WebAssembly.RuntimeError(what);
            readyPromiseReject(e);
            throw e;
        }
        var wasmBinaryFile;
        function findWasmBinary() {
            if (Module["locateFile"]) {
                return locateFile("chili-wasm.wasm");
            }
            return new URL("chili-wasm.wasm", import.meta.url).href;
        }
        function getBinarySync(file) {
            if (file == wasmBinaryFile && wasmBinary) {
                return new Uint8Array(wasmBinary);
            }
            if (readBinary) {
                return readBinary(file);
            }
            throw "both async and sync fetching of the wasm failed";
        }
        async function getWasmBinary(binaryFile) {
            if (!wasmBinary) {
                try {
                    var response = await readAsync(binaryFile);
                    return new Uint8Array(response);
                } catch {}
            }
            return getBinarySync(binaryFile);
        }
        async function instantiateArrayBuffer(binaryFile, imports) {
            try {
                var binary = await getWasmBinary(binaryFile);
                var instance = await WebAssembly.instantiate(binary, imports);
                return instance;
            } catch (reason) {
                err(`failed to asynchronously prepare wasm: ${reason}`);
                abort(reason);
            }
        }
        async function instantiateAsync(binary, binaryFile, imports) {
            if (!binary && typeof WebAssembly.instantiateStreaming == "function") {
                try {
                    var response = fetch(binaryFile, { credentials: "same-origin" });
                    var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
                    return instantiationResult;
                } catch (reason) {
                    err(`wasm streaming compile failed: ${reason}`);
                    err("falling back to ArrayBuffer instantiation");
                }
            }
            return instantiateArrayBuffer(binaryFile, imports);
        }
        function getWasmImports() {
            return { a: wasmImports };
        }
        async function createWasm() {
            function receiveInstance(instance, module) {
                wasmExports = instance.exports;
                wasmExports = applySignatureConversions(wasmExports);
                wasmMemory = wasmExports["ja"];
                updateMemoryViews();
                wasmTable = wasmExports["oa"];
                removeRunDependency("wasm-instantiate");
                return wasmExports;
            }
            addRunDependency("wasm-instantiate");
            function receiveInstantiationResult(result) {
                return receiveInstance(result["instance"]);
            }
            var info = getWasmImports();
            if (Module["instantiateWasm"]) {
                return new Promise((resolve, reject) => {
                    Module["instantiateWasm"](info, (mod, inst) => {
                        resolve(receiveInstance(mod, inst));
                    });
                });
            }
            wasmBinaryFile ??= findWasmBinary();
            try {
                var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
                var exports = receiveInstantiationResult(result);
                return exports;
            } catch (e) {
                readyPromiseReject(e);
                return Promise.reject(e);
            }
        }
        class ExitStatus {
            name = "ExitStatus";
            constructor(status) {
                this.message = `Program terminated with exit(${status})`;
                this.status = status;
            }
        }
        var callRuntimeCallbacks = (callbacks) => {
            while (callbacks.length > 0) {
                callbacks.shift()(Module);
            }
        };
        var onPostRuns = [];
        var addOnPostRun = (cb) => onPostRuns.push(cb);
        var onPreRuns = [];
        var addOnPreRun = (cb) => onPreRuns.push(cb);
        var noExitRuntime = true;
        class ExceptionInfo {
            constructor(excPtr) {
                this.excPtr = excPtr;
                this.ptr = excPtr - 24;
            }
            set_type(type) {
                HEAPU32[((this.ptr + 4) >>> 2) >>> 0] = type;
            }
            get_type() {
                return HEAPU32[((this.ptr + 4) >>> 2) >>> 0];
            }
            set_destructor(destructor) {
                HEAPU32[((this.ptr + 8) >>> 2) >>> 0] = destructor;
            }
            get_destructor() {
                return HEAPU32[((this.ptr + 8) >>> 2) >>> 0];
            }
            set_caught(caught) {
                caught = caught ? 1 : 0;
                HEAP8[(this.ptr + 12) >>> 0] = caught;
            }
            get_caught() {
                return HEAP8[(this.ptr + 12) >>> 0] != 0;
            }
            set_rethrown(rethrown) {
                rethrown = rethrown ? 1 : 0;
                HEAP8[(this.ptr + 13) >>> 0] = rethrown;
            }
            get_rethrown() {
                return HEAP8[(this.ptr + 13) >>> 0] != 0;
            }
            init(type, destructor) {
                this.set_adjusted_ptr(0);
                this.set_type(type);
                this.set_destructor(destructor);
            }
            set_adjusted_ptr(adjustedPtr) {
                HEAPU32[((this.ptr + 16) >>> 2) >>> 0] = adjustedPtr;
            }
            get_adjusted_ptr() {
                return HEAPU32[((this.ptr + 16) >>> 2) >>> 0];
            }
        }
        var exceptionLast = 0;
        var uncaughtExceptionCount = 0;
        var INT53_MAX = 9007199254740992;
        var INT53_MIN = -9007199254740992;
        var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX ? NaN : Number(num));
        function ___cxa_throw(ptr, type, destructor) {
            ptr >>>= 0;
            type >>>= 0;
            destructor >>>= 0;
            var info = new ExceptionInfo(ptr);
            info.init(type, destructor);
            exceptionLast = ptr;
            uncaughtExceptionCount++;
            throw exceptionLast;
        }
        var PATH = {
            isAbs: (path) => path.charAt(0) === "/",
            splitPath: (filename) => {
                var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
                return splitPathRe.exec(filename).slice(1);
            },
            normalizeArray: (parts, allowAboveRoot) => {
                var up = 0;
                for (var i = parts.length - 1; i >= 0; i--) {
                    var last = parts[i];
                    if (last === ".") {
                        parts.splice(i, 1);
                    } else if (last === "..") {
                        parts.splice(i, 1);
                        up++;
                    } else if (up) {
                        parts.splice(i, 1);
                        up--;
                    }
                }
                if (allowAboveRoot) {
                    for (; up; up--) {
                        parts.unshift("..");
                    }
                }
                return parts;
            },
            normalize: (path) => {
                var isAbsolute = PATH.isAbs(path),
                    trailingSlash = path.slice(-1) === "/";
                path = PATH.normalizeArray(
                    path.split("/").filter((p) => !!p),
                    !isAbsolute,
                ).join("/");
                if (!path && !isAbsolute) {
                    path = ".";
                }
                if (path && trailingSlash) {
                    path += "/";
                }
                return (isAbsolute ? "/" : "") + path;
            },
            dirname: (path) => {
                var result = PATH.splitPath(path),
                    root = result[0],
                    dir = result[1];
                if (!root && !dir) {
                    return ".";
                }
                if (dir) {
                    dir = dir.slice(0, -1);
                }
                return root + dir;
            },
            basename: (path) => path && path.match(/([^\/]+|\/)\/*$/)[1],
            join: (...paths) => PATH.normalize(paths.join("/")),
            join2: (l, r) => PATH.normalize(l + "/" + r),
        };
        var initRandomFill = () => (view) => crypto.getRandomValues(view);
        var randomFill = (view) => {
            (randomFill = initRandomFill())(view);
        };
        var PATH_FS = {
            resolve: (...args) => {
                var resolvedPath = "",
                    resolvedAbsolute = false;
                for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
                    var path = i >= 0 ? args[i] : FS.cwd();
                    if (typeof path != "string") {
                        throw new TypeError("Arguments to path.resolve must be strings");
                    } else if (!path) {
                        return "";
                    }
                    resolvedPath = path + "/" + resolvedPath;
                    resolvedAbsolute = PATH.isAbs(path);
                }
                resolvedPath = PATH.normalizeArray(
                    resolvedPath.split("/").filter((p) => !!p),
                    !resolvedAbsolute,
                ).join("/");
                return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
            },
            relative: (from, to) => {
                from = PATH_FS.resolve(from).slice(1);
                to = PATH_FS.resolve(to).slice(1);
                function trim(arr) {
                    var start = 0;
                    for (; start < arr.length; start++) {
                        if (arr[start] !== "") break;
                    }
                    var end = arr.length - 1;
                    for (; end >= 0; end--) {
                        if (arr[end] !== "") break;
                    }
                    if (start > end) return [];
                    return arr.slice(start, end - start + 1);
                }
                var fromParts = trim(from.split("/"));
                var toParts = trim(to.split("/"));
                var length = Math.min(fromParts.length, toParts.length);
                var samePartsLength = length;
                for (var i = 0; i < length; i++) {
                    if (fromParts[i] !== toParts[i]) {
                        samePartsLength = i;
                        break;
                    }
                }
                var outputParts = [];
                for (var i = samePartsLength; i < fromParts.length; i++) {
                    outputParts.push("..");
                }
                outputParts = outputParts.concat(toParts.slice(samePartsLength));
                return outputParts.join("/");
            },
        };
        var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : undefined;
        var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
            idx >>>= 0;
            var endIdx = idx + maxBytesToRead;
            var endPtr = idx;
            while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
            if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
                return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
            }
            var str = "";
            while (idx < endPtr) {
                var u0 = heapOrArray[idx++];
                if (!(u0 & 128)) {
                    str += String.fromCharCode(u0);
                    continue;
                }
                var u1 = heapOrArray[idx++] & 63;
                if ((u0 & 224) == 192) {
                    str += String.fromCharCode(((u0 & 31) << 6) | u1);
                    continue;
                }
                var u2 = heapOrArray[idx++] & 63;
                if ((u0 & 240) == 224) {
                    u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
                } else {
                    u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
                }
                if (u0 < 65536) {
                    str += String.fromCharCode(u0);
                } else {
                    var ch = u0 - 65536;
                    str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
                }
            }
            return str;
        };
        var FS_stdin_getChar_buffer = [];
        var lengthBytesUTF8 = (str) => {
            var len = 0;
            for (var i = 0; i < str.length; ++i) {
                var c = str.charCodeAt(i);
                if (c <= 127) {
                    len++;
                } else if (c <= 2047) {
                    len += 2;
                } else if (c >= 55296 && c <= 57343) {
                    len += 4;
                    ++i;
                } else {
                    len += 3;
                }
            }
            return len;
        };
        var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
            outIdx >>>= 0;
            if (!(maxBytesToWrite > 0)) return 0;
            var startIdx = outIdx;
            var endIdx = outIdx + maxBytesToWrite - 1;
            for (var i = 0; i < str.length; ++i) {
                var u = str.charCodeAt(i);
                if (u >= 55296 && u <= 57343) {
                    var u1 = str.charCodeAt(++i);
                    u = (65536 + ((u & 1023) << 10)) | (u1 & 1023);
                }
                if (u <= 127) {
                    if (outIdx >= endIdx) break;
                    heap[outIdx++ >>> 0] = u;
                } else if (u <= 2047) {
                    if (outIdx + 1 >= endIdx) break;
                    heap[outIdx++ >>> 0] = 192 | (u >> 6);
                    heap[outIdx++ >>> 0] = 128 | (u & 63);
                } else if (u <= 65535) {
                    if (outIdx + 2 >= endIdx) break;
                    heap[outIdx++ >>> 0] = 224 | (u >> 12);
                    heap[outIdx++ >>> 0] = 128 | ((u >> 6) & 63);
                    heap[outIdx++ >>> 0] = 128 | (u & 63);
                } else {
                    if (outIdx + 3 >= endIdx) break;
                    heap[outIdx++ >>> 0] = 240 | (u >> 18);
                    heap[outIdx++ >>> 0] = 128 | ((u >> 12) & 63);
                    heap[outIdx++ >>> 0] = 128 | ((u >> 6) & 63);
                    heap[outIdx++ >>> 0] = 128 | (u & 63);
                }
            }
            heap[outIdx >>> 0] = 0;
            return outIdx - startIdx;
        };
        var intArrayFromString = (stringy, dontAddNull, length) => {
            var len = length > 0 ? length : lengthBytesUTF8(stringy) + 1;
            var u8array = new Array(len);
            var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
            if (dontAddNull) u8array.length = numBytesWritten;
            return u8array;
        };
        var FS_stdin_getChar = () => {
            if (!FS_stdin_getChar_buffer.length) {
                var result = null;
                if (typeof window != "undefined" && typeof window.prompt == "function") {
                    result = window.prompt("Input: ");
                    if (result !== null) {
                        result += "\n";
                    }
                } else {
                }
                if (!result) {
                    return null;
                }
                FS_stdin_getChar_buffer = intArrayFromString(result, true);
            }
            return FS_stdin_getChar_buffer.shift();
        };
        var TTY = {
            ttys: [],
            init() {},
            shutdown() {},
            register(dev, ops) {
                TTY.ttys[dev] = { input: [], output: [], ops };
                FS.registerDevice(dev, TTY.stream_ops);
            },
            stream_ops: {
                open(stream) {
                    var tty = TTY.ttys[stream.node.rdev];
                    if (!tty) {
                        throw new FS.ErrnoError(43);
                    }
                    stream.tty = tty;
                    stream.seekable = false;
                },
                close(stream) {
                    stream.tty.ops.fsync(stream.tty);
                },
                fsync(stream) {
                    stream.tty.ops.fsync(stream.tty);
                },
                read(stream, buffer, offset, length, pos) {
                    if (!stream.tty || !stream.tty.ops.get_char) {
                        throw new FS.ErrnoError(60);
                    }
                    var bytesRead = 0;
                    for (var i = 0; i < length; i++) {
                        var result;
                        try {
                            result = stream.tty.ops.get_char(stream.tty);
                        } catch (e) {
                            throw new FS.ErrnoError(29);
                        }
                        if (result === undefined && bytesRead === 0) {
                            throw new FS.ErrnoError(6);
                        }
                        if (result === null || result === undefined) break;
                        bytesRead++;
                        buffer[offset + i] = result;
                    }
                    if (bytesRead) {
                        stream.node.atime = Date.now();
                    }
                    return bytesRead;
                },
                write(stream, buffer, offset, length, pos) {
                    if (!stream.tty || !stream.tty.ops.put_char) {
                        throw new FS.ErrnoError(60);
                    }
                    try {
                        for (var i = 0; i < length; i++) {
                            stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
                        }
                    } catch (e) {
                        throw new FS.ErrnoError(29);
                    }
                    if (length) {
                        stream.node.mtime = stream.node.ctime = Date.now();
                    }
                    return i;
                },
            },
            default_tty_ops: {
                get_char(tty) {
                    return FS_stdin_getChar();
                },
                put_char(tty, val) {
                    if (val === null || val === 10) {
                        out(UTF8ArrayToString(tty.output));
                        tty.output = [];
                    } else {
                        if (val != 0) tty.output.push(val);
                    }
                },
                fsync(tty) {
                    if (tty.output?.length > 0) {
                        out(UTF8ArrayToString(tty.output));
                        tty.output = [];
                    }
                },
                ioctl_tcgets(tty) {
                    return {
                        c_iflag: 25856,
                        c_oflag: 5,
                        c_cflag: 191,
                        c_lflag: 35387,
                        c_cc: [
                            3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0,
                            0, 0, 0, 0, 0, 0, 0, 0, 0,
                        ],
                    };
                },
                ioctl_tcsets(tty, optional_actions, data) {
                    return 0;
                },
                ioctl_tiocgwinsz(tty) {
                    return [24, 80];
                },
            },
            default_tty1_ops: {
                put_char(tty, val) {
                    if (val === null || val === 10) {
                        err(UTF8ArrayToString(tty.output));
                        tty.output = [];
                    } else {
                        if (val != 0) tty.output.push(val);
                    }
                },
                fsync(tty) {
                    if (tty.output?.length > 0) {
                        err(UTF8ArrayToString(tty.output));
                        tty.output = [];
                    }
                },
            },
        };
        var mmapAlloc = (size) => {
            abort();
        };
        var MEMFS = {
            ops_table: null,
            mount(mount) {
                return MEMFS.createNode(null, "/", 16895, 0);
            },
            createNode(parent, name, mode, dev) {
                if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
                    throw new FS.ErrnoError(63);
                }
                MEMFS.ops_table ||= {
                    dir: {
                        node: {
                            getattr: MEMFS.node_ops.getattr,
                            setattr: MEMFS.node_ops.setattr,
                            lookup: MEMFS.node_ops.lookup,
                            mknod: MEMFS.node_ops.mknod,
                            rename: MEMFS.node_ops.rename,
                            unlink: MEMFS.node_ops.unlink,
                            rmdir: MEMFS.node_ops.rmdir,
                            readdir: MEMFS.node_ops.readdir,
                            symlink: MEMFS.node_ops.symlink,
                        },
                        stream: { llseek: MEMFS.stream_ops.llseek },
                    },
                    file: {
                        node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr },
                        stream: {
                            llseek: MEMFS.stream_ops.llseek,
                            read: MEMFS.stream_ops.read,
                            write: MEMFS.stream_ops.write,
                            mmap: MEMFS.stream_ops.mmap,
                            msync: MEMFS.stream_ops.msync,
                        },
                    },
                    link: {
                        node: {
                            getattr: MEMFS.node_ops.getattr,
                            setattr: MEMFS.node_ops.setattr,
                            readlink: MEMFS.node_ops.readlink,
                        },
                        stream: {},
                    },
                    chrdev: {
                        node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr },
                        stream: FS.chrdev_stream_ops,
                    },
                };
                var node = FS.createNode(parent, name, mode, dev);
                if (FS.isDir(node.mode)) {
                    node.node_ops = MEMFS.ops_table.dir.node;
                    node.stream_ops = MEMFS.ops_table.dir.stream;
                    node.contents = {};
                } else if (FS.isFile(node.mode)) {
                    node.node_ops = MEMFS.ops_table.file.node;
                    node.stream_ops = MEMFS.ops_table.file.stream;
                    node.usedBytes = 0;
                    node.contents = null;
                } else if (FS.isLink(node.mode)) {
                    node.node_ops = MEMFS.ops_table.link.node;
                    node.stream_ops = MEMFS.ops_table.link.stream;
                } else if (FS.isChrdev(node.mode)) {
                    node.node_ops = MEMFS.ops_table.chrdev.node;
                    node.stream_ops = MEMFS.ops_table.chrdev.stream;
                }
                node.atime = node.mtime = node.ctime = Date.now();
                if (parent) {
                    parent.contents[name] = node;
                    parent.atime = parent.mtime = parent.ctime = node.atime;
                }
                return node;
            },
            getFileDataAsTypedArray(node) {
                if (!node.contents) return new Uint8Array(0);
                if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
                return new Uint8Array(node.contents);
            },
            expandFileStorage(node, newCapacity) {
                var prevCapacity = node.contents ? node.contents.length : 0;
                if (prevCapacity >= newCapacity) return;
                var CAPACITY_DOUBLING_MAX = 1024 * 1024;
                newCapacity = Math.max(
                    newCapacity,
                    (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125)) >>> 0,
                );
                if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256);
                var oldContents = node.contents;
                node.contents = new Uint8Array(newCapacity);
                if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
            },
            resizeFileStorage(node, newSize) {
                if (node.usedBytes == newSize) return;
                if (newSize == 0) {
                    node.contents = null;
                    node.usedBytes = 0;
                } else {
                    var oldContents = node.contents;
                    node.contents = new Uint8Array(newSize);
                    if (oldContents) {
                        node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
                    }
                    node.usedBytes = newSize;
                }
            },
            node_ops: {
                getattr(node) {
                    var attr = {};
                    attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
                    attr.ino = node.id;
                    attr.mode = node.mode;
                    attr.nlink = 1;
                    attr.uid = 0;
                    attr.gid = 0;
                    attr.rdev = node.rdev;
                    if (FS.isDir(node.mode)) {
                        attr.size = 4096;
                    } else if (FS.isFile(node.mode)) {
                        attr.size = node.usedBytes;
                    } else if (FS.isLink(node.mode)) {
                        attr.size = node.link.length;
                    } else {
                        attr.size = 0;
                    }
                    attr.atime = new Date(node.atime);
                    attr.mtime = new Date(node.mtime);
                    attr.ctime = new Date(node.ctime);
                    attr.blksize = 4096;
                    attr.blocks = Math.ceil(attr.size / attr.blksize);
                    return attr;
                },
                setattr(node, attr) {
                    for (const key of ["mode", "atime", "mtime", "ctime"]) {
                        if (attr[key] != null) {
                            node[key] = attr[key];
                        }
                    }
                    if (attr.size !== undefined) {
                        MEMFS.resizeFileStorage(node, attr.size);
                    }
                },
                lookup(parent, name) {
                    throw MEMFS.doesNotExistError;
                },
                mknod(parent, name, mode, dev) {
                    return MEMFS.createNode(parent, name, mode, dev);
                },
                rename(old_node, new_dir, new_name) {
                    var new_node;
                    try {
                        new_node = FS.lookupNode(new_dir, new_name);
                    } catch (e) {}
                    if (new_node) {
                        if (FS.isDir(old_node.mode)) {
                            for (var i in new_node.contents) {
                                throw new FS.ErrnoError(55);
                            }
                        }
                        FS.hashRemoveNode(new_node);
                    }
                    delete old_node.parent.contents[old_node.name];
                    new_dir.contents[new_name] = old_node;
                    old_node.name = new_name;
                    new_dir.ctime =
                        new_dir.mtime =
                        old_node.parent.ctime =
                        old_node.parent.mtime =
                            Date.now();
                },
                unlink(parent, name) {
                    delete parent.contents[name];
                    parent.ctime = parent.mtime = Date.now();
                },
                rmdir(parent, name) {
                    var node = FS.lookupNode(parent, name);
                    for (var i in node.contents) {
                        throw new FS.ErrnoError(55);
                    }
                    delete parent.contents[name];
                    parent.ctime = parent.mtime = Date.now();
                },
                readdir(node) {
                    return [".", "..", ...Object.keys(node.contents)];
                },
                symlink(parent, newname, oldpath) {
                    var node = MEMFS.createNode(parent, newname, 511 | 40960, 0);
                    node.link = oldpath;
                    return node;
                },
                readlink(node) {
                    if (!FS.isLink(node.mode)) {
                        throw new FS.ErrnoError(28);
                    }
                    return node.link;
                },
            },
            stream_ops: {
                read(stream, buffer, offset, length, position) {
                    var contents = stream.node.contents;
                    if (position >= stream.node.usedBytes) return 0;
                    var size = Math.min(stream.node.usedBytes - position, length);
                    if (size > 8 && contents.subarray) {
                        buffer.set(contents.subarray(position, position + size), offset);
                    } else {
                        for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
                    }
                    return size;
                },
                write(stream, buffer, offset, length, position, canOwn) {
                    if (buffer.buffer === HEAP8.buffer) {
                        canOwn = false;
                    }
                    if (!length) return 0;
                    var node = stream.node;
                    node.mtime = node.ctime = Date.now();
                    if (buffer.subarray && (!node.contents || node.contents.subarray)) {
                        if (canOwn) {
                            node.contents = buffer.subarray(offset, offset + length);
                            node.usedBytes = length;
                            return length;
                        } else if (node.usedBytes === 0 && position === 0) {
                            node.contents = buffer.slice(offset, offset + length);
                            node.usedBytes = length;
                            return length;
                        } else if (position + length <= node.usedBytes) {
                            node.contents.set(buffer.subarray(offset, offset + length), position);
                            return length;
                        }
                    }
                    MEMFS.expandFileStorage(node, position + length);
                    if (node.contents.subarray && buffer.subarray) {
                        node.contents.set(buffer.subarray(offset, offset + length), position);
                    } else {
                        for (var i = 0; i < length; i++) {
                            node.contents[position + i] = buffer[offset + i];
                        }
                    }
                    node.usedBytes = Math.max(node.usedBytes, position + length);
                    return length;
                },
                llseek(stream, offset, whence) {
                    var position = offset;
                    if (whence === 1) {
                        position += stream.position;
                    } else if (whence === 2) {
                        if (FS.isFile(stream.node.mode)) {
                            position += stream.node.usedBytes;
                        }
                    }
                    if (position < 0) {
                        throw new FS.ErrnoError(28);
                    }
                    return position;
                },
                mmap(stream, length, position, prot, flags) {
                    if (!FS.isFile(stream.node.mode)) {
                        throw new FS.ErrnoError(43);
                    }
                    var ptr;
                    var allocated;
                    var contents = stream.node.contents;
                    if (!(flags & 2) && contents && contents.buffer === HEAP8.buffer) {
                        allocated = false;
                        ptr = contents.byteOffset;
                    } else {
                        allocated = true;
                        ptr = mmapAlloc(length);
                        if (!ptr) {
                            throw new FS.ErrnoError(48);
                        }
                        if (contents) {
                            if (position > 0 || position + length < contents.length) {
                                if (contents.subarray) {
                                    contents = contents.subarray(position, position + length);
                                } else {
                                    contents = Array.prototype.slice.call(
                                        contents,
                                        position,
                                        position + length,
                                    );
                                }
                            }
                            HEAP8.set(contents, ptr >>> 0);
                        }
                    }
                    return { ptr, allocated };
                },
                msync(stream, buffer, offset, length, mmapFlags) {
                    MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
                    return 0;
                },
            },
        };
        var asyncLoad = async (url) => {
            var arrayBuffer = await readAsync(url);
            return new Uint8Array(arrayBuffer);
        };
        var FS_createDataFile = (...args) => FS.createDataFile(...args);
        var preloadPlugins = [];
        var FS_handledByPreloadPlugin = (byteArray, fullname, finish, onerror) => {
            if (typeof Browser != "undefined") Browser.init();
            var handled = false;
            preloadPlugins.forEach((plugin) => {
                if (handled) return;
                if (plugin["canHandle"](fullname)) {
                    plugin["handle"](byteArray, fullname, finish, onerror);
                    handled = true;
                }
            });
            return handled;
        };
        var FS_createPreloadedFile = (
            parent,
            name,
            url,
            canRead,
            canWrite,
            onload,
            onerror,
            dontCreateFile,
            canOwn,
            preFinish,
        ) => {
            var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
            var dep = getUniqueRunDependency(`cp ${fullname}`);
            function processData(byteArray) {
                function finish(byteArray) {
                    preFinish?.();
                    if (!dontCreateFile) {
                        FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
                    }
                    onload?.();
                    removeRunDependency(dep);
                }
                if (
                    FS_handledByPreloadPlugin(byteArray, fullname, finish, () => {
                        onerror?.();
                        removeRunDependency(dep);
                    })
                ) {
                    return;
                }
                finish(byteArray);
            }
            addRunDependency(dep);
            if (typeof url == "string") {
                asyncLoad(url).then(processData, onerror);
            } else {
                processData(url);
            }
        };
        var FS_modeStringToFlags = (str) => {
            var flagModes = {
                r: 0,
                "r+": 2,
                w: 512 | 64 | 1,
                "w+": 512 | 64 | 2,
                a: 1024 | 64 | 1,
                "a+": 1024 | 64 | 2,
            };
            var flags = flagModes[str];
            if (typeof flags == "undefined") {
                throw new Error(`Unknown file open mode: ${str}`);
            }
            return flags;
        };
        var FS_getMode = (canRead, canWrite) => {
            var mode = 0;
            if (canRead) mode |= 292 | 73;
            if (canWrite) mode |= 146;
            return mode;
        };
        var FS = {
            root: null,
            mounts: [],
            devices: {},
            streams: [],
            nextInode: 1,
            nameTable: null,
            currentPath: "/",
            initialized: false,
            ignorePermissions: true,
            filesystems: null,
            syncFSRequests: 0,
            readFiles: {},
            ErrnoError: class {
                name = "ErrnoError";
                constructor(errno) {
                    this.errno = errno;
                }
            },
            FSStream: class {
                shared = {};
                get object() {
                    return this.node;
                }
                set object(val) {
                    this.node = val;
                }
                get isRead() {
                    return (this.flags & 2097155) !== 1;
                }
                get isWrite() {
                    return (this.flags & 2097155) !== 0;
                }
                get isAppend() {
                    return this.flags & 1024;
                }
                get flags() {
                    return this.shared.flags;
                }
                set flags(val) {
                    this.shared.flags = val;
                }
                get position() {
                    return this.shared.position;
                }
                set position(val) {
                    this.shared.position = val;
                }
            },
            FSNode: class {
                node_ops = {};
                stream_ops = {};
                readMode = 292 | 73;
                writeMode = 146;
                mounted = null;
                constructor(parent, name, mode, rdev) {
                    if (!parent) {
                        parent = this;
                    }
                    this.parent = parent;
                    this.mount = parent.mount;
                    this.id = FS.nextInode++;
                    this.name = name;
                    this.mode = mode;
                    this.rdev = rdev;
                    this.atime = this.mtime = this.ctime = Date.now();
                }
                get read() {
                    return (this.mode & this.readMode) === this.readMode;
                }
                set read(val) {
                    val ? (this.mode |= this.readMode) : (this.mode &= ~this.readMode);
                }
                get write() {
                    return (this.mode & this.writeMode) === this.writeMode;
                }
                set write(val) {
                    val ? (this.mode |= this.writeMode) : (this.mode &= ~this.writeMode);
                }
                get isFolder() {
                    return FS.isDir(this.mode);
                }
                get isDevice() {
                    return FS.isChrdev(this.mode);
                }
            },
            lookupPath(path, opts = {}) {
                if (!path) {
                    throw new FS.ErrnoError(44);
                }
                opts.follow_mount ??= true;
                if (!PATH.isAbs(path)) {
                    path = FS.cwd() + "/" + path;
                }
                linkloop: for (var nlinks = 0; nlinks < 40; nlinks++) {
                    var parts = path.split("/").filter((p) => !!p);
                    var current = FS.root;
                    var current_path = "/";
                    for (var i = 0; i < parts.length; i++) {
                        var islast = i === parts.length - 1;
                        if (islast && opts.parent) {
                            break;
                        }
                        if (parts[i] === ".") {
                            continue;
                        }
                        if (parts[i] === "..") {
                            current_path = PATH.dirname(current_path);
                            if (FS.isRoot(current)) {
                                path = current_path + "/" + parts.slice(i + 1).join("/");
                                continue linkloop;
                            } else {
                                current = current.parent;
                            }
                            continue;
                        }
                        current_path = PATH.join2(current_path, parts[i]);
                        try {
                            current = FS.lookupNode(current, parts[i]);
                        } catch (e) {
                            if (e?.errno === 44 && islast && opts.noent_okay) {
                                return { path: current_path };
                            }
                            throw e;
                        }
                        if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
                            current = current.mounted.root;
                        }
                        if (FS.isLink(current.mode) && (!islast || opts.follow)) {
                            if (!current.node_ops.readlink) {
                                throw new FS.ErrnoError(52);
                            }
                            var link = current.node_ops.readlink(current);
                            if (!PATH.isAbs(link)) {
                                link = PATH.dirname(current_path) + "/" + link;
                            }
                            path = link + "/" + parts.slice(i + 1).join("/");
                            continue linkloop;
                        }
                    }
                    return { path: current_path, node: current };
                }
                throw new FS.ErrnoError(32);
            },
            getPath(node) {
                var path;
                while (true) {
                    if (FS.isRoot(node)) {
                        var mount = node.mount.mountpoint;
                        if (!path) return mount;
                        return mount[mount.length - 1] !== "/" ? `${mount}/${path}` : mount + path;
                    }
                    path = path ? `${node.name}/${path}` : node.name;
                    node = node.parent;
                }
            },
            hashName(parentid, name) {
                var hash = 0;
                for (var i = 0; i < name.length; i++) {
                    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
                }
                return ((parentid + hash) >>> 0) % FS.nameTable.length;
            },
            hashAddNode(node) {
                var hash = FS.hashName(node.parent.id, node.name);
                node.name_next = FS.nameTable[hash];
                FS.nameTable[hash] = node;
            },
            hashRemoveNode(node) {
                var hash = FS.hashName(node.parent.id, node.name);
                if (FS.nameTable[hash] === node) {
                    FS.nameTable[hash] = node.name_next;
                } else {
                    var current = FS.nameTable[hash];
                    while (current) {
                        if (current.name_next === node) {
                            current.name_next = node.name_next;
                            break;
                        }
                        current = current.name_next;
                    }
                }
            },
            lookupNode(parent, name) {
                var errCode = FS.mayLookup(parent);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                var hash = FS.hashName(parent.id, name);
                for (var node = FS.nameTable[hash]; node; node = node.name_next) {
                    var nodeName = node.name;
                    if (node.parent.id === parent.id && nodeName === name) {
                        return node;
                    }
                }
                return FS.lookup(parent, name);
            },
            createNode(parent, name, mode, rdev) {
                var node = new FS.FSNode(parent, name, mode, rdev);
                FS.hashAddNode(node);
                return node;
            },
            destroyNode(node) {
                FS.hashRemoveNode(node);
            },
            isRoot(node) {
                return node === node.parent;
            },
            isMountpoint(node) {
                return !!node.mounted;
            },
            isFile(mode) {
                return (mode & 61440) === 32768;
            },
            isDir(mode) {
                return (mode & 61440) === 16384;
            },
            isLink(mode) {
                return (mode & 61440) === 40960;
            },
            isChrdev(mode) {
                return (mode & 61440) === 8192;
            },
            isBlkdev(mode) {
                return (mode & 61440) === 24576;
            },
            isFIFO(mode) {
                return (mode & 61440) === 4096;
            },
            isSocket(mode) {
                return (mode & 49152) === 49152;
            },
            flagsToPermissionString(flag) {
                var perms = ["r", "w", "rw"][flag & 3];
                if (flag & 512) {
                    perms += "w";
                }
                return perms;
            },
            nodePermissions(node, perms) {
                if (FS.ignorePermissions) {
                    return 0;
                }
                if (perms.includes("r") && !(node.mode & 292)) {
                    return 2;
                } else if (perms.includes("w") && !(node.mode & 146)) {
                    return 2;
                } else if (perms.includes("x") && !(node.mode & 73)) {
                    return 2;
                }
                return 0;
            },
            mayLookup(dir) {
                if (!FS.isDir(dir.mode)) return 54;
                var errCode = FS.nodePermissions(dir, "x");
                if (errCode) return errCode;
                if (!dir.node_ops.lookup) return 2;
                return 0;
            },
            mayCreate(dir, name) {
                if (!FS.isDir(dir.mode)) {
                    return 54;
                }
                try {
                    var node = FS.lookupNode(dir, name);
                    return 20;
                } catch (e) {}
                return FS.nodePermissions(dir, "wx");
            },
            mayDelete(dir, name, isdir) {
                var node;
                try {
                    node = FS.lookupNode(dir, name);
                } catch (e) {
                    return e.errno;
                }
                var errCode = FS.nodePermissions(dir, "wx");
                if (errCode) {
                    return errCode;
                }
                if (isdir) {
                    if (!FS.isDir(node.mode)) {
                        return 54;
                    }
                    if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
                        return 10;
                    }
                } else {
                    if (FS.isDir(node.mode)) {
                        return 31;
                    }
                }
                return 0;
            },
            mayOpen(node, flags) {
                if (!node) {
                    return 44;
                }
                if (FS.isLink(node.mode)) {
                    return 32;
                } else if (FS.isDir(node.mode)) {
                    if (FS.flagsToPermissionString(flags) !== "r" || flags & (512 | 64)) {
                        return 31;
                    }
                }
                return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
            },
            checkOpExists(op, err) {
                if (!op) {
                    throw new FS.ErrnoError(err);
                }
                return op;
            },
            MAX_OPEN_FDS: 4096,
            nextfd() {
                for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
                    if (!FS.streams[fd]) {
                        return fd;
                    }
                }
                throw new FS.ErrnoError(33);
            },
            getStreamChecked(fd) {
                var stream = FS.getStream(fd);
                if (!stream) {
                    throw new FS.ErrnoError(8);
                }
                return stream;
            },
            getStream: (fd) => FS.streams[fd],
            createStream(stream, fd = -1) {
                stream = Object.assign(new FS.FSStream(), stream);
                if (fd == -1) {
                    fd = FS.nextfd();
                }
                stream.fd = fd;
                FS.streams[fd] = stream;
                return stream;
            },
            closeStream(fd) {
                FS.streams[fd] = null;
            },
            dupStream(origStream, fd = -1) {
                var stream = FS.createStream(origStream, fd);
                stream.stream_ops?.dup?.(stream);
                return stream;
            },
            doSetAttr(stream, node, attr) {
                var setattr = stream?.stream_ops.setattr;
                var arg = setattr ? stream : node;
                setattr ??= node.node_ops.setattr;
                FS.checkOpExists(setattr, 63);
                setattr(arg, attr);
            },
            chrdev_stream_ops: {
                open(stream) {
                    var device = FS.getDevice(stream.node.rdev);
                    stream.stream_ops = device.stream_ops;
                    stream.stream_ops.open?.(stream);
                },
                llseek() {
                    throw new FS.ErrnoError(70);
                },
            },
            major: (dev) => dev >> 8,
            minor: (dev) => dev & 255,
            makedev: (ma, mi) => (ma << 8) | mi,
            registerDevice(dev, ops) {
                FS.devices[dev] = { stream_ops: ops };
            },
            getDevice: (dev) => FS.devices[dev],
            getMounts(mount) {
                var mounts = [];
                var check = [mount];
                while (check.length) {
                    var m = check.pop();
                    mounts.push(m);
                    check.push(...m.mounts);
                }
                return mounts;
            },
            syncfs(populate, callback) {
                if (typeof populate == "function") {
                    callback = populate;
                    populate = false;
                }
                FS.syncFSRequests++;
                if (FS.syncFSRequests > 1) {
                    err(
                        `warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`,
                    );
                }
                var mounts = FS.getMounts(FS.root.mount);
                var completed = 0;
                function doCallback(errCode) {
                    FS.syncFSRequests--;
                    return callback(errCode);
                }
                function done(errCode) {
                    if (errCode) {
                        if (!done.errored) {
                            done.errored = true;
                            return doCallback(errCode);
                        }
                        return;
                    }
                    if (++completed >= mounts.length) {
                        doCallback(null);
                    }
                }
                mounts.forEach((mount) => {
                    if (!mount.type.syncfs) {
                        return done(null);
                    }
                    mount.type.syncfs(mount, populate, done);
                });
            },
            mount(type, opts, mountpoint) {
                var root = mountpoint === "/";
                var pseudo = !mountpoint;
                var node;
                if (root && FS.root) {
                    throw new FS.ErrnoError(10);
                } else if (!root && !pseudo) {
                    var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
                    mountpoint = lookup.path;
                    node = lookup.node;
                    if (FS.isMountpoint(node)) {
                        throw new FS.ErrnoError(10);
                    }
                    if (!FS.isDir(node.mode)) {
                        throw new FS.ErrnoError(54);
                    }
                }
                var mount = { type, opts, mountpoint, mounts: [] };
                var mountRoot = type.mount(mount);
                mountRoot.mount = mount;
                mount.root = mountRoot;
                if (root) {
                    FS.root = mountRoot;
                } else if (node) {
                    node.mounted = mount;
                    if (node.mount) {
                        node.mount.mounts.push(mount);
                    }
                }
                return mountRoot;
            },
            unmount(mountpoint) {
                var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
                if (!FS.isMountpoint(lookup.node)) {
                    throw new FS.ErrnoError(28);
                }
                var node = lookup.node;
                var mount = node.mounted;
                var mounts = FS.getMounts(mount);
                Object.keys(FS.nameTable).forEach((hash) => {
                    var current = FS.nameTable[hash];
                    while (current) {
                        var next = current.name_next;
                        if (mounts.includes(current.mount)) {
                            FS.destroyNode(current);
                        }
                        current = next;
                    }
                });
                node.mounted = null;
                var idx = node.mount.mounts.indexOf(mount);
                node.mount.mounts.splice(idx, 1);
            },
            lookup(parent, name) {
                return parent.node_ops.lookup(parent, name);
            },
            mknod(path, mode, dev) {
                var lookup = FS.lookupPath(path, { parent: true });
                var parent = lookup.node;
                var name = PATH.basename(path);
                if (!name) {
                    throw new FS.ErrnoError(28);
                }
                if (name === "." || name === "..") {
                    throw new FS.ErrnoError(20);
                }
                var errCode = FS.mayCreate(parent, name);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                if (!parent.node_ops.mknod) {
                    throw new FS.ErrnoError(63);
                }
                return parent.node_ops.mknod(parent, name, mode, dev);
            },
            statfs(path) {
                return FS.statfsNode(FS.lookupPath(path, { follow: true }).node);
            },
            statfsStream(stream) {
                return FS.statfsNode(stream.node);
            },
            statfsNode(node) {
                var rtn = {
                    bsize: 4096,
                    frsize: 4096,
                    blocks: 1e6,
                    bfree: 5e5,
                    bavail: 5e5,
                    files: FS.nextInode,
                    ffree: FS.nextInode - 1,
                    fsid: 42,
                    flags: 2,
                    namelen: 255,
                };
                if (node.node_ops.statfs) {
                    Object.assign(rtn, node.node_ops.statfs(node.mount.opts.root));
                }
                return rtn;
            },
            create(path, mode = 438) {
                mode &= 4095;
                mode |= 32768;
                return FS.mknod(path, mode, 0);
            },
            mkdir(path, mode = 511) {
                mode &= 511 | 512;
                mode |= 16384;
                return FS.mknod(path, mode, 0);
            },
            mkdirTree(path, mode) {
                var dirs = path.split("/");
                var d = "";
                for (var dir of dirs) {
                    if (!dir) continue;
                    if (d || PATH.isAbs(path)) d += "/";
                    d += dir;
                    try {
                        FS.mkdir(d, mode);
                    } catch (e) {
                        if (e.errno != 20) throw e;
                    }
                }
            },
            mkdev(path, mode, dev) {
                if (typeof dev == "undefined") {
                    dev = mode;
                    mode = 438;
                }
                mode |= 8192;
                return FS.mknod(path, mode, dev);
            },
            symlink(oldpath, newpath) {
                if (!PATH_FS.resolve(oldpath)) {
                    throw new FS.ErrnoError(44);
                }
                var lookup = FS.lookupPath(newpath, { parent: true });
                var parent = lookup.node;
                if (!parent) {
                    throw new FS.ErrnoError(44);
                }
                var newname = PATH.basename(newpath);
                var errCode = FS.mayCreate(parent, newname);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                if (!parent.node_ops.symlink) {
                    throw new FS.ErrnoError(63);
                }
                return parent.node_ops.symlink(parent, newname, oldpath);
            },
            rename(old_path, new_path) {
                var old_dirname = PATH.dirname(old_path);
                var new_dirname = PATH.dirname(new_path);
                var old_name = PATH.basename(old_path);
                var new_name = PATH.basename(new_path);
                var lookup, old_dir, new_dir;
                lookup = FS.lookupPath(old_path, { parent: true });
                old_dir = lookup.node;
                lookup = FS.lookupPath(new_path, { parent: true });
                new_dir = lookup.node;
                if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
                if (old_dir.mount !== new_dir.mount) {
                    throw new FS.ErrnoError(75);
                }
                var old_node = FS.lookupNode(old_dir, old_name);
                var relative = PATH_FS.relative(old_path, new_dirname);
                if (relative.charAt(0) !== ".") {
                    throw new FS.ErrnoError(28);
                }
                relative = PATH_FS.relative(new_path, old_dirname);
                if (relative.charAt(0) !== ".") {
                    throw new FS.ErrnoError(55);
                }
                var new_node;
                try {
                    new_node = FS.lookupNode(new_dir, new_name);
                } catch (e) {}
                if (old_node === new_node) {
                    return;
                }
                var isdir = FS.isDir(old_node.mode);
                var errCode = FS.mayDelete(old_dir, old_name, isdir);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                errCode = new_node
                    ? FS.mayDelete(new_dir, new_name, isdir)
                    : FS.mayCreate(new_dir, new_name);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                if (!old_dir.node_ops.rename) {
                    throw new FS.ErrnoError(63);
                }
                if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
                    throw new FS.ErrnoError(10);
                }
                if (new_dir !== old_dir) {
                    errCode = FS.nodePermissions(old_dir, "w");
                    if (errCode) {
                        throw new FS.ErrnoError(errCode);
                    }
                }
                FS.hashRemoveNode(old_node);
                try {
                    old_dir.node_ops.rename(old_node, new_dir, new_name);
                    old_node.parent = new_dir;
                } catch (e) {
                    throw e;
                } finally {
                    FS.hashAddNode(old_node);
                }
            },
            rmdir(path) {
                var lookup = FS.lookupPath(path, { parent: true });
                var parent = lookup.node;
                var name = PATH.basename(path);
                var node = FS.lookupNode(parent, name);
                var errCode = FS.mayDelete(parent, name, true);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                if (!parent.node_ops.rmdir) {
                    throw new FS.ErrnoError(63);
                }
                if (FS.isMountpoint(node)) {
                    throw new FS.ErrnoError(10);
                }
                parent.node_ops.rmdir(parent, name);
                FS.destroyNode(node);
            },
            readdir(path) {
                var lookup = FS.lookupPath(path, { follow: true });
                var node = lookup.node;
                var readdir = FS.checkOpExists(node.node_ops.readdir, 54);
                return readdir(node);
            },
            unlink(path) {
                var lookup = FS.lookupPath(path, { parent: true });
                var parent = lookup.node;
                if (!parent) {
                    throw new FS.ErrnoError(44);
                }
                var name = PATH.basename(path);
                var node = FS.lookupNode(parent, name);
                var errCode = FS.mayDelete(parent, name, false);
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                if (!parent.node_ops.unlink) {
                    throw new FS.ErrnoError(63);
                }
                if (FS.isMountpoint(node)) {
                    throw new FS.ErrnoError(10);
                }
                parent.node_ops.unlink(parent, name);
                FS.destroyNode(node);
            },
            readlink(path) {
                var lookup = FS.lookupPath(path);
                var link = lookup.node;
                if (!link) {
                    throw new FS.ErrnoError(44);
                }
                if (!link.node_ops.readlink) {
                    throw new FS.ErrnoError(28);
                }
                return link.node_ops.readlink(link);
            },
            stat(path, dontFollow) {
                var lookup = FS.lookupPath(path, { follow: !dontFollow });
                var node = lookup.node;
                var getattr = FS.checkOpExists(node.node_ops.getattr, 63);
                return getattr(node);
            },
            fstat(fd) {
                var stream = FS.getStreamChecked(fd);
                var node = stream.node;
                var getattr = stream.stream_ops.getattr;
                var arg = getattr ? stream : node;
                getattr ??= node.node_ops.getattr;
                FS.checkOpExists(getattr, 63);
                return getattr(arg);
            },
            lstat(path) {
                return FS.stat(path, true);
            },
            doChmod(stream, node, mode, dontFollow) {
                FS.doSetAttr(stream, node, {
                    mode: (mode & 4095) | (node.mode & ~4095),
                    ctime: Date.now(),
                    dontFollow,
                });
            },
            chmod(path, mode, dontFollow) {
                var node;
                if (typeof path == "string") {
                    var lookup = FS.lookupPath(path, { follow: !dontFollow });
                    node = lookup.node;
                } else {
                    node = path;
                }
                FS.doChmod(null, node, mode, dontFollow);
            },
            lchmod(path, mode) {
                FS.chmod(path, mode, true);
            },
            fchmod(fd, mode) {
                var stream = FS.getStreamChecked(fd);
                FS.doChmod(stream, stream.node, mode, false);
            },
            doChown(stream, node, dontFollow) {
                FS.doSetAttr(stream, node, { timestamp: Date.now(), dontFollow });
            },
            chown(path, uid, gid, dontFollow) {
                var node;
                if (typeof path == "string") {
                    var lookup = FS.lookupPath(path, { follow: !dontFollow });
                    node = lookup.node;
                } else {
                    node = path;
                }
                FS.doChown(null, node, dontFollow);
            },
            lchown(path, uid, gid) {
                FS.chown(path, uid, gid, true);
            },
            fchown(fd, uid, gid) {
                var stream = FS.getStreamChecked(fd);
                FS.doChown(stream, stream.node, false);
            },
            doTruncate(stream, node, len) {
                if (FS.isDir(node.mode)) {
                    throw new FS.ErrnoError(31);
                }
                if (!FS.isFile(node.mode)) {
                    throw new FS.ErrnoError(28);
                }
                var errCode = FS.nodePermissions(node, "w");
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                FS.doSetAttr(stream, node, { size: len, timestamp: Date.now() });
            },
            truncate(path, len) {
                if (len < 0) {
                    throw new FS.ErrnoError(28);
                }
                var node;
                if (typeof path == "string") {
                    var lookup = FS.lookupPath(path, { follow: true });
                    node = lookup.node;
                } else {
                    node = path;
                }
                FS.doTruncate(null, node, len);
            },
            ftruncate(fd, len) {
                var stream = FS.getStreamChecked(fd);
                if (len < 0 || (stream.flags & 2097155) === 0) {
                    throw new FS.ErrnoError(28);
                }
                FS.doTruncate(stream, stream.node, len);
            },
            utime(path, atime, mtime) {
                var lookup = FS.lookupPath(path, { follow: true });
                var node = lookup.node;
                var setattr = FS.checkOpExists(node.node_ops.setattr, 63);
                setattr(node, { atime, mtime });
            },
            open(path, flags, mode = 438) {
                if (path === "") {
                    throw new FS.ErrnoError(44);
                }
                flags = typeof flags == "string" ? FS_modeStringToFlags(flags) : flags;
                if (flags & 64) {
                    mode = (mode & 4095) | 32768;
                } else {
                    mode = 0;
                }
                var node;
                var isDirPath;
                if (typeof path == "object") {
                    node = path;
                } else {
                    isDirPath = path.endsWith("/");
                    var lookup = FS.lookupPath(path, { follow: !(flags & 131072), noent_okay: true });
                    node = lookup.node;
                    path = lookup.path;
                }
                var created = false;
                if (flags & 64) {
                    if (node) {
                        if (flags & 128) {
                            throw new FS.ErrnoError(20);
                        }
                    } else if (isDirPath) {
                        throw new FS.ErrnoError(31);
                    } else {
                        node = FS.mknod(path, mode | 511, 0);
                        created = true;
                    }
                }
                if (!node) {
                    throw new FS.ErrnoError(44);
                }
                if (FS.isChrdev(node.mode)) {
                    flags &= ~512;
                }
                if (flags & 65536 && !FS.isDir(node.mode)) {
                    throw new FS.ErrnoError(54);
                }
                if (!created) {
                    var errCode = FS.mayOpen(node, flags);
                    if (errCode) {
                        throw new FS.ErrnoError(errCode);
                    }
                }
                if (flags & 512 && !created) {
                    FS.truncate(node, 0);
                }
                flags &= ~(128 | 512 | 131072);
                var stream = FS.createStream({
                    node,
                    path: FS.getPath(node),
                    flags,
                    seekable: true,
                    position: 0,
                    stream_ops: node.stream_ops,
                    ungotten: [],
                    error: false,
                });
                if (stream.stream_ops.open) {
                    stream.stream_ops.open(stream);
                }
                if (created) {
                    FS.chmod(node, mode & 511);
                }
                if (Module["logReadFiles"] && !(flags & 1)) {
                    if (!(path in FS.readFiles)) {
                        FS.readFiles[path] = 1;
                    }
                }
                return stream;
            },
            close(stream) {
                if (FS.isClosed(stream)) {
                    throw new FS.ErrnoError(8);
                }
                if (stream.getdents) stream.getdents = null;
                try {
                    if (stream.stream_ops.close) {
                        stream.stream_ops.close(stream);
                    }
                } catch (e) {
                    throw e;
                } finally {
                    FS.closeStream(stream.fd);
                }
                stream.fd = null;
            },
            isClosed(stream) {
                return stream.fd === null;
            },
            llseek(stream, offset, whence) {
                if (FS.isClosed(stream)) {
                    throw new FS.ErrnoError(8);
                }
                if (!stream.seekable || !stream.stream_ops.llseek) {
                    throw new FS.ErrnoError(70);
                }
                if (whence != 0 && whence != 1 && whence != 2) {
                    throw new FS.ErrnoError(28);
                }
                stream.position = stream.stream_ops.llseek(stream, offset, whence);
                stream.ungotten = [];
                return stream.position;
            },
            read(stream, buffer, offset, length, position) {
                if (length < 0 || position < 0) {
                    throw new FS.ErrnoError(28);
                }
                if (FS.isClosed(stream)) {
                    throw new FS.ErrnoError(8);
                }
                if ((stream.flags & 2097155) === 1) {
                    throw new FS.ErrnoError(8);
                }
                if (FS.isDir(stream.node.mode)) {
                    throw new FS.ErrnoError(31);
                }
                if (!stream.stream_ops.read) {
                    throw new FS.ErrnoError(28);
                }
                var seeking = typeof position != "undefined";
                if (!seeking) {
                    position = stream.position;
                } else if (!stream.seekable) {
                    throw new FS.ErrnoError(70);
                }
                var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
                if (!seeking) stream.position += bytesRead;
                return bytesRead;
            },
            write(stream, buffer, offset, length, position, canOwn) {
                if (length < 0 || position < 0) {
                    throw new FS.ErrnoError(28);
                }
                if (FS.isClosed(stream)) {
                    throw new FS.ErrnoError(8);
                }
                if ((stream.flags & 2097155) === 0) {
                    throw new FS.ErrnoError(8);
                }
                if (FS.isDir(stream.node.mode)) {
                    throw new FS.ErrnoError(31);
                }
                if (!stream.stream_ops.write) {
                    throw new FS.ErrnoError(28);
                }
                if (stream.seekable && stream.flags & 1024) {
                    FS.llseek(stream, 0, 2);
                }
                var seeking = typeof position != "undefined";
                if (!seeking) {
                    position = stream.position;
                } else if (!stream.seekable) {
                    throw new FS.ErrnoError(70);
                }
                var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
                if (!seeking) stream.position += bytesWritten;
                return bytesWritten;
            },
            mmap(stream, length, position, prot, flags) {
                if ((prot & 2) !== 0 && (flags & 2) === 0 && (stream.flags & 2097155) !== 2) {
                    throw new FS.ErrnoError(2);
                }
                if ((stream.flags & 2097155) === 1) {
                    throw new FS.ErrnoError(2);
                }
                if (!stream.stream_ops.mmap) {
                    throw new FS.ErrnoError(43);
                }
                if (!length) {
                    throw new FS.ErrnoError(28);
                }
                return stream.stream_ops.mmap(stream, length, position, prot, flags);
            },
            msync(stream, buffer, offset, length, mmapFlags) {
                if (!stream.stream_ops.msync) {
                    return 0;
                }
                return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
            },
            ioctl(stream, cmd, arg) {
                if (!stream.stream_ops.ioctl) {
                    throw new FS.ErrnoError(59);
                }
                return stream.stream_ops.ioctl(stream, cmd, arg);
            },
            readFile(path, opts = {}) {
                opts.flags = opts.flags || 0;
                opts.encoding = opts.encoding || "binary";
                if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
                    throw new Error(`Invalid encoding type "${opts.encoding}"`);
                }
                var ret;
                var stream = FS.open(path, opts.flags);
                var stat = FS.stat(path);
                var length = stat.size;
                var buf = new Uint8Array(length);
                FS.read(stream, buf, 0, length, 0);
                if (opts.encoding === "utf8") {
                    ret = UTF8ArrayToString(buf);
                } else if (opts.encoding === "binary") {
                    ret = buf;
                }
                FS.close(stream);
                return ret;
            },
            writeFile(path, data, opts = {}) {
                opts.flags = opts.flags || 577;
                var stream = FS.open(path, opts.flags, opts.mode);
                if (typeof data == "string") {
                    var buf = new Uint8Array(lengthBytesUTF8(data) + 1);
                    var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
                    FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
                } else if (ArrayBuffer.isView(data)) {
                    FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
                } else {
                    throw new Error("Unsupported data type");
                }
                FS.close(stream);
            },
            cwd: () => FS.currentPath,
            chdir(path) {
                var lookup = FS.lookupPath(path, { follow: true });
                if (lookup.node === null) {
                    throw new FS.ErrnoError(44);
                }
                if (!FS.isDir(lookup.node.mode)) {
                    throw new FS.ErrnoError(54);
                }
                var errCode = FS.nodePermissions(lookup.node, "x");
                if (errCode) {
                    throw new FS.ErrnoError(errCode);
                }
                FS.currentPath = lookup.path;
            },
            createDefaultDirectories() {
                FS.mkdir("/tmp");
                FS.mkdir("/home");
                FS.mkdir("/home/web_user");
            },
            createDefaultDevices() {
                FS.mkdir("/dev");
                FS.registerDevice(FS.makedev(1, 3), {
                    read: () => 0,
                    write: (stream, buffer, offset, length, pos) => length,
                    llseek: () => 0,
                });
                FS.mkdev("/dev/null", FS.makedev(1, 3));
                TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
                TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
                FS.mkdev("/dev/tty", FS.makedev(5, 0));
                FS.mkdev("/dev/tty1", FS.makedev(6, 0));
                var randomBuffer = new Uint8Array(1024),
                    randomLeft = 0;
                var randomByte = () => {
                    if (randomLeft === 0) {
                        randomFill(randomBuffer);
                        randomLeft = randomBuffer.byteLength;
                    }
                    return randomBuffer[--randomLeft];
                };
                FS.createDevice("/dev", "random", randomByte);
                FS.createDevice("/dev", "urandom", randomByte);
                FS.mkdir("/dev/shm");
                FS.mkdir("/dev/shm/tmp");
            },
            createSpecialDirectories() {
                FS.mkdir("/proc");
                var proc_self = FS.mkdir("/proc/self");
                FS.mkdir("/proc/self/fd");
                FS.mount(
                    {
                        mount() {
                            var node = FS.createNode(proc_self, "fd", 16895, 73);
                            node.stream_ops = { llseek: MEMFS.stream_ops.llseek };
                            node.node_ops = {
                                lookup(parent, name) {
                                    var fd = +name;
                                    var stream = FS.getStreamChecked(fd);
                                    var ret = {
                                        parent: null,
                                        mount: { mountpoint: "fake" },
                                        node_ops: { readlink: () => stream.path },
                                        id: fd + 1,
                                    };
                                    ret.parent = ret;
                                    return ret;
                                },
                                readdir() {
                                    return Array.from(FS.streams.entries())
                                        .filter(([k, v]) => v)
                                        .map(([k, v]) => k.toString());
                                },
                            };
                            return node;
                        },
                    },
                    {},
                    "/proc/self/fd",
                );
            },
            createStandardStreams(input, output, error) {
                if (input) {
                    FS.createDevice("/dev", "stdin", input);
                } else {
                    FS.symlink("/dev/tty", "/dev/stdin");
                }
                if (output) {
                    FS.createDevice("/dev", "stdout", null, output);
                } else {
                    FS.symlink("/dev/tty", "/dev/stdout");
                }
                if (error) {
                    FS.createDevice("/dev", "stderr", null, error);
                } else {
                    FS.symlink("/dev/tty1", "/dev/stderr");
                }
                var stdin = FS.open("/dev/stdin", 0);
                var stdout = FS.open("/dev/stdout", 1);
                var stderr = FS.open("/dev/stderr", 1);
            },
            staticInit() {
                FS.nameTable = new Array(4096);
                FS.mount(MEMFS, {}, "/");
                FS.createDefaultDirectories();
                FS.createDefaultDevices();
                FS.createSpecialDirectories();
                FS.filesystems = { MEMFS };
            },
            init(input, output, error) {
                FS.initialized = true;
                input ??= Module["stdin"];
                output ??= Module["stdout"];
                error ??= Module["stderr"];
                FS.createStandardStreams(input, output, error);
            },
            quit() {
                FS.initialized = false;
                for (var stream of FS.streams) {
                    if (stream) {
                        FS.close(stream);
                    }
                }
            },
            findObject(path, dontResolveLastLink) {
                var ret = FS.analyzePath(path, dontResolveLastLink);
                if (!ret.exists) {
                    return null;
                }
                return ret.object;
            },
            analyzePath(path, dontResolveLastLink) {
                try {
                    var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
                    path = lookup.path;
                } catch (e) {}
                var ret = {
                    isRoot: false,
                    exists: false,
                    error: 0,
                    name: null,
                    path: null,
                    object: null,
                    parentExists: false,
                    parentPath: null,
                    parentObject: null,
                };
                try {
                    var lookup = FS.lookupPath(path, { parent: true });
                    ret.parentExists = true;
                    ret.parentPath = lookup.path;
                    ret.parentObject = lookup.node;
                    ret.name = PATH.basename(path);
                    lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
                    ret.exists = true;
                    ret.path = lookup.path;
                    ret.object = lookup.node;
                    ret.name = lookup.node.name;
                    ret.isRoot = lookup.path === "/";
                } catch (e) {
                    ret.error = e.errno;
                }
                return ret;
            },
            createPath(parent, path, canRead, canWrite) {
                parent = typeof parent == "string" ? parent : FS.getPath(parent);
                var parts = path.split("/").reverse();
                while (parts.length) {
                    var part = parts.pop();
                    if (!part) continue;
                    var current = PATH.join2(parent, part);
                    try {
                        FS.mkdir(current);
                    } catch (e) {
                        if (e.errno != 20) throw e;
                    }
                    parent = current;
                }
                return current;
            },
            createFile(parent, name, properties, canRead, canWrite) {
                var path = PATH.join2(typeof parent == "string" ? parent : FS.getPath(parent), name);
                var mode = FS_getMode(canRead, canWrite);
                return FS.create(path, mode);
            },
            createDataFile(parent, name, data, canRead, canWrite, canOwn) {
                var path = name;
                if (parent) {
                    parent = typeof parent == "string" ? parent : FS.getPath(parent);
                    path = name ? PATH.join2(parent, name) : parent;
                }
                var mode = FS_getMode(canRead, canWrite);
                var node = FS.create(path, mode);
                if (data) {
                    if (typeof data == "string") {
                        var arr = new Array(data.length);
                        for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
                        data = arr;
                    }
                    FS.chmod(node, mode | 146);
                    var stream = FS.open(node, 577);
                    FS.write(stream, data, 0, data.length, 0, canOwn);
                    FS.close(stream);
                    FS.chmod(node, mode);
                }
            },
            createDevice(parent, name, input, output) {
                var path = PATH.join2(typeof parent == "string" ? parent : FS.getPath(parent), name);
                var mode = FS_getMode(!!input, !!output);
                FS.createDevice.major ??= 64;
                var dev = FS.makedev(FS.createDevice.major++, 0);
                FS.registerDevice(dev, {
                    open(stream) {
                        stream.seekable = false;
                    },
                    close(stream) {
                        if (output?.buffer?.length) {
                            output(10);
                        }
                    },
                    read(stream, buffer, offset, length, pos) {
                        var bytesRead = 0;
                        for (var i = 0; i < length; i++) {
                            var result;
                            try {
                                result = input();
                            } catch (e) {
                                throw new FS.ErrnoError(29);
                            }
                            if (result === undefined && bytesRead === 0) {
                                throw new FS.ErrnoError(6);
                            }
                            if (result === null || result === undefined) break;
                            bytesRead++;
                            buffer[offset + i] = result;
                        }
                        if (bytesRead) {
                            stream.node.atime = Date.now();
                        }
                        return bytesRead;
                    },
                    write(stream, buffer, offset, length, pos) {
                        for (var i = 0; i < length; i++) {
                            try {
                                output(buffer[offset + i]);
                            } catch (e) {
                                throw new FS.ErrnoError(29);
                            }
                        }
                        if (length) {
                            stream.node.mtime = stream.node.ctime = Date.now();
                        }
                        return i;
                    },
                });
                return FS.mkdev(path, mode, dev);
            },
            forceLoadFile(obj) {
                if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
                if (typeof XMLHttpRequest != "undefined") {
                    throw new Error(
                        "Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.",
                    );
                } else {
                    try {
                        obj.contents = readBinary(obj.url);
                        obj.usedBytes = obj.contents.length;
                    } catch (e) {
                        throw new FS.ErrnoError(29);
                    }
                }
            },
            createLazyFile(parent, name, url, canRead, canWrite) {
                class LazyUint8Array {
                    lengthKnown = false;
                    chunks = [];
                    get(idx) {
                        if (idx > this.length - 1 || idx < 0) {
                            return undefined;
                        }
                        var chunkOffset = idx % this.chunkSize;
                        var chunkNum = (idx / this.chunkSize) | 0;
                        return this.getter(chunkNum)[chunkOffset];
                    }
                    setDataGetter(getter) {
                        this.getter = getter;
                    }
                    cacheLength() {
                        var xhr = new XMLHttpRequest();
                        xhr.open("HEAD", url, false);
                        xhr.send(null);
                        if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
                            throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
                        var datalength = Number(xhr.getResponseHeader("Content-length"));
                        var header;
                        var hasByteServing =
                            (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
                        var usesGzip =
                            (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
                        var chunkSize = 1024 * 1024;
                        if (!hasByteServing) chunkSize = datalength;
                        var doXHR = (from, to) => {
                            if (from > to)
                                throw new Error(
                                    "invalid range (" + from + ", " + to + ") or no bytes requested!",
                                );
                            if (to > datalength - 1)
                                throw new Error(
                                    "only " + datalength + " bytes available! programmer error!",
                                );
                            var xhr = new XMLHttpRequest();
                            xhr.open("GET", url, false);
                            if (datalength !== chunkSize)
                                xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
                            xhr.responseType = "arraybuffer";
                            if (xhr.overrideMimeType) {
                                xhr.overrideMimeType("text/plain; charset=x-user-defined");
                            }
                            xhr.send(null);
                            if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
                                throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
                            if (xhr.response !== undefined) {
                                return new Uint8Array(xhr.response || []);
                            }
                            return intArrayFromString(xhr.responseText || "", true);
                        };
                        var lazyArray = this;
                        lazyArray.setDataGetter((chunkNum) => {
                            var start = chunkNum * chunkSize;
                            var end = (chunkNum + 1) * chunkSize - 1;
                            end = Math.min(end, datalength - 1);
                            if (typeof lazyArray.chunks[chunkNum] == "undefined") {
                                lazyArray.chunks[chunkNum] = doXHR(start, end);
                            }
                            if (typeof lazyArray.chunks[chunkNum] == "undefined")
                                throw new Error("doXHR failed!");
                            return lazyArray.chunks[chunkNum];
                        });
                        if (usesGzip || !datalength) {
                            chunkSize = datalength = 1;
                            datalength = this.getter(0).length;
                            chunkSize = datalength;
                            out(
                                "LazyFiles on gzip forces download of the whole file when length is accessed",
                            );
                        }
                        this._length = datalength;
                        this._chunkSize = chunkSize;
                        this.lengthKnown = true;
                    }
                    get length() {
                        if (!this.lengthKnown) {
                            this.cacheLength();
                        }
                        return this._length;
                    }
                    get chunkSize() {
                        if (!this.lengthKnown) {
                            this.cacheLength();
                        }
                        return this._chunkSize;
                    }
                }
                if (typeof XMLHttpRequest != "undefined") {
                    if (!ENVIRONMENT_IS_WORKER)
                        throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
                    var lazyArray = new LazyUint8Array();
                    var properties = { isDevice: false, contents: lazyArray };
                } else {
                    var properties = { isDevice: false, url };
                }
                var node = FS.createFile(parent, name, properties, canRead, canWrite);
                if (properties.contents) {
                    node.contents = properties.contents;
                } else if (properties.url) {
                    node.contents = null;
                    node.url = properties.url;
                }
                Object.defineProperties(node, {
                    usedBytes: {
                        get: function () {
                            return this.contents.length;
                        },
                    },
                });
                var stream_ops = {};
                var keys = Object.keys(node.stream_ops);
                keys.forEach((key) => {
                    var fn = node.stream_ops[key];
                    stream_ops[key] = (...args) => {
                        FS.forceLoadFile(node);
                        return fn(...args);
                    };
                });
                function writeChunks(stream, buffer, offset, length, position) {
                    var contents = stream.node.contents;
                    if (position >= contents.length) return 0;
                    var size = Math.min(contents.length - position, length);
                    if (contents.slice) {
                        for (var i = 0; i < size; i++) {
                            buffer[offset + i] = contents[position + i];
                        }
                    } else {
                        for (var i = 0; i < size; i++) {
                            buffer[offset + i] = contents.get(position + i);
                        }
                    }
                    return size;
                }
                stream_ops.read = (stream, buffer, offset, length, position) => {
                    FS.forceLoadFile(node);
                    return writeChunks(stream, buffer, offset, length, position);
                };
                stream_ops.mmap = (stream, length, position, prot, flags) => {
                    FS.forceLoadFile(node);
                    var ptr = mmapAlloc(length);
                    if (!ptr) {
                        throw new FS.ErrnoError(48);
                    }
                    writeChunks(stream, HEAP8, ptr, length, position);
                    return { ptr, allocated: true };
                };
                node.stream_ops = stream_ops;
                return node;
            },
        };
        var UTF8ToString = (ptr, maxBytesToRead) => {
            ptr >>>= 0;
            return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
        };
        var SYSCALLS = {
            DEFAULT_POLLMASK: 5,
            calculateAt(dirfd, path, allowEmpty) {
                if (PATH.isAbs(path)) {
                    return path;
                }
                var dir;
                if (dirfd === -100) {
                    dir = FS.cwd();
                } else {
                    var dirstream = SYSCALLS.getStreamFromFD(dirfd);
                    dir = dirstream.path;
                }
                if (path.length == 0) {
                    if (!allowEmpty) {
                        throw new FS.ErrnoError(44);
                    }
                    return dir;
                }
                return dir + "/" + path;
            },
            writeStat(buf, stat) {
                HEAP32[(buf >>> 2) >>> 0] = stat.dev;
                HEAP32[((buf + 4) >>> 2) >>> 0] = stat.mode;
                HEAPU32[((buf + 8) >>> 2) >>> 0] = stat.nlink;
                HEAP32[((buf + 12) >>> 2) >>> 0] = stat.uid;
                HEAP32[((buf + 16) >>> 2) >>> 0] = stat.gid;
                HEAP32[((buf + 20) >>> 2) >>> 0] = stat.rdev;
                HEAP64[(buf + 24) >>> 3] = BigInt(stat.size);
                HEAP32[((buf + 32) >>> 2) >>> 0] = 4096;
                HEAP32[((buf + 36) >>> 2) >>> 0] = stat.blocks;
                var atime = stat.atime.getTime();
                var mtime = stat.mtime.getTime();
                var ctime = stat.ctime.getTime();
                HEAP64[(buf + 40) >>> 3] = BigInt(Math.floor(atime / 1e3));
                HEAPU32[((buf + 48) >>> 2) >>> 0] = (atime % 1e3) * 1e3 * 1e3;
                HEAP64[(buf + 56) >>> 3] = BigInt(Math.floor(mtime / 1e3));
                HEAPU32[((buf + 64) >>> 2) >>> 0] = (mtime % 1e3) * 1e3 * 1e3;
                HEAP64[(buf + 72) >>> 3] = BigInt(Math.floor(ctime / 1e3));
                HEAPU32[((buf + 80) >>> 2) >>> 0] = (ctime % 1e3) * 1e3 * 1e3;
                HEAP64[(buf + 88) >>> 3] = BigInt(stat.ino);
                return 0;
            },
            writeStatFs(buf, stats) {
                HEAP32[((buf + 4) >>> 2) >>> 0] = stats.bsize;
                HEAP32[((buf + 40) >>> 2) >>> 0] = stats.bsize;
                HEAP32[((buf + 8) >>> 2) >>> 0] = stats.blocks;
                HEAP32[((buf + 12) >>> 2) >>> 0] = stats.bfree;
                HEAP32[((buf + 16) >>> 2) >>> 0] = stats.bavail;
                HEAP32[((buf + 20) >>> 2) >>> 0] = stats.files;
                HEAP32[((buf + 24) >>> 2) >>> 0] = stats.ffree;
                HEAP32[((buf + 28) >>> 2) >>> 0] = stats.fsid;
                HEAP32[((buf + 44) >>> 2) >>> 0] = stats.flags;
                HEAP32[((buf + 36) >>> 2) >>> 0] = stats.namelen;
            },
            doMsync(addr, stream, len, flags, offset) {
                if (!FS.isFile(stream.node.mode)) {
                    throw new FS.ErrnoError(43);
                }
                if (flags & 2) {
                    return 0;
                }
                var buffer = HEAPU8.slice(addr, addr + len);
                FS.msync(stream, buffer, offset, len, flags);
            },
            getStreamFromFD(fd) {
                var stream = FS.getStreamChecked(fd);
                return stream;
            },
            varargs: undefined,
            getStr(ptr) {
                var ret = UTF8ToString(ptr);
                return ret;
            },
        };
        function ___syscall_chmod(path, mode) {
            path >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                FS.chmod(path, mode);
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_faccessat(dirfd, path, amode, flags) {
            path >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                path = SYSCALLS.calculateAt(dirfd, path);
                if (amode & ~7) {
                    return -28;
                }
                var lookup = FS.lookupPath(path, { follow: true });
                var node = lookup.node;
                if (!node) {
                    return -44;
                }
                var perms = "";
                if (amode & 4) perms += "r";
                if (amode & 2) perms += "w";
                if (amode & 1) perms += "x";
                if (perms && FS.nodePermissions(node, perms)) {
                    return -2;
                }
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        var syscallGetVarargI = () => {
            var ret = HEAP32[(+SYSCALLS.varargs >>> 2) >>> 0];
            SYSCALLS.varargs += 4;
            return ret;
        };
        var syscallGetVarargP = syscallGetVarargI;
        function ___syscall_fcntl64(fd, cmd, varargs) {
            varargs >>>= 0;
            SYSCALLS.varargs = varargs;
            try {
                var stream = SYSCALLS.getStreamFromFD(fd);
                switch (cmd) {
                    case 0: {
                        var arg = syscallGetVarargI();
                        if (arg < 0) {
                            return -28;
                        }
                        while (FS.streams[arg]) {
                            arg++;
                        }
                        var newStream;
                        newStream = FS.dupStream(stream, arg);
                        return newStream.fd;
                    }
                    case 1:
                    case 2:
                        return 0;
                    case 3:
                        return stream.flags;
                    case 4: {
                        var arg = syscallGetVarargI();
                        stream.flags |= arg;
                        return 0;
                    }
                    case 12: {
                        var arg = syscallGetVarargP();
                        var offset = 0;
                        HEAP16[((arg + offset) >>> 1) >>> 0] = 2;
                        return 0;
                    }
                    case 13:
                    case 14:
                        return 0;
                }
                return -28;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_fstat64(fd, buf) {
            buf >>>= 0;
            try {
                return SYSCALLS.writeStat(buf, FS.fstat(fd));
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_ioctl(fd, op, varargs) {
            varargs >>>= 0;
            SYSCALLS.varargs = varargs;
            try {
                var stream = SYSCALLS.getStreamFromFD(fd);
                switch (op) {
                    case 21509: {
                        if (!stream.tty) return -59;
                        return 0;
                    }
                    case 21505: {
                        if (!stream.tty) return -59;
                        if (stream.tty.ops.ioctl_tcgets) {
                            var termios = stream.tty.ops.ioctl_tcgets(stream);
                            var argp = syscallGetVarargP();
                            HEAP32[(argp >>> 2) >>> 0] = termios.c_iflag || 0;
                            HEAP32[((argp + 4) >>> 2) >>> 0] = termios.c_oflag || 0;
                            HEAP32[((argp + 8) >>> 2) >>> 0] = termios.c_cflag || 0;
                            HEAP32[((argp + 12) >>> 2) >>> 0] = termios.c_lflag || 0;
                            for (var i = 0; i < 32; i++) {
                                HEAP8[(argp + i + 17) >>> 0] = termios.c_cc[i] || 0;
                            }
                            return 0;
                        }
                        return 0;
                    }
                    case 21510:
                    case 21511:
                    case 21512: {
                        if (!stream.tty) return -59;
                        return 0;
                    }
                    case 21506:
                    case 21507:
                    case 21508: {
                        if (!stream.tty) return -59;
                        if (stream.tty.ops.ioctl_tcsets) {
                            var argp = syscallGetVarargP();
                            var c_iflag = HEAP32[(argp >>> 2) >>> 0];
                            var c_oflag = HEAP32[((argp + 4) >>> 2) >>> 0];
                            var c_cflag = HEAP32[((argp + 8) >>> 2) >>> 0];
                            var c_lflag = HEAP32[((argp + 12) >>> 2) >>> 0];
                            var c_cc = [];
                            for (var i = 0; i < 32; i++) {
                                c_cc.push(HEAP8[(argp + i + 17) >>> 0]);
                            }
                            return stream.tty.ops.ioctl_tcsets(stream.tty, op, {
                                c_iflag,
                                c_oflag,
                                c_cflag,
                                c_lflag,
                                c_cc,
                            });
                        }
                        return 0;
                    }
                    case 21519: {
                        if (!stream.tty) return -59;
                        var argp = syscallGetVarargP();
                        HEAP32[(argp >>> 2) >>> 0] = 0;
                        return 0;
                    }
                    case 21520: {
                        if (!stream.tty) return -59;
                        return -28;
                    }
                    case 21531: {
                        var argp = syscallGetVarargP();
                        return FS.ioctl(stream, op, argp);
                    }
                    case 21523: {
                        if (!stream.tty) return -59;
                        if (stream.tty.ops.ioctl_tiocgwinsz) {
                            var winsize = stream.tty.ops.ioctl_tiocgwinsz(stream.tty);
                            var argp = syscallGetVarargP();
                            HEAP16[(argp >>> 1) >>> 0] = winsize[0];
                            HEAP16[((argp + 2) >>> 1) >>> 0] = winsize[1];
                        }
                        return 0;
                    }
                    case 21524: {
                        if (!stream.tty) return -59;
                        return 0;
                    }
                    case 21515: {
                        if (!stream.tty) return -59;
                        return 0;
                    }
                    default:
                        return -28;
                }
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_lstat64(path, buf) {
            path >>>= 0;
            buf >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                return SYSCALLS.writeStat(buf, FS.lstat(path));
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_newfstatat(dirfd, path, buf, flags) {
            path >>>= 0;
            buf >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                var nofollow = flags & 256;
                var allowEmpty = flags & 4096;
                flags = flags & ~6400;
                path = SYSCALLS.calculateAt(dirfd, path, allowEmpty);
                return SYSCALLS.writeStat(buf, nofollow ? FS.lstat(path) : FS.stat(path));
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_openat(dirfd, path, flags, varargs) {
            path >>>= 0;
            varargs >>>= 0;
            SYSCALLS.varargs = varargs;
            try {
                path = SYSCALLS.getStr(path);
                path = SYSCALLS.calculateAt(dirfd, path);
                var mode = varargs ? syscallGetVarargI() : 0;
                return FS.open(path, flags, mode).fd;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_rmdir(path) {
            path >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                FS.rmdir(path);
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_stat64(path, buf) {
            path >>>= 0;
            buf >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                return SYSCALLS.writeStat(buf, FS.stat(path));
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        function ___syscall_unlinkat(dirfd, path, flags) {
            path >>>= 0;
            try {
                path = SYSCALLS.getStr(path);
                path = SYSCALLS.calculateAt(dirfd, path);
                if (flags === 0) {
                    FS.unlink(path);
                } else if (flags === 512) {
                    FS.rmdir(path);
                } else {
                    abort("Invalid flags passed to unlinkat");
                }
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return -e.errno;
            }
        }
        var __abort_js = () => abort("");
        var structRegistrations = {};
        var runDestructors = (destructors) => {
            while (destructors.length) {
                var ptr = destructors.pop();
                var del = destructors.pop();
                del(ptr);
            }
        };
        function readPointer(pointer) {
            return this["fromWireType"](HEAPU32[(pointer >>> 2) >>> 0]);
        }
        var awaitingDependencies = {};
        var registeredTypes = {};
        var typeDependencies = {};
        var InternalError = (Module["InternalError"] = class InternalError extends Error {
            constructor(message) {
                super(message);
                this.name = "InternalError";
            }
        });
        var throwInternalError = (message) => {
            throw new InternalError(message);
        };
        var whenDependentTypesAreResolved = (myTypes, dependentTypes, getTypeConverters) => {
            myTypes.forEach((type) => (typeDependencies[type] = dependentTypes));
            function onComplete(typeConverters) {
                var myTypeConverters = getTypeConverters(typeConverters);
                if (myTypeConverters.length !== myTypes.length) {
                    throwInternalError("Mismatched type converter count");
                }
                for (var i = 0; i < myTypes.length; ++i) {
                    registerType(myTypes[i], myTypeConverters[i]);
                }
            }
            var typeConverters = new Array(dependentTypes.length);
            var unregisteredTypes = [];
            var registered = 0;
            dependentTypes.forEach((dt, i) => {
                if (registeredTypes.hasOwnProperty(dt)) {
                    typeConverters[i] = registeredTypes[dt];
                } else {
                    unregisteredTypes.push(dt);
                    if (!awaitingDependencies.hasOwnProperty(dt)) {
                        awaitingDependencies[dt] = [];
                    }
                    awaitingDependencies[dt].push(() => {
                        typeConverters[i] = registeredTypes[dt];
                        ++registered;
                        if (registered === unregisteredTypes.length) {
                            onComplete(typeConverters);
                        }
                    });
                }
            });
            if (0 === unregisteredTypes.length) {
                onComplete(typeConverters);
            }
        };
        var __embind_finalize_value_object = function (structType) {
            structType >>>= 0;
            var reg = structRegistrations[structType];
            delete structRegistrations[structType];
            var rawConstructor = reg.rawConstructor;
            var rawDestructor = reg.rawDestructor;
            var fieldRecords = reg.fields;
            var fieldTypes = fieldRecords
                .map((field) => field.getterReturnType)
                .concat(fieldRecords.map((field) => field.setterArgumentType));
            whenDependentTypesAreResolved([structType], fieldTypes, (fieldTypes) => {
                var fields = {};
                fieldRecords.forEach((field, i) => {
                    var fieldName = field.fieldName;
                    var getterReturnType = fieldTypes[i];
                    var optional = fieldTypes[i].optional;
                    var getter = field.getter;
                    var getterContext = field.getterContext;
                    var setterArgumentType = fieldTypes[i + fieldRecords.length];
                    var setter = field.setter;
                    var setterContext = field.setterContext;
                    fields[fieldName] = {
                        read: (ptr) => getterReturnType["fromWireType"](getter(getterContext, ptr)),
                        write: (ptr, o) => {
                            var destructors = [];
                            setter(setterContext, ptr, setterArgumentType["toWireType"](destructors, o));
                            runDestructors(destructors);
                        },
                        optional,
                    };
                });
                return [
                    {
                        name: reg.name,
                        fromWireType: (ptr) => {
                            var rv = {};
                            for (var i in fields) {
                                rv[i] = fields[i].read(ptr);
                            }
                            rawDestructor(ptr);
                            return rv;
                        },
                        toWireType: (destructors, o) => {
                            for (var fieldName in fields) {
                                if (!(fieldName in o) && !fields[fieldName].optional) {
                                    throw new TypeError(`Missing field: "${fieldName}"`);
                                }
                            }
                            var ptr = rawConstructor();
                            for (fieldName in fields) {
                                fields[fieldName].write(ptr, o[fieldName]);
                            }
                            if (destructors !== null) {
                                destructors.push(rawDestructor, ptr);
                            }
                            return ptr;
                        },
                        argPackAdvance: GenericWireTypeSize,
                        readValueFromPointer: readPointer,
                        destructorFunction: rawDestructor,
                    },
                ];
            });
        };
        var embindRepr = (v) => {
            if (v === null) {
                return "null";
            }
            var t = typeof v;
            if (t === "object" || t === "array" || t === "function") {
                return v.toString();
            } else {
                return "" + v;
            }
        };
        var embind_init_charCodes = () => {
            var codes = new Array(256);
            for (var i = 0; i < 256; ++i) {
                codes[i] = String.fromCharCode(i);
            }
            embind_charCodes = codes;
        };
        var embind_charCodes;
        var readLatin1String = (ptr) => {
            var ret = "";
            var c = ptr;
            while (HEAPU8[c >>> 0]) {
                ret += embind_charCodes[HEAPU8[c++ >>> 0]];
            }
            return ret;
        };
        var BindingError = (Module["BindingError"] = class BindingError extends Error {
            constructor(message) {
                super(message);
                this.name = "BindingError";
            }
        });
        var throwBindingError = (message) => {
            throw new BindingError(message);
        };
        function sharedRegisterType(rawType, registeredInstance, options = {}) {
            var name = registeredInstance.name;
            if (!rawType) {
                throwBindingError(`type "${name}" must have a positive integer typeid pointer`);
            }
            if (registeredTypes.hasOwnProperty(rawType)) {
                if (options.ignoreDuplicateRegistrations) {
                    return;
                } else {
                    throwBindingError(`Cannot register type '${name}' twice`);
                }
            }
            registeredTypes[rawType] = registeredInstance;
            delete typeDependencies[rawType];
            if (awaitingDependencies.hasOwnProperty(rawType)) {
                var callbacks = awaitingDependencies[rawType];
                delete awaitingDependencies[rawType];
                callbacks.forEach((cb) => cb());
            }
        }
        function registerType(rawType, registeredInstance, options = {}) {
            return sharedRegisterType(rawType, registeredInstance, options);
        }
        var integerReadValueFromPointer = (name, width, signed) => {
            switch (width) {
                case 1:
                    return signed ? (pointer) => HEAP8[pointer >>> 0] : (pointer) => HEAPU8[pointer >>> 0];
                case 2:
                    return signed
                        ? (pointer) => HEAP16[(pointer >>> 1) >>> 0]
                        : (pointer) => HEAPU16[(pointer >>> 1) >>> 0];
                case 4:
                    return signed
                        ? (pointer) => HEAP32[(pointer >>> 2) >>> 0]
                        : (pointer) => HEAPU32[(pointer >>> 2) >>> 0];
                case 8:
                    return signed ? (pointer) => HEAP64[pointer >>> 3] : (pointer) => HEAPU64[pointer >>> 3];
                default:
                    throw new TypeError(`invalid integer width (${width}): ${name}`);
            }
        };
        function __embind_register_bigint(primitiveType, name, size, minRange, maxRange) {
            primitiveType >>>= 0;
            name >>>= 0;
            size >>>= 0;
            name = readLatin1String(name);
            var isUnsignedType = name.indexOf("u") != -1;
            if (isUnsignedType) {
                maxRange = (1n << 64n) - 1n;
            }
            registerType(primitiveType, {
                name,
                fromWireType: (value) => value,
                toWireType: function (destructors, value) {
                    if (typeof value != "bigint" && typeof value != "number") {
                        throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${this.name}`);
                    }
                    if (typeof value == "number") {
                        value = BigInt(value);
                    }
                    return value;
                },
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: integerReadValueFromPointer(name, size, !isUnsignedType),
                destructorFunction: null,
            });
        }
        var GenericWireTypeSize = 8;
        function __embind_register_bool(rawType, name, trueValue, falseValue) {
            rawType >>>= 0;
            name >>>= 0;
            name = readLatin1String(name);
            registerType(rawType, {
                name,
                fromWireType: function (wt) {
                    return !!wt;
                },
                toWireType: function (destructors, o) {
                    return o ? trueValue : falseValue;
                },
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: function (pointer) {
                    return this["fromWireType"](HEAPU8[pointer >>> 0]);
                },
                destructorFunction: null,
            });
        }
        var shallowCopyInternalPointer = (o) => ({
            count: o.count,
            deleteScheduled: o.deleteScheduled,
            preservePointerOnDelete: o.preservePointerOnDelete,
            ptr: o.ptr,
            ptrType: o.ptrType,
            smartPtr: o.smartPtr,
            smartPtrType: o.smartPtrType,
        });
        var throwInstanceAlreadyDeleted = (obj) => {
            function getInstanceTypeName(handle) {
                return handle.$$.ptrType.registeredClass.name;
            }
            throwBindingError(getInstanceTypeName(obj) + " instance already deleted");
        };
        var finalizationRegistry = false;
        var detachFinalizer = (handle) => {};
        var runDestructor = ($$) => {
            if ($$.smartPtr) {
                $$.smartPtrType.rawDestructor($$.smartPtr);
            } else {
                $$.ptrType.registeredClass.rawDestructor($$.ptr);
            }
        };
        var releaseClassHandle = ($$) => {
            $$.count.value -= 1;
            var toDelete = 0 === $$.count.value;
            if (toDelete) {
                runDestructor($$);
            }
        };
        var attachFinalizer = (handle) => {
            if ("undefined" === typeof FinalizationRegistry) {
                attachFinalizer = (handle) => handle;
                return handle;
            }
            finalizationRegistry = new FinalizationRegistry((info) => {
                releaseClassHandle(info.$$);
            });
            attachFinalizer = (handle) => {
                var $$ = handle.$$;
                var hasSmartPtr = !!$$.smartPtr;
                if (hasSmartPtr) {
                    var info = { $$ };
                    finalizationRegistry.register(handle, info, handle);
                }
                return handle;
            };
            detachFinalizer = (handle) => finalizationRegistry.unregister(handle);
            return attachFinalizer(handle);
        };
        var deletionQueue = [];
        var flushPendingDeletes = () => {
            while (deletionQueue.length) {
                var obj = deletionQueue.pop();
                obj.$$.deleteScheduled = false;
                obj["delete"]();
            }
        };
        var delayFunction;
        var init_ClassHandle = () => {
            let proto = ClassHandle.prototype;
            Object.assign(proto, {
                isAliasOf(other) {
                    if (!(this instanceof ClassHandle)) {
                        return false;
                    }
                    if (!(other instanceof ClassHandle)) {
                        return false;
                    }
                    var leftClass = this.$$.ptrType.registeredClass;
                    var left = this.$$.ptr;
                    other.$$ = other.$$;
                    var rightClass = other.$$.ptrType.registeredClass;
                    var right = other.$$.ptr;
                    while (leftClass.baseClass) {
                        left = leftClass.upcast(left);
                        leftClass = leftClass.baseClass;
                    }
                    while (rightClass.baseClass) {
                        right = rightClass.upcast(right);
                        rightClass = rightClass.baseClass;
                    }
                    return leftClass === rightClass && left === right;
                },
                clone() {
                    if (!this.$$.ptr) {
                        throwInstanceAlreadyDeleted(this);
                    }
                    if (this.$$.preservePointerOnDelete) {
                        this.$$.count.value += 1;
                        return this;
                    } else {
                        var clone = attachFinalizer(
                            Object.create(Object.getPrototypeOf(this), {
                                $$: { value: shallowCopyInternalPointer(this.$$) },
                            }),
                        );
                        clone.$$.count.value += 1;
                        clone.$$.deleteScheduled = false;
                        return clone;
                    }
                },
                delete() {
                    if (!this.$$.ptr) {
                        throwInstanceAlreadyDeleted(this);
                    }
                    if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
                        throwBindingError("Object already scheduled for deletion");
                    }
                    detachFinalizer(this);
                    releaseClassHandle(this.$$);
                    if (!this.$$.preservePointerOnDelete) {
                        this.$$.smartPtr = undefined;
                        this.$$.ptr = undefined;
                    }
                },
                isDeleted() {
                    return !this.$$.ptr;
                },
                deleteLater() {
                    if (!this.$$.ptr) {
                        throwInstanceAlreadyDeleted(this);
                    }
                    if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
                        throwBindingError("Object already scheduled for deletion");
                    }
                    deletionQueue.push(this);
                    if (deletionQueue.length === 1 && delayFunction) {
                        delayFunction(flushPendingDeletes);
                    }
                    this.$$.deleteScheduled = true;
                    return this;
                },
            });
            const symbolDispose = Symbol.dispose;
            if (symbolDispose) {
                proto[symbolDispose] = proto["delete"];
            }
        };
        function ClassHandle() {}
        var createNamedFunction = (name, func) => Object.defineProperty(func, "name", { value: name });
        var registeredPointers = {};
        var ensureOverloadTable = (proto, methodName, humanName) => {
            if (undefined === proto[methodName].overloadTable) {
                var prevFunc = proto[methodName];
                proto[methodName] = function (...args) {
                    if (!proto[methodName].overloadTable.hasOwnProperty(args.length)) {
                        throwBindingError(
                            `Function '${humanName}' called with an invalid number of arguments (${args.length}) - expects one of (${proto[methodName].overloadTable})!`,
                        );
                    }
                    return proto[methodName].overloadTable[args.length].apply(this, args);
                };
                proto[methodName].overloadTable = [];
                proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
            }
        };
        var exposePublicSymbol = (name, value, numArguments) => {
            if (Module.hasOwnProperty(name)) {
                if (
                    undefined === numArguments ||
                    (undefined !== Module[name].overloadTable &&
                        undefined !== Module[name].overloadTable[numArguments])
                ) {
                    throwBindingError(`Cannot register public name '${name}' twice`);
                }
                ensureOverloadTable(Module, name, name);
                if (Module[name].overloadTable.hasOwnProperty(numArguments)) {
                    throwBindingError(
                        `Cannot register multiple overloads of a function with the same number of arguments (${numArguments})!`,
                    );
                }
                Module[name].overloadTable[numArguments] = value;
            } else {
                Module[name] = value;
                Module[name].argCount = numArguments;
            }
        };
        var char_0 = 48;
        var char_9 = 57;
        var makeLegalFunctionName = (name) => {
            name = name.replace(/[^a-zA-Z0-9_]/g, "$");
            var f = name.charCodeAt(0);
            if (f >= char_0 && f <= char_9) {
                return `_${name}`;
            }
            return name;
        };
        function RegisteredClass(
            name,
            constructor,
            instancePrototype,
            rawDestructor,
            baseClass,
            getActualType,
            upcast,
            downcast,
        ) {
            this.name = name;
            this.constructor = constructor;
            this.instancePrototype = instancePrototype;
            this.rawDestructor = rawDestructor;
            this.baseClass = baseClass;
            this.getActualType = getActualType;
            this.upcast = upcast;
            this.downcast = downcast;
            this.pureVirtualFunctions = [];
        }
        var upcastPointer = (ptr, ptrClass, desiredClass) => {
            while (ptrClass !== desiredClass) {
                if (!ptrClass.upcast) {
                    throwBindingError(
                        `Expected null or instance of ${desiredClass.name}, got an instance of ${ptrClass.name}`,
                    );
                }
                ptr = ptrClass.upcast(ptr);
                ptrClass = ptrClass.baseClass;
            }
            return ptr;
        };
        function constNoSmartPtrRawPointerToWireType(destructors, handle) {
            if (handle === null) {
                if (this.isReference) {
                    throwBindingError(`null is not a valid ${this.name}`);
                }
                return 0;
            }
            if (!handle.$$) {
                throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
            }
            if (!handle.$$.ptr) {
                throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
            }
            var handleClass = handle.$$.ptrType.registeredClass;
            var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
            return ptr;
        }
        function genericPointerToWireType(destructors, handle) {
            var ptr;
            if (handle === null) {
                if (this.isReference) {
                    throwBindingError(`null is not a valid ${this.name}`);
                }
                if (this.isSmartPointer) {
                    ptr = this.rawConstructor();
                    if (destructors !== null) {
                        destructors.push(this.rawDestructor, ptr);
                    }
                    return ptr;
                } else {
                    return 0;
                }
            }
            if (!handle || !handle.$$) {
                throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
            }
            if (!handle.$$.ptr) {
                throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
            }
            if (!this.isConst && handle.$$.ptrType.isConst) {
                throwBindingError(
                    `Cannot convert argument of type ${handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name} to parameter type ${this.name}`,
                );
            }
            var handleClass = handle.$$.ptrType.registeredClass;
            ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
            if (this.isSmartPointer) {
                if (undefined === handle.$$.smartPtr) {
                    throwBindingError("Passing raw pointer to smart pointer is illegal");
                }
                switch (this.sharingPolicy) {
                    case 0:
                        if (handle.$$.smartPtrType === this) {
                            ptr = handle.$$.smartPtr;
                        } else {
                            throwBindingError(
                                `Cannot convert argument of type ${handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name} to parameter type ${this.name}`,
                            );
                        }
                        break;
                    case 1:
                        ptr = handle.$$.smartPtr;
                        break;
                    case 2:
                        if (handle.$$.smartPtrType === this) {
                            ptr = handle.$$.smartPtr;
                        } else {
                            var clonedHandle = handle["clone"]();
                            ptr = this.rawShare(
                                ptr,
                                Emval.toHandle(() => clonedHandle["delete"]()),
                            );
                            if (destructors !== null) {
                                destructors.push(this.rawDestructor, ptr);
                            }
                        }
                        break;
                    default:
                        throwBindingError("Unsupporting sharing policy");
                }
            }
            return ptr;
        }
        function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
            if (handle === null) {
                if (this.isReference) {
                    throwBindingError(`null is not a valid ${this.name}`);
                }
                return 0;
            }
            if (!handle.$$) {
                throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
            }
            if (!handle.$$.ptr) {
                throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
            }
            if (handle.$$.ptrType.isConst) {
                throwBindingError(
                    `Cannot convert argument of type ${handle.$$.ptrType.name} to parameter type ${this.name}`,
                );
            }
            var handleClass = handle.$$.ptrType.registeredClass;
            var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
            return ptr;
        }
        var downcastPointer = (ptr, ptrClass, desiredClass) => {
            if (ptrClass === desiredClass) {
                return ptr;
            }
            if (undefined === desiredClass.baseClass) {
                return null;
            }
            var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
            if (rv === null) {
                return null;
            }
            return desiredClass.downcast(rv);
        };
        var registeredInstances = {};
        var getBasestPointer = (class_, ptr) => {
            if (ptr === undefined) {
                throwBindingError("ptr should not be undefined");
            }
            while (class_.baseClass) {
                ptr = class_.upcast(ptr);
                class_ = class_.baseClass;
            }
            return ptr;
        };
        var getInheritedInstance = (class_, ptr) => {
            ptr = getBasestPointer(class_, ptr);
            return registeredInstances[ptr];
        };
        var makeClassHandle = (prototype, record) => {
            if (!record.ptrType || !record.ptr) {
                throwInternalError("makeClassHandle requires ptr and ptrType");
            }
            var hasSmartPtrType = !!record.smartPtrType;
            var hasSmartPtr = !!record.smartPtr;
            if (hasSmartPtrType !== hasSmartPtr) {
                throwInternalError("Both smartPtrType and smartPtr must be specified");
            }
            record.count = { value: 1 };
            return attachFinalizer(Object.create(prototype, { $$: { value: record, writable: true } }));
        };
        function RegisteredPointer_fromWireType(ptr) {
            var rawPointer = this.getPointee(ptr);
            if (!rawPointer) {
                this.destructor(ptr);
                return null;
            }
            var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
            if (undefined !== registeredInstance) {
                if (0 === registeredInstance.$$.count.value) {
                    registeredInstance.$$.ptr = rawPointer;
                    registeredInstance.$$.smartPtr = ptr;
                    return registeredInstance["clone"]();
                } else {
                    var rv = registeredInstance["clone"]();
                    this.destructor(ptr);
                    return rv;
                }
            }
            function makeDefaultHandle() {
                if (this.isSmartPointer) {
                    return makeClassHandle(this.registeredClass.instancePrototype, {
                        ptrType: this.pointeeType,
                        ptr: rawPointer,
                        smartPtrType: this,
                        smartPtr: ptr,
                    });
                } else {
                    return makeClassHandle(this.registeredClass.instancePrototype, { ptrType: this, ptr });
                }
            }
            var actualType = this.registeredClass.getActualType(rawPointer);
            var registeredPointerRecord = registeredPointers[actualType];
            if (!registeredPointerRecord) {
                return makeDefaultHandle.call(this);
            }
            var toType;
            if (this.isConst) {
                toType = registeredPointerRecord.constPointerType;
            } else {
                toType = registeredPointerRecord.pointerType;
            }
            var dp = downcastPointer(rawPointer, this.registeredClass, toType.registeredClass);
            if (dp === null) {
                return makeDefaultHandle.call(this);
            }
            if (this.isSmartPointer) {
                return makeClassHandle(toType.registeredClass.instancePrototype, {
                    ptrType: toType,
                    ptr: dp,
                    smartPtrType: this,
                    smartPtr: ptr,
                });
            } else {
                return makeClassHandle(toType.registeredClass.instancePrototype, {
                    ptrType: toType,
                    ptr: dp,
                });
            }
        }
        var init_RegisteredPointer = () => {
            Object.assign(RegisteredPointer.prototype, {
                getPointee(ptr) {
                    if (this.rawGetPointee) {
                        ptr = this.rawGetPointee(ptr);
                    }
                    return ptr;
                },
                destructor(ptr) {
                    this.rawDestructor?.(ptr);
                },
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: readPointer,
                fromWireType: RegisteredPointer_fromWireType,
            });
        };
        function RegisteredPointer(
            name,
            registeredClass,
            isReference,
            isConst,
            isSmartPointer,
            pointeeType,
            sharingPolicy,
            rawGetPointee,
            rawConstructor,
            rawShare,
            rawDestructor,
        ) {
            this.name = name;
            this.registeredClass = registeredClass;
            this.isReference = isReference;
            this.isConst = isConst;
            this.isSmartPointer = isSmartPointer;
            this.pointeeType = pointeeType;
            this.sharingPolicy = sharingPolicy;
            this.rawGetPointee = rawGetPointee;
            this.rawConstructor = rawConstructor;
            this.rawShare = rawShare;
            this.rawDestructor = rawDestructor;
            if (!isSmartPointer && registeredClass.baseClass === undefined) {
                if (isConst) {
                    this["toWireType"] = constNoSmartPtrRawPointerToWireType;
                    this.destructorFunction = null;
                } else {
                    this["toWireType"] = nonConstNoSmartPtrRawPointerToWireType;
                    this.destructorFunction = null;
                }
            } else {
                this["toWireType"] = genericPointerToWireType;
            }
        }
        var replacePublicSymbol = (name, value, numArguments) => {
            if (!Module.hasOwnProperty(name)) {
                throwInternalError("Replacing nonexistent public symbol");
            }
            if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
                Module[name].overloadTable[numArguments] = value;
            } else {
                Module[name] = value;
                Module[name].argCount = numArguments;
            }
        };
        var wasmTable;
        var getWasmTableEntry = (funcPtr) => wasmTable.get(funcPtr);
        var dynCall = (sig, ptr, args = [], promising = false) => {
            var func = getWasmTableEntry(ptr);
            var rtn = func(...args);
            return sig[0] == "p" ? rtn >>> 0 : rtn;
        };
        var getDynCaller =
            (sig, ptr, promising = false) =>
            (...args) =>
                dynCall(sig, ptr, args, promising);
        var embind__requireFunction = (signature, rawFunction, isAsync = false) => {
            signature = readLatin1String(signature);
            function makeDynCaller() {
                if (signature.includes("p")) {
                    return getDynCaller(signature, rawFunction, isAsync);
                }
                var rtn = getWasmTableEntry(rawFunction);
                return rtn;
            }
            var fp = makeDynCaller();
            if (typeof fp != "function") {
                throwBindingError(`unknown function pointer with signature ${signature}: ${rawFunction}`);
            }
            return fp;
        };
        class UnboundTypeError extends Error {}
        var getTypeName = (type) => {
            var ptr = ___getTypeName(type);
            var rv = readLatin1String(ptr);
            _free(ptr);
            return rv;
        };
        var throwUnboundTypeError = (message, types) => {
            var unboundTypes = [];
            var seen = {};
            function visit(type) {
                if (seen[type]) {
                    return;
                }
                if (registeredTypes[type]) {
                    return;
                }
                if (typeDependencies[type]) {
                    typeDependencies[type].forEach(visit);
                    return;
                }
                unboundTypes.push(type);
                seen[type] = true;
            }
            types.forEach(visit);
            throw new UnboundTypeError(`${message}: ` + unboundTypes.map(getTypeName).join([", "]));
        };
        function __embind_register_class(
            rawType,
            rawPointerType,
            rawConstPointerType,
            baseClassRawType,
            getActualTypeSignature,
            getActualType,
            upcastSignature,
            upcast,
            downcastSignature,
            downcast,
            name,
            destructorSignature,
            rawDestructor,
        ) {
            rawType >>>= 0;
            rawPointerType >>>= 0;
            rawConstPointerType >>>= 0;
            baseClassRawType >>>= 0;
            getActualTypeSignature >>>= 0;
            getActualType >>>= 0;
            upcastSignature >>>= 0;
            upcast >>>= 0;
            downcastSignature >>>= 0;
            downcast >>>= 0;
            name >>>= 0;
            destructorSignature >>>= 0;
            rawDestructor >>>= 0;
            name = readLatin1String(name);
            getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
            upcast &&= embind__requireFunction(upcastSignature, upcast);
            downcast &&= embind__requireFunction(downcastSignature, downcast);
            rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
            var legalFunctionName = makeLegalFunctionName(name);
            exposePublicSymbol(legalFunctionName, function () {
                throwUnboundTypeError(`Cannot construct ${name} due to unbound types`, [baseClassRawType]);
            });
            whenDependentTypesAreResolved(
                [rawType, rawPointerType, rawConstPointerType],
                baseClassRawType ? [baseClassRawType] : [],
                (base) => {
                    base = base[0];
                    var baseClass;
                    var basePrototype;
                    if (baseClassRawType) {
                        baseClass = base.registeredClass;
                        basePrototype = baseClass.instancePrototype;
                    } else {
                        basePrototype = ClassHandle.prototype;
                    }
                    var constructor = createNamedFunction(name, function (...args) {
                        if (Object.getPrototypeOf(this) !== instancePrototype) {
                            throw new BindingError(`Use 'new' to construct ${name}`);
                        }
                        if (undefined === registeredClass.constructor_body) {
                            throw new BindingError(`${name} has no accessible constructor`);
                        }
                        var body = registeredClass.constructor_body[args.length];
                        if (undefined === body) {
                            throw new BindingError(
                                `Tried to invoke ctor of ${name} with invalid number of parameters (${args.length}) - expected (${Object.keys(registeredClass.constructor_body).toString()}) parameters instead!`,
                            );
                        }
                        return body.apply(this, args);
                    });
                    var instancePrototype = Object.create(basePrototype, {
                        constructor: { value: constructor },
                    });
                    constructor.prototype = instancePrototype;
                    var registeredClass = new RegisteredClass(
                        name,
                        constructor,
                        instancePrototype,
                        rawDestructor,
                        baseClass,
                        getActualType,
                        upcast,
                        downcast,
                    );
                    if (registeredClass.baseClass) {
                        registeredClass.baseClass.__derivedClasses ??= [];
                        registeredClass.baseClass.__derivedClasses.push(registeredClass);
                    }
                    var referenceConverter = new RegisteredPointer(
                        name,
                        registeredClass,
                        true,
                        false,
                        false,
                    );
                    var pointerConverter = new RegisteredPointer(
                        name + "*",
                        registeredClass,
                        false,
                        false,
                        false,
                    );
                    var constPointerConverter = new RegisteredPointer(
                        name + " const*",
                        registeredClass,
                        false,
                        true,
                        false,
                    );
                    registeredPointers[rawType] = {
                        pointerType: pointerConverter,
                        constPointerType: constPointerConverter,
                    };
                    replacePublicSymbol(legalFunctionName, constructor);
                    return [referenceConverter, pointerConverter, constPointerConverter];
                },
            );
        }
        function usesDestructorStack(argTypes) {
            for (var i = 1; i < argTypes.length; ++i) {
                if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) {
                    return true;
                }
            }
            return false;
        }
        function createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync) {
            var needsDestructorStack = usesDestructorStack(argTypes);
            var argCount = argTypes.length - 2;
            var argsList = [];
            var argsListWired = ["fn"];
            if (isClassMethodFunc) {
                argsListWired.push("thisWired");
            }
            for (var i = 0; i < argCount; ++i) {
                argsList.push(`arg${i}`);
                argsListWired.push(`arg${i}Wired`);
            }
            argsList = argsList.join(",");
            argsListWired = argsListWired.join(",");
            var invokerFnBody = `return function (${argsList}) {\n`;
            if (needsDestructorStack) {
                invokerFnBody += "var destructors = [];\n";
            }
            var dtorStack = needsDestructorStack ? "destructors" : "null";
            var args1 = [
                "humanName",
                "throwBindingError",
                "invoker",
                "fn",
                "runDestructors",
                "retType",
                "classParam",
            ];
            if (isClassMethodFunc) {
                invokerFnBody += `var thisWired = classParam['toWireType'](${dtorStack}, this);\n`;
            }
            for (var i = 0; i < argCount; ++i) {
                invokerFnBody += `var arg${i}Wired = argType${i}['toWireType'](${dtorStack}, arg${i});\n`;
                args1.push(`argType${i}`);
            }
            invokerFnBody += (returns || isAsync ? "var rv = " : "") + `invoker(${argsListWired});\n`;
            if (needsDestructorStack) {
                invokerFnBody += "runDestructors(destructors);\n";
            } else {
                for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
                    var paramName = i === 1 ? "thisWired" : "arg" + (i - 2) + "Wired";
                    if (argTypes[i].destructorFunction !== null) {
                        invokerFnBody += `${paramName}_dtor(${paramName});\n`;
                        args1.push(`${paramName}_dtor`);
                    }
                }
            }
            if (returns) {
                invokerFnBody += "var ret = retType['fromWireType'](rv);\n" + "return ret;\n";
            } else {
            }
            invokerFnBody += "}\n";
            return [args1, invokerFnBody];
        }
        function craftInvokerFunction(
            humanName,
            argTypes,
            classType,
            cppInvokerFunc,
            cppTargetFunc,
            isAsync,
        ) {
            var argCount = argTypes.length;
            if (argCount < 2) {
                throwBindingError(
                    "argTypes array size mismatch! Must at least get return value and 'this' types!",
                );
            }
            var isClassMethodFunc = argTypes[1] !== null && classType !== null;
            var needsDestructorStack = usesDestructorStack(argTypes);
            var returns = argTypes[0].name !== "void";
            var closureArgs = [
                humanName,
                throwBindingError,
                cppInvokerFunc,
                cppTargetFunc,
                runDestructors,
                argTypes[0],
                argTypes[1],
            ];
            for (var i = 0; i < argCount - 2; ++i) {
                closureArgs.push(argTypes[i + 2]);
            }
            if (!needsDestructorStack) {
                for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
                    if (argTypes[i].destructorFunction !== null) {
                        closureArgs.push(argTypes[i].destructorFunction);
                    }
                }
            }
            let [args, invokerFnBody] = createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync);
            var invokerFn = new Function(...args, invokerFnBody)(...closureArgs);
            return createNamedFunction(humanName, invokerFn);
        }
        var heap32VectorToArray = (count, firstElement) => {
            var array = [];
            for (var i = 0; i < count; i++) {
                array.push(HEAPU32[((firstElement + i * 4) >>> 2) >>> 0]);
            }
            return array;
        };
        var getFunctionName = (signature) => {
            signature = signature.trim();
            const argsIndex = signature.indexOf("(");
            if (argsIndex === -1) return signature;
            return signature.slice(0, argsIndex);
        };
        var __embind_register_class_class_function = function (
            rawClassType,
            methodName,
            argCount,
            rawArgTypesAddr,
            invokerSignature,
            rawInvoker,
            fn,
            isAsync,
            isNonnullReturn,
        ) {
            rawClassType >>>= 0;
            methodName >>>= 0;
            rawArgTypesAddr >>>= 0;
            invokerSignature >>>= 0;
            rawInvoker >>>= 0;
            fn >>>= 0;
            var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
            methodName = readLatin1String(methodName);
            methodName = getFunctionName(methodName);
            rawInvoker = embind__requireFunction(invokerSignature, rawInvoker, isAsync);
            whenDependentTypesAreResolved([], [rawClassType], (classType) => {
                classType = classType[0];
                var humanName = `${classType.name}.${methodName}`;
                function unboundTypesHandler() {
                    throwUnboundTypeError(`Cannot call ${humanName} due to unbound types`, rawArgTypes);
                }
                if (methodName.startsWith("@@")) {
                    methodName = Symbol[methodName.substring(2)];
                }
                var proto = classType.registeredClass.constructor;
                if (undefined === proto[methodName]) {
                    unboundTypesHandler.argCount = argCount - 1;
                    proto[methodName] = unboundTypesHandler;
                } else {
                    ensureOverloadTable(proto, methodName, humanName);
                    proto[methodName].overloadTable[argCount - 1] = unboundTypesHandler;
                }
                whenDependentTypesAreResolved([], rawArgTypes, (argTypes) => {
                    var invokerArgsArray = [argTypes[0], null].concat(argTypes.slice(1));
                    var func = craftInvokerFunction(
                        humanName,
                        invokerArgsArray,
                        null,
                        rawInvoker,
                        fn,
                        isAsync,
                    );
                    if (undefined === proto[methodName].overloadTable) {
                        func.argCount = argCount - 1;
                        proto[methodName] = func;
                    } else {
                        proto[methodName].overloadTable[argCount - 1] = func;
                    }
                    if (classType.registeredClass.__derivedClasses) {
                        for (const derivedClass of classType.registeredClass.__derivedClasses) {
                            if (!derivedClass.constructor.hasOwnProperty(methodName)) {
                                derivedClass.constructor[methodName] = func;
                            }
                        }
                    }
                    return [];
                });
                return [];
            });
        };
        var __embind_register_class_constructor = function (
            rawClassType,
            argCount,
            rawArgTypesAddr,
            invokerSignature,
            invoker,
            rawConstructor,
        ) {
            rawClassType >>>= 0;
            rawArgTypesAddr >>>= 0;
            invokerSignature >>>= 0;
            invoker >>>= 0;
            rawConstructor >>>= 0;
            var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
            invoker = embind__requireFunction(invokerSignature, invoker);
            whenDependentTypesAreResolved([], [rawClassType], (classType) => {
                classType = classType[0];
                var humanName = `constructor ${classType.name}`;
                if (undefined === classType.registeredClass.constructor_body) {
                    classType.registeredClass.constructor_body = [];
                }
                if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
                    throw new BindingError(
                        `Cannot register multiple constructors with identical number of parameters (${argCount - 1}) for class '${classType.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`,
                    );
                }
                classType.registeredClass.constructor_body[argCount - 1] = () => {
                    throwUnboundTypeError(
                        `Cannot construct ${classType.name} due to unbound types`,
                        rawArgTypes,
                    );
                };
                whenDependentTypesAreResolved([], rawArgTypes, (argTypes) => {
                    argTypes.splice(1, 0, null);
                    classType.registeredClass.constructor_body[argCount - 1] = craftInvokerFunction(
                        humanName,
                        argTypes,
                        null,
                        invoker,
                        rawConstructor,
                    );
                    return [];
                });
                return [];
            });
        };
        var __embind_register_class_function = function (
            rawClassType,
            methodName,
            argCount,
            rawArgTypesAddr,
            invokerSignature,
            rawInvoker,
            context,
            isPureVirtual,
            isAsync,
            isNonnullReturn,
        ) {
            rawClassType >>>= 0;
            methodName >>>= 0;
            rawArgTypesAddr >>>= 0;
            invokerSignature >>>= 0;
            rawInvoker >>>= 0;
            context >>>= 0;
            var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
            methodName = readLatin1String(methodName);
            methodName = getFunctionName(methodName);
            rawInvoker = embind__requireFunction(invokerSignature, rawInvoker, isAsync);
            whenDependentTypesAreResolved([], [rawClassType], (classType) => {
                classType = classType[0];
                var humanName = `${classType.name}.${methodName}`;
                if (methodName.startsWith("@@")) {
                    methodName = Symbol[methodName.substring(2)];
                }
                if (isPureVirtual) {
                    classType.registeredClass.pureVirtualFunctions.push(methodName);
                }
                function unboundTypesHandler() {
                    throwUnboundTypeError(`Cannot call ${humanName} due to unbound types`, rawArgTypes);
                }
                var proto = classType.registeredClass.instancePrototype;
                var method = proto[methodName];
                if (
                    undefined === method ||
                    (undefined === method.overloadTable &&
                        method.className !== classType.name &&
                        method.argCount === argCount - 2)
                ) {
                    unboundTypesHandler.argCount = argCount - 2;
                    unboundTypesHandler.className = classType.name;
                    proto[methodName] = unboundTypesHandler;
                } else {
                    ensureOverloadTable(proto, methodName, humanName);
                    proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
                }
                whenDependentTypesAreResolved([], rawArgTypes, (argTypes) => {
                    var memberFunction = craftInvokerFunction(
                        humanName,
                        argTypes,
                        classType,
                        rawInvoker,
                        context,
                        isAsync,
                    );
                    if (undefined === proto[methodName].overloadTable) {
                        memberFunction.argCount = argCount - 2;
                        proto[methodName] = memberFunction;
                    } else {
                        proto[methodName].overloadTable[argCount - 2] = memberFunction;
                    }
                    return [];
                });
                return [];
            });
        };
        var validateThis = (this_, classType, humanName) => {
            if (!(this_ instanceof Object)) {
                throwBindingError(`${humanName} with invalid "this": ${this_}`);
            }
            if (!(this_ instanceof classType.registeredClass.constructor)) {
                throwBindingError(`${humanName} incompatible with "this" of type ${this_.constructor.name}`);
            }
            if (!this_.$$.ptr) {
                throwBindingError(`cannot call emscripten binding method ${humanName} on deleted object`);
            }
            return upcastPointer(this_.$$.ptr, this_.$$.ptrType.registeredClass, classType.registeredClass);
        };
        var __embind_register_class_property = function (
            classType,
            fieldName,
            getterReturnType,
            getterSignature,
            getter,
            getterContext,
            setterArgumentType,
            setterSignature,
            setter,
            setterContext,
        ) {
            classType >>>= 0;
            fieldName >>>= 0;
            getterReturnType >>>= 0;
            getterSignature >>>= 0;
            getter >>>= 0;
            getterContext >>>= 0;
            setterArgumentType >>>= 0;
            setterSignature >>>= 0;
            setter >>>= 0;
            setterContext >>>= 0;
            fieldName = readLatin1String(fieldName);
            getter = embind__requireFunction(getterSignature, getter);
            whenDependentTypesAreResolved([], [classType], (classType) => {
                classType = classType[0];
                var humanName = `${classType.name}.${fieldName}`;
                var desc = {
                    get() {
                        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [
                            getterReturnType,
                            setterArgumentType,
                        ]);
                    },
                    enumerable: true,
                    configurable: true,
                };
                if (setter) {
                    desc.set = () =>
                        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [
                            getterReturnType,
                            setterArgumentType,
                        ]);
                } else {
                    desc.set = (v) => throwBindingError(humanName + " is a read-only property");
                }
                Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
                whenDependentTypesAreResolved(
                    [],
                    setter ? [getterReturnType, setterArgumentType] : [getterReturnType],
                    (types) => {
                        var getterReturnType = types[0];
                        var desc = {
                            get() {
                                var ptr = validateThis(this, classType, humanName + " getter");
                                return getterReturnType["fromWireType"](getter(getterContext, ptr));
                            },
                            enumerable: true,
                        };
                        if (setter) {
                            setter = embind__requireFunction(setterSignature, setter);
                            var setterArgumentType = types[1];
                            desc.set = function (v) {
                                var ptr = validateThis(this, classType, humanName + " setter");
                                var destructors = [];
                                setter(setterContext, ptr, setterArgumentType["toWireType"](destructors, v));
                                runDestructors(destructors);
                            };
                        }
                        Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
                        return [];
                    },
                );
                return [];
            });
        };
        var emval_freelist = [];
        var emval_handles = [];
        function __emval_decref(handle) {
            handle >>>= 0;
            if (handle > 9 && 0 === --emval_handles[handle + 1]) {
                emval_handles[handle] = undefined;
                emval_freelist.push(handle);
            }
        }
        var count_emval_handles = () => emval_handles.length / 2 - 5 - emval_freelist.length;
        var init_emval = () => {
            emval_handles.push(0, 1, undefined, 1, null, 1, true, 1, false, 1);
            Module["count_emval_handles"] = count_emval_handles;
        };
        var Emval = {
            toValue: (handle) => {
                if (!handle) {
                    throwBindingError(`Cannot use deleted val. handle = ${handle}`);
                }
                return emval_handles[handle];
            },
            toHandle: (value) => {
                switch (value) {
                    case undefined:
                        return 2;
                    case null:
                        return 4;
                    case true:
                        return 6;
                    case false:
                        return 8;
                    default: {
                        const handle = emval_freelist.pop() || emval_handles.length;
                        emval_handles[handle] = value;
                        emval_handles[handle + 1] = 1;
                        return handle;
                    }
                }
            },
        };
        var EmValType = {
            name: "emscripten::val",
            fromWireType: (handle) => {
                var rv = Emval.toValue(handle);
                __emval_decref(handle);
                return rv;
            },
            toWireType: (destructors, value) => Emval.toHandle(value),
            argPackAdvance: GenericWireTypeSize,
            readValueFromPointer: readPointer,
            destructorFunction: null,
        };
        function __embind_register_emval(rawType) {
            rawType >>>= 0;
            return registerType(rawType, EmValType);
        }
        var enumReadValueFromPointer = (name, width, signed) => {
            switch (width) {
                case 1:
                    return signed
                        ? function (pointer) {
                              return this["fromWireType"](HEAP8[pointer >>> 0]);
                          }
                        : function (pointer) {
                              return this["fromWireType"](HEAPU8[pointer >>> 0]);
                          };
                case 2:
                    return signed
                        ? function (pointer) {
                              return this["fromWireType"](HEAP16[(pointer >>> 1) >>> 0]);
                          }
                        : function (pointer) {
                              return this["fromWireType"](HEAPU16[(pointer >>> 1) >>> 0]);
                          };
                case 4:
                    return signed
                        ? function (pointer) {
                              return this["fromWireType"](HEAP32[(pointer >>> 2) >>> 0]);
                          }
                        : function (pointer) {
                              return this["fromWireType"](HEAPU32[(pointer >>> 2) >>> 0]);
                          };
                default:
                    throw new TypeError(`invalid integer width (${width}): ${name}`);
            }
        };
        function __embind_register_enum(rawType, name, size, isSigned) {
            rawType >>>= 0;
            name >>>= 0;
            size >>>= 0;
            name = readLatin1String(name);
            function ctor() {}
            ctor.values = {};
            registerType(rawType, {
                name,
                constructor: ctor,
                fromWireType: function (c) {
                    return this.constructor.values[c];
                },
                toWireType: (destructors, c) => c.value,
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: enumReadValueFromPointer(name, size, isSigned),
                destructorFunction: null,
            });
            exposePublicSymbol(name, ctor);
        }
        var requireRegisteredType = (rawType, humanName) => {
            var impl = registeredTypes[rawType];
            if (undefined === impl) {
                throwBindingError(`${humanName} has unknown type ${getTypeName(rawType)}`);
            }
            return impl;
        };
        function __embind_register_enum_value(rawEnumType, name, enumValue) {
            rawEnumType >>>= 0;
            name >>>= 0;
            var enumType = requireRegisteredType(rawEnumType, "enum");
            name = readLatin1String(name);
            var Enum = enumType.constructor;
            var Value = Object.create(enumType.constructor.prototype, {
                value: { value: enumValue },
                constructor: { value: createNamedFunction(`${enumType.name}_${name}`, function () {}) },
            });
            Enum.values[enumValue] = Value;
            Enum[name] = Value;
        }
        var floatReadValueFromPointer = (name, width) => {
            switch (width) {
                case 4:
                    return function (pointer) {
                        return this["fromWireType"](HEAPF32[(pointer >>> 2) >>> 0]);
                    };
                case 8:
                    return function (pointer) {
                        return this["fromWireType"](HEAPF64[(pointer >>> 3) >>> 0]);
                    };
                default:
                    throw new TypeError(`invalid float width (${width}): ${name}`);
            }
        };
        var __embind_register_float = function (rawType, name, size) {
            rawType >>>= 0;
            name >>>= 0;
            size >>>= 0;
            name = readLatin1String(name);
            registerType(rawType, {
                name,
                fromWireType: (value) => value,
                toWireType: (destructors, value) => value,
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: floatReadValueFromPointer(name, size),
                destructorFunction: null,
            });
        };
        function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
            primitiveType >>>= 0;
            name >>>= 0;
            size >>>= 0;
            name = readLatin1String(name);
            if (maxRange === -1) {
                maxRange = 4294967295;
            }
            var fromWireType = (value) => value;
            if (minRange === 0) {
                var bitshift = 32 - 8 * size;
                fromWireType = (value) => (value << bitshift) >>> bitshift;
            }
            var isUnsignedType = name.includes("unsigned");
            var checkAssertions = (value, toTypeName) => {};
            var toWireType;
            if (isUnsignedType) {
                toWireType = function (destructors, value) {
                    checkAssertions(value, this.name);
                    return value >>> 0;
                };
            } else {
                toWireType = function (destructors, value) {
                    checkAssertions(value, this.name);
                    return value;
                };
            }
            registerType(primitiveType, {
                name,
                fromWireType,
                toWireType,
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: integerReadValueFromPointer(name, size, minRange !== 0),
                destructorFunction: null,
            });
        }
        function __embind_register_memory_view(rawType, dataTypeIndex, name) {
            rawType >>>= 0;
            name >>>= 0;
            var typeMapping = [
                Int8Array,
                Uint8Array,
                Int16Array,
                Uint16Array,
                Int32Array,
                Uint32Array,
                Float32Array,
                Float64Array,
                BigInt64Array,
                BigUint64Array,
            ];
            var TA = typeMapping[dataTypeIndex];
            function decodeMemoryView(handle) {
                var size = HEAPU32[(handle >>> 2) >>> 0];
                var data = HEAPU32[((handle + 4) >>> 2) >>> 0];
                return new TA(HEAP8.buffer, data, size);
            }
            name = readLatin1String(name);
            registerType(
                rawType,
                {
                    name,
                    fromWireType: decodeMemoryView,
                    argPackAdvance: GenericWireTypeSize,
                    readValueFromPointer: decodeMemoryView,
                },
                { ignoreDuplicateRegistrations: true },
            );
        }
        var EmValOptionalType = Object.assign({ optional: true }, EmValType);
        function __embind_register_optional(rawOptionalType, rawType) {
            rawOptionalType >>>= 0;
            rawType >>>= 0;
            registerType(rawOptionalType, EmValOptionalType);
        }
        var stringToUTF8 = (str, outPtr, maxBytesToWrite) =>
            stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
        function __embind_register_std_string(rawType, name) {
            rawType >>>= 0;
            name >>>= 0;
            name = readLatin1String(name);
            var stdStringIsUTF8 = true;
            registerType(rawType, {
                name,
                fromWireType(value) {
                    var length = HEAPU32[(value >>> 2) >>> 0];
                    var payload = value + 4;
                    var str;
                    if (stdStringIsUTF8) {
                        var decodeStartPtr = payload;
                        for (var i = 0; i <= length; ++i) {
                            var currentBytePtr = payload + i;
                            if (i == length || HEAPU8[currentBytePtr >>> 0] == 0) {
                                var maxRead = currentBytePtr - decodeStartPtr;
                                var stringSegment = UTF8ToString(decodeStartPtr, maxRead);
                                if (str === undefined) {
                                    str = stringSegment;
                                } else {
                                    str += String.fromCharCode(0);
                                    str += stringSegment;
                                }
                                decodeStartPtr = currentBytePtr + 1;
                            }
                        }
                    } else {
                        var a = new Array(length);
                        for (var i = 0; i < length; ++i) {
                            a[i] = String.fromCharCode(HEAPU8[(payload + i) >>> 0]);
                        }
                        str = a.join("");
                    }
                    _free(value);
                    return str;
                },
                toWireType(destructors, value) {
                    if (value instanceof ArrayBuffer) {
                        value = new Uint8Array(value);
                    }
                    var length;
                    var valueIsOfTypeString = typeof value == "string";
                    if (
                        !(valueIsOfTypeString || (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT == 1))
                    ) {
                        throwBindingError("Cannot pass non-string to std::string");
                    }
                    if (stdStringIsUTF8 && valueIsOfTypeString) {
                        length = lengthBytesUTF8(value);
                    } else {
                        length = value.length;
                    }
                    var base = _malloc(4 + length + 1);
                    var ptr = base + 4;
                    HEAPU32[(base >>> 2) >>> 0] = length;
                    if (valueIsOfTypeString) {
                        if (stdStringIsUTF8) {
                            stringToUTF8(value, ptr, length + 1);
                        } else {
                            for (var i = 0; i < length; ++i) {
                                var charCode = value.charCodeAt(i);
                                if (charCode > 255) {
                                    _free(base);
                                    throwBindingError(
                                        "String has UTF-16 code units that do not fit in 8 bits",
                                    );
                                }
                                HEAPU8[(ptr + i) >>> 0] = charCode;
                            }
                        }
                    } else {
                        HEAPU8.set(value, ptr >>> 0);
                    }
                    if (destructors !== null) {
                        destructors.push(_free, base);
                    }
                    return base;
                },
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: readPointer,
                destructorFunction(ptr) {
                    _free(ptr);
                },
            });
        }
        var UTF16Decoder = typeof TextDecoder != "undefined" ? new TextDecoder("utf-16le") : undefined;
        var UTF16ToString = (ptr, maxBytesToRead) => {
            var endPtr = ptr;
            var idx = endPtr >> 1;
            var maxIdx = idx + maxBytesToRead / 2;
            while (!(idx >= maxIdx) && HEAPU16[idx >>> 0]) ++idx;
            endPtr = idx << 1;
            if (endPtr - ptr > 32 && UTF16Decoder)
                return UTF16Decoder.decode(HEAPU8.subarray(ptr >>> 0, endPtr >>> 0));
            var str = "";
            for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
                var codeUnit = HEAP16[((ptr + i * 2) >>> 1) >>> 0];
                if (codeUnit == 0) break;
                str += String.fromCharCode(codeUnit);
            }
            return str;
        };
        var stringToUTF16 = (str, outPtr, maxBytesToWrite) => {
            maxBytesToWrite ??= 2147483647;
            if (maxBytesToWrite < 2) return 0;
            maxBytesToWrite -= 2;
            var startPtr = outPtr;
            var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
            for (var i = 0; i < numCharsToWrite; ++i) {
                var codeUnit = str.charCodeAt(i);
                HEAP16[(outPtr >>> 1) >>> 0] = codeUnit;
                outPtr += 2;
            }
            HEAP16[(outPtr >>> 1) >>> 0] = 0;
            return outPtr - startPtr;
        };
        var lengthBytesUTF16 = (str) => str.length * 2;
        var UTF32ToString = (ptr, maxBytesToRead) => {
            var i = 0;
            var str = "";
            while (!(i >= maxBytesToRead / 4)) {
                var utf32 = HEAP32[((ptr + i * 4) >>> 2) >>> 0];
                if (utf32 == 0) break;
                ++i;
                if (utf32 >= 65536) {
                    var ch = utf32 - 65536;
                    str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
                } else {
                    str += String.fromCharCode(utf32);
                }
            }
            return str;
        };
        var stringToUTF32 = (str, outPtr, maxBytesToWrite) => {
            outPtr >>>= 0;
            maxBytesToWrite ??= 2147483647;
            if (maxBytesToWrite < 4) return 0;
            var startPtr = outPtr;
            var endPtr = startPtr + maxBytesToWrite - 4;
            for (var i = 0; i < str.length; ++i) {
                var codeUnit = str.charCodeAt(i);
                if (codeUnit >= 55296 && codeUnit <= 57343) {
                    var trailSurrogate = str.charCodeAt(++i);
                    codeUnit = (65536 + ((codeUnit & 1023) << 10)) | (trailSurrogate & 1023);
                }
                HEAP32[(outPtr >>> 2) >>> 0] = codeUnit;
                outPtr += 4;
                if (outPtr + 4 > endPtr) break;
            }
            HEAP32[(outPtr >>> 2) >>> 0] = 0;
            return outPtr - startPtr;
        };
        var lengthBytesUTF32 = (str) => {
            var len = 0;
            for (var i = 0; i < str.length; ++i) {
                var codeUnit = str.charCodeAt(i);
                if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
                len += 4;
            }
            return len;
        };
        var __embind_register_std_wstring = function (rawType, charSize, name) {
            rawType >>>= 0;
            charSize >>>= 0;
            name >>>= 0;
            name = readLatin1String(name);
            var decodeString, encodeString, readCharAt, lengthBytesUTF;
            if (charSize === 2) {
                decodeString = UTF16ToString;
                encodeString = stringToUTF16;
                lengthBytesUTF = lengthBytesUTF16;
                readCharAt = (pointer) => HEAPU16[(pointer >>> 1) >>> 0];
            } else if (charSize === 4) {
                decodeString = UTF32ToString;
                encodeString = stringToUTF32;
                lengthBytesUTF = lengthBytesUTF32;
                readCharAt = (pointer) => HEAPU32[(pointer >>> 2) >>> 0];
            }
            registerType(rawType, {
                name,
                fromWireType: (value) => {
                    var length = HEAPU32[(value >>> 2) >>> 0];
                    var str;
                    var decodeStartPtr = value + 4;
                    for (var i = 0; i <= length; ++i) {
                        var currentBytePtr = value + 4 + i * charSize;
                        if (i == length || readCharAt(currentBytePtr) == 0) {
                            var maxReadBytes = currentBytePtr - decodeStartPtr;
                            var stringSegment = decodeString(decodeStartPtr, maxReadBytes);
                            if (str === undefined) {
                                str = stringSegment;
                            } else {
                                str += String.fromCharCode(0);
                                str += stringSegment;
                            }
                            decodeStartPtr = currentBytePtr + charSize;
                        }
                    }
                    _free(value);
                    return str;
                },
                toWireType: (destructors, value) => {
                    if (!(typeof value == "string")) {
                        throwBindingError(`Cannot pass non-string to C++ string type ${name}`);
                    }
                    var length = lengthBytesUTF(value);
                    var ptr = _malloc(4 + length + charSize);
                    HEAPU32[(ptr >>> 2) >>> 0] = length / charSize;
                    encodeString(value, ptr + 4, length + charSize);
                    if (destructors !== null) {
                        destructors.push(_free, ptr);
                    }
                    return ptr;
                },
                argPackAdvance: GenericWireTypeSize,
                readValueFromPointer: readPointer,
                destructorFunction(ptr) {
                    _free(ptr);
                },
            });
        };
        function __embind_register_user_type(rawType, name) {
            rawType >>>= 0;
            name >>>= 0;
            __embind_register_emval(rawType);
        }
        function __embind_register_value_object(
            rawType,
            name,
            constructorSignature,
            rawConstructor,
            destructorSignature,
            rawDestructor,
        ) {
            rawType >>>= 0;
            name >>>= 0;
            constructorSignature >>>= 0;
            rawConstructor >>>= 0;
            destructorSignature >>>= 0;
            rawDestructor >>>= 0;
            structRegistrations[rawType] = {
                name: readLatin1String(name),
                rawConstructor: embind__requireFunction(constructorSignature, rawConstructor),
                rawDestructor: embind__requireFunction(destructorSignature, rawDestructor),
                fields: [],
            };
        }
        function __embind_register_value_object_field(
            structType,
            fieldName,
            getterReturnType,
            getterSignature,
            getter,
            getterContext,
            setterArgumentType,
            setterSignature,
            setter,
            setterContext,
        ) {
            structType >>>= 0;
            fieldName >>>= 0;
            getterReturnType >>>= 0;
            getterSignature >>>= 0;
            getter >>>= 0;
            getterContext >>>= 0;
            setterArgumentType >>>= 0;
            setterSignature >>>= 0;
            setter >>>= 0;
            setterContext >>>= 0;
            structRegistrations[structType].fields.push({
                fieldName: readLatin1String(fieldName),
                getterReturnType,
                getter: embind__requireFunction(getterSignature, getter),
                getterContext,
                setterArgumentType,
                setter: embind__requireFunction(setterSignature, setter),
                setterContext,
            });
        }
        var __embind_register_void = function (rawType, name) {
            rawType >>>= 0;
            name >>>= 0;
            name = readLatin1String(name);
            registerType(rawType, {
                isVoid: true,
                name,
                argPackAdvance: 0,
                fromWireType: () => undefined,
                toWireType: (destructors, o) => undefined,
            });
        };
        var inetPton4 = (str) => {
            var b = str.split(".");
            for (var i = 0; i < 4; i++) {
                var tmp = Number(b[i]);
                if (isNaN(tmp)) return null;
                b[i] = tmp;
            }
            return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
        };
        var inetPton6 = (str) => {
            var words;
            var w, offset, z;
            var valid6regx =
                /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i;
            var parts = [];
            if (!valid6regx.test(str)) {
                return null;
            }
            if (str === "::") {
                return [0, 0, 0, 0, 0, 0, 0, 0];
            }
            if (str.startsWith("::")) {
                str = str.replace("::", "Z:");
            } else {
                str = str.replace("::", ":Z:");
            }
            if (str.indexOf(".") > 0) {
                str = str.replace(new RegExp("[.]", "g"), ":");
                words = str.split(":");
                words[words.length - 4] =
                    Number(words[words.length - 4]) + Number(words[words.length - 3]) * 256;
                words[words.length - 3] =
                    Number(words[words.length - 2]) + Number(words[words.length - 1]) * 256;
                words = words.slice(0, words.length - 2);
            } else {
                words = str.split(":");
            }
            offset = 0;
            z = 0;
            for (w = 0; w < words.length; w++) {
                if (typeof words[w] == "string") {
                    if (words[w] === "Z") {
                        for (z = 0; z < 8 - words.length + 1; z++) {
                            parts[w + z] = 0;
                        }
                        offset = z - 1;
                    } else {
                        parts[w + offset] = _htons(parseInt(words[w], 16));
                    }
                } else {
                    parts[w + offset] = words[w];
                }
            }
            return [
                (parts[1] << 16) | parts[0],
                (parts[3] << 16) | parts[2],
                (parts[5] << 16) | parts[4],
                (parts[7] << 16) | parts[6],
            ];
        };
        var DNS = {
            address_map: { id: 1, addrs: {}, names: {} },
            lookup_name(name) {
                var res = inetPton4(name);
                if (res !== null) {
                    return name;
                }
                res = inetPton6(name);
                if (res !== null) {
                    return name;
                }
                var addr;
                if (DNS.address_map.addrs[name]) {
                    addr = DNS.address_map.addrs[name];
                } else {
                    var id = DNS.address_map.id++;
                    assert(id < 65535, "exceeded max address mappings of 65535");
                    addr = "172.29." + (id & 255) + "." + (id & 65280);
                    DNS.address_map.names[addr] = name;
                    DNS.address_map.addrs[name] = addr;
                }
                return addr;
            },
            lookup_addr(addr) {
                if (DNS.address_map.names[addr]) {
                    return DNS.address_map.names[addr];
                }
                return null;
            },
        };
        function __emscripten_lookup_name(name) {
            name >>>= 0;
            var nameString = UTF8ToString(name);
            return inetPton4(DNS.lookup_name(nameString));
        }
        var runtimeKeepaliveCounter = 0;
        var __emscripten_runtime_keepalive_clear = () => {
            noExitRuntime = false;
            runtimeKeepaliveCounter = 0;
        };
        var emval_returnValue = (returnType, destructorsRef, handle) => {
            var destructors = [];
            var result = returnType["toWireType"](destructors, handle);
            if (destructors.length) {
                HEAPU32[(destructorsRef >>> 2) >>> 0] = Emval.toHandle(destructors);
            }
            return result;
        };
        function __emval_as(handle, returnType, destructorsRef) {
            handle >>>= 0;
            returnType >>>= 0;
            destructorsRef >>>= 0;
            handle = Emval.toValue(handle);
            returnType = requireRegisteredType(returnType, "emval::as");
            return emval_returnValue(returnType, destructorsRef, handle);
        }
        var emval_symbols = {};
        var getStringOrSymbol = (address) => {
            var symbol = emval_symbols[address];
            if (symbol === undefined) {
                return readLatin1String(address);
            }
            return symbol;
        };
        var emval_methodCallers = [];
        function __emval_call_method(caller, objHandle, methodName, destructorsRef, args) {
            caller >>>= 0;
            objHandle >>>= 0;
            methodName >>>= 0;
            destructorsRef >>>= 0;
            args >>>= 0;
            caller = emval_methodCallers[caller];
            objHandle = Emval.toValue(objHandle);
            methodName = getStringOrSymbol(methodName);
            return caller(objHandle, objHandle[methodName], destructorsRef, args);
        }
        var emval_addMethodCaller = (caller) => {
            var id = emval_methodCallers.length;
            emval_methodCallers.push(caller);
            return id;
        };
        var emval_lookupTypes = (argCount, argTypes) => {
            var a = new Array(argCount);
            for (var i = 0; i < argCount; ++i) {
                a[i] = requireRegisteredType(HEAPU32[((argTypes + i * 4) >>> 2) >>> 0], `parameter ${i}`);
            }
            return a;
        };
        function __emval_get_method_caller(argCount, argTypes, kind) {
            argTypes >>>= 0;
            var types = emval_lookupTypes(argCount, argTypes);
            var retType = types.shift();
            argCount--;
            var functionBody = `return function (obj, func, destructorsRef, args) {\n`;
            var offset = 0;
            var argsList = [];
            if (kind === 0) {
                argsList.push("obj");
            }
            var params = ["retType"];
            var args = [retType];
            for (var i = 0; i < argCount; ++i) {
                argsList.push(`arg${i}`);
                params.push(`argType${i}`);
                args.push(types[i]);
                functionBody += `  var arg${i} = argType${i}.readValueFromPointer(args${offset ? "+" + offset : ""});\n`;
                offset += types[i].argPackAdvance;
            }
            var invoker = kind === 1 ? "new func" : "func.call";
            functionBody += `  var rv = ${invoker}(${argsList.join(", ")});\n`;
            if (!retType.isVoid) {
                params.push("emval_returnValue");
                args.push(emval_returnValue);
                functionBody += "  return emval_returnValue(retType, destructorsRef, rv);\n";
            }
            functionBody += "};\n";
            var invokerFunction = new Function(...params, functionBody)(...args);
            var functionName = `methodCaller<(${types.map((t) => t.name).join(", ")}) => ${retType.name}>`;
            return emval_addMethodCaller(createNamedFunction(functionName, invokerFunction));
        }
        function __emval_get_property(handle, key) {
            handle >>>= 0;
            key >>>= 0;
            handle = Emval.toValue(handle);
            key = Emval.toValue(key);
            return Emval.toHandle(handle[key]);
        }
        function __emval_incref(handle) {
            handle >>>= 0;
            if (handle > 9) {
                emval_handles[handle + 1] += 1;
            }
        }
        function __emval_new_array() {
            return Emval.toHandle([]);
        }
        function __emval_new_array_from_memory_view(view) {
            view >>>= 0;
            view = Emval.toValue(view);
            var a = new Array(view.length);
            for (var i = 0; i < view.length; i++) a[i] = view[i];
            return Emval.toHandle(a);
        }
        function __emval_new_cstring(v) {
            v >>>= 0;
            return Emval.toHandle(getStringOrSymbol(v));
        }
        function __emval_run_destructors(handle) {
            handle >>>= 0;
            var destructors = Emval.toValue(handle);
            runDestructors(destructors);
            __emval_decref(handle);
        }
        function __emval_take_value(type, arg) {
            type >>>= 0;
            arg >>>= 0;
            type = requireRegisteredType(type, "_emval_take_value");
            var v = type["readValueFromPointer"](arg);
            return Emval.toHandle(v);
        }
        var isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        var MONTH_DAYS_LEAP_CUMULATIVE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
        var MONTH_DAYS_REGULAR_CUMULATIVE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        var ydayFromDate = (date) => {
            var leap = isLeapYear(date.getFullYear());
            var monthDaysCumulative = leap ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE;
            var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1;
            return yday;
        };
        function __localtime_js(time, tmPtr) {
            time = bigintToI53Checked(time);
            tmPtr >>>= 0;
            var date = new Date(time * 1e3);
            HEAP32[(tmPtr >>> 2) >>> 0] = date.getSeconds();
            HEAP32[((tmPtr + 4) >>> 2) >>> 0] = date.getMinutes();
            HEAP32[((tmPtr + 8) >>> 2) >>> 0] = date.getHours();
            HEAP32[((tmPtr + 12) >>> 2) >>> 0] = date.getDate();
            HEAP32[((tmPtr + 16) >>> 2) >>> 0] = date.getMonth();
            HEAP32[((tmPtr + 20) >>> 2) >>> 0] = date.getFullYear() - 1900;
            HEAP32[((tmPtr + 24) >>> 2) >>> 0] = date.getDay();
            var yday = ydayFromDate(date) | 0;
            HEAP32[((tmPtr + 28) >>> 2) >>> 0] = yday;
            HEAP32[((tmPtr + 36) >>> 2) >>> 0] = -(date.getTimezoneOffset() * 60);
            var start = new Date(date.getFullYear(), 0, 1);
            var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
            var winterOffset = start.getTimezoneOffset();
            var dst =
                (summerOffset != winterOffset &&
                    date.getTimezoneOffset() == Math.min(winterOffset, summerOffset)) | 0;
            HEAP32[((tmPtr + 32) >>> 2) >>> 0] = dst;
        }
        var timers = {};
        var handleException = (e) => {
            if (e instanceof ExitStatus || e == "unwind") {
                return EXITSTATUS;
            }
            quit_(1, e);
        };
        var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
        var _proc_exit = (code) => {
            EXITSTATUS = code;
            if (!keepRuntimeAlive()) {
                Module["onExit"]?.(code);
                ABORT = true;
            }
            quit_(code, new ExitStatus(code));
        };
        var exitJS = (status, implicit) => {
            EXITSTATUS = status;
            _proc_exit(status);
        };
        var _exit = exitJS;
        var maybeExit = () => {
            if (!keepRuntimeAlive()) {
                try {
                    _exit(EXITSTATUS);
                } catch (e) {
                    handleException(e);
                }
            }
        };
        var callUserCallback = (func) => {
            if (ABORT) {
                return;
            }
            try {
                func();
                maybeExit();
            } catch (e) {
                handleException(e);
            }
        };
        var _emscripten_get_now = () => performance.now();
        var __setitimer_js = (which, timeout_ms) => {
            if (timers[which]) {
                clearTimeout(timers[which].id);
                delete timers[which];
            }
            if (!timeout_ms) return 0;
            var id = setTimeout(() => {
                delete timers[which];
                callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
            }, timeout_ms);
            timers[which] = { id, timeout_ms };
            return 0;
        };
        var __tzset_js = function (timezone, daylight, std_name, dst_name) {
            timezone >>>= 0;
            daylight >>>= 0;
            std_name >>>= 0;
            dst_name >>>= 0;
            var currentYear = new Date().getFullYear();
            var winter = new Date(currentYear, 0, 1);
            var summer = new Date(currentYear, 6, 1);
            var winterOffset = winter.getTimezoneOffset();
            var summerOffset = summer.getTimezoneOffset();
            var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
            HEAPU32[(timezone >>> 2) >>> 0] = stdTimezoneOffset * 60;
            HEAP32[(daylight >>> 2) >>> 0] = Number(winterOffset != summerOffset);
            var extractZone = (timezoneOffset) => {
                var sign = timezoneOffset >= 0 ? "-" : "+";
                var absOffset = Math.abs(timezoneOffset);
                var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
                var minutes = String(absOffset % 60).padStart(2, "0");
                return `UTC${sign}${hours}${minutes}`;
            };
            var winterName = extractZone(winterOffset);
            var summerName = extractZone(summerOffset);
            if (summerOffset < winterOffset) {
                stringToUTF8(winterName, std_name, 17);
                stringToUTF8(summerName, dst_name, 17);
            } else {
                stringToUTF8(winterName, dst_name, 17);
                stringToUTF8(summerName, std_name, 17);
            }
        };
        var _emscripten_date_now = () => Date.now();
        var nowIsMonotonic = 1;
        var checkWasiClock = (clock_id) => clock_id >= 0 && clock_id <= 3;
        function _clock_time_get(clk_id, ignored_precision, ptime) {
            ignored_precision = bigintToI53Checked(ignored_precision);
            ptime >>>= 0;
            if (!checkWasiClock(clk_id)) {
                return 28;
            }
            var now;
            if (clk_id === 0) {
                now = _emscripten_date_now();
            } else if (nowIsMonotonic) {
                now = _emscripten_get_now();
            } else {
                return 52;
            }
            var nsec = Math.round(now * 1e3 * 1e3);
            HEAP64[ptime >>> 3] = BigInt(nsec);
            return 0;
        }
        var getHeapMax = () => 4294901760;
        function _emscripten_get_heap_max() {
            return getHeapMax();
        }
        var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
        var growMemory = (size) => {
            var b = wasmMemory.buffer;
            var pages = ((size - b.byteLength + 65535) / 65536) | 0;
            try {
                wasmMemory.grow(pages);
                updateMemoryViews();
                return 1;
            } catch (e) {}
        };
        function _emscripten_resize_heap(requestedSize) {
            requestedSize >>>= 0;
            var oldSize = HEAPU8.length;
            var maxHeapSize = getHeapMax();
            if (requestedSize > maxHeapSize) {
                return false;
            }
            for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
                var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
                overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
                var newSize = Math.min(
                    maxHeapSize,
                    alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536),
                );
                var replacement = growMemory(newSize);
                if (replacement) {
                    return true;
                }
            }
            return false;
        }
        var ENV = {};
        var getExecutableName = () => thisProgram || "./this.program";
        var getEnvStrings = () => {
            if (!getEnvStrings.strings) {
                var lang =
                    (
                        (typeof navigator == "object" && navigator.languages && navigator.languages[0]) ||
                        "C"
                    ).replace("-", "_") + ".UTF-8";
                var env = {
                    USER: "web_user",
                    LOGNAME: "web_user",
                    PATH: "/",
                    PWD: "/",
                    HOME: "/home/web_user",
                    LANG: lang,
                    _: getExecutableName(),
                };
                for (var x in ENV) {
                    if (ENV[x] === undefined) delete env[x];
                    else env[x] = ENV[x];
                }
                var strings = [];
                for (var x in env) {
                    strings.push(`${x}=${env[x]}`);
                }
                getEnvStrings.strings = strings;
            }
            return getEnvStrings.strings;
        };
        function _environ_get(__environ, environ_buf) {
            __environ >>>= 0;
            environ_buf >>>= 0;
            var bufSize = 0;
            var envp = 0;
            for (var string of getEnvStrings()) {
                var ptr = environ_buf + bufSize;
                HEAPU32[((__environ + envp) >>> 2) >>> 0] = ptr;
                bufSize += stringToUTF8(string, ptr, Infinity) + 1;
                envp += 4;
            }
            return 0;
        }
        function _environ_sizes_get(penviron_count, penviron_buf_size) {
            penviron_count >>>= 0;
            penviron_buf_size >>>= 0;
            var strings = getEnvStrings();
            HEAPU32[(penviron_count >>> 2) >>> 0] = strings.length;
            var bufSize = 0;
            for (var string of strings) {
                bufSize += lengthBytesUTF8(string) + 1;
            }
            HEAPU32[(penviron_buf_size >>> 2) >>> 0] = bufSize;
            return 0;
        }
        function _fd_close(fd) {
            try {
                var stream = SYSCALLS.getStreamFromFD(fd);
                FS.close(stream);
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return e.errno;
            }
        }
        var doReadv = (stream, iov, iovcnt, offset) => {
            var ret = 0;
            for (var i = 0; i < iovcnt; i++) {
                var ptr = HEAPU32[(iov >>> 2) >>> 0];
                var len = HEAPU32[((iov + 4) >>> 2) >>> 0];
                iov += 8;
                var curr = FS.read(stream, HEAP8, ptr, len, offset);
                if (curr < 0) return -1;
                ret += curr;
                if (curr < len) break;
                if (typeof offset != "undefined") {
                    offset += curr;
                }
            }
            return ret;
        };
        function _fd_read(fd, iov, iovcnt, pnum) {
            iov >>>= 0;
            iovcnt >>>= 0;
            pnum >>>= 0;
            try {
                var stream = SYSCALLS.getStreamFromFD(fd);
                var num = doReadv(stream, iov, iovcnt);
                HEAPU32[(pnum >>> 2) >>> 0] = num;
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return e.errno;
            }
        }
        function _fd_seek(fd, offset, whence, newOffset) {
            offset = bigintToI53Checked(offset);
            newOffset >>>= 0;
            try {
                if (isNaN(offset)) return 61;
                var stream = SYSCALLS.getStreamFromFD(fd);
                FS.llseek(stream, offset, whence);
                HEAP64[newOffset >>> 3] = BigInt(stream.position);
                if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null;
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return e.errno;
            }
        }
        var doWritev = (stream, iov, iovcnt, offset) => {
            var ret = 0;
            for (var i = 0; i < iovcnt; i++) {
                var ptr = HEAPU32[(iov >>> 2) >>> 0];
                var len = HEAPU32[((iov + 4) >>> 2) >>> 0];
                iov += 8;
                var curr = FS.write(stream, HEAP8, ptr, len, offset);
                if (curr < 0) return -1;
                ret += curr;
                if (curr < len) {
                    break;
                }
                if (typeof offset != "undefined") {
                    offset += curr;
                }
            }
            return ret;
        };
        function _fd_write(fd, iov, iovcnt, pnum) {
            iov >>>= 0;
            iovcnt >>>= 0;
            pnum >>>= 0;
            try {
                var stream = SYSCALLS.getStreamFromFD(fd);
                var num = doWritev(stream, iov, iovcnt);
                HEAPU32[(pnum >>> 2) >>> 0] = num;
                return 0;
            } catch (e) {
                if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
                return e.errno;
            }
        }
        FS.createPreloadedFile = FS_createPreloadedFile;
        FS.staticInit();
        MEMFS.doesNotExistError = new FS.ErrnoError(44);
        MEMFS.doesNotExistError.stack = "<generic error, no stack>";
        embind_init_charCodes();
        init_ClassHandle();
        init_RegisteredPointer();
        init_emval();
        {
            if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
            if (Module["preloadPlugins"]) preloadPlugins = Module["preloadPlugins"];
            if (Module["print"]) out = Module["print"];
            if (Module["printErr"]) err = Module["printErr"];
            if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
            if (Module["arguments"]) arguments_ = Module["arguments"];
            if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
        }
        function OSD_MemInfo_getModuleHeapLength() {
            return Module.HEAP8.length;
        }
        var wasmImports = {
            da: OSD_MemInfo_getModuleHeapLength,
            a: ___cxa_throw,
            Y: ___syscall_chmod,
            Z: ___syscall_faccessat,
            y: ___syscall_fcntl64,
            V: ___syscall_fstat64,
            ba: ___syscall_ioctl,
            T: ___syscall_lstat64,
            S: ___syscall_newfstatat,
            A: ___syscall_openat,
            M: ___syscall_rmdir,
            U: ___syscall_stat64,
            N: ___syscall_unlinkat,
            L: __abort_js,
            p: __embind_finalize_value_object,
            D: __embind_register_bigint,
            ga: __embind_register_bool,
            e: __embind_register_class,
            c: __embind_register_class_class_function,
            j: __embind_register_class_constructor,
            b: __embind_register_class_function,
            g: __embind_register_class_property,
            ea: __embind_register_emval,
            w: __embind_register_enum,
            h: __embind_register_enum_value,
            C: __embind_register_float,
            r: __embind_register_integer,
            l: __embind_register_memory_view,
            v: __embind_register_optional,
            fa: __embind_register_std_string,
            z: __embind_register_std_wstring,
            k: __embind_register_user_type,
            q: __embind_register_value_object,
            m: __embind_register_value_object_field,
            ha: __embind_register_void,
            G: __emscripten_lookup_name,
            K: __emscripten_runtime_keepalive_clear,
            n: __emval_as,
            t: __emval_call_method,
            d: __emval_decref,
            s: __emval_get_method_caller,
            E: __emval_get_property,
            f: __emval_incref,
            u: __emval_new_array,
            B: __emval_new_array_from_memory_view,
            ia: __emval_new_cstring,
            i: __emval_run_destructors,
            o: __emval_take_value,
            O: __localtime_js,
            F: __setitimer_js,
            _: __tzset_js,
            X: _clock_time_get,
            W: _emscripten_date_now,
            I: _emscripten_get_heap_max,
            H: _emscripten_resize_heap,
            Q: _environ_get,
            R: _environ_sizes_get,
            ca: _exit,
            x: _fd_close,
            aa: _fd_read,
            P: _fd_seek,
            $: _fd_write,
            J: _proc_exit,
        };
        var wasmExports = await createWasm();
        var ___wasm_call_ctors = wasmExports["ka"];
        var ___getTypeName = wasmExports["la"];
        var _malloc = wasmExports["ma"];
        var _free = wasmExports["na"];
        var _htons = wasmExports["pa"];
        var __emscripten_timeout = wasmExports["qa"];
        function applySignatureConversions(wasmExports) {
            wasmExports = Object.assign({}, wasmExports);
            var makeWrapper_pp = (f) => (a0) => f(a0) >>> 0;
            var makeWrapper_p = (f) => () => f() >>> 0;
            wasmExports["la"] = makeWrapper_pp(wasmExports["la"]);
            wasmExports["ma"] = makeWrapper_pp(wasmExports["ma"]);
            wasmExports["_emscripten_stack_alloc"] = makeWrapper_pp(wasmExports["_emscripten_stack_alloc"]);
            wasmExports["emscripten_stack_get_current"] = makeWrapper_p(
                wasmExports["emscripten_stack_get_current"],
            );
            return wasmExports;
        }
        function run() {
            if (runDependencies > 0) {
                dependenciesFulfilled = run;
                return;
            }
            preRun();
            if (runDependencies > 0) {
                dependenciesFulfilled = run;
                return;
            }
            function doRun() {
                Module["calledRun"] = true;
                if (ABORT) return;
                initRuntime();
                readyPromiseResolve(Module);
                Module["onRuntimeInitialized"]?.();
                postRun();
            }
            if (Module["setStatus"]) {
                Module["setStatus"]("Running...");
                setTimeout(() => {
                    setTimeout(() => Module["setStatus"](""), 1);
                    doRun();
                }, 1);
            } else {
                doRun();
            }
        }
        function preInit() {
            if (Module["preInit"]) {
                if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
                while (Module["preInit"].length > 0) {
                    Module["preInit"].shift()();
                }
            }
        }
        preInit();
        run();
        moduleRtn = readyPromise;

        return moduleRtn;
    };
})();
export default Module;
