// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Build-time codegen: parse IShapeFactory plus the IShape/ICurve/ISurface interface
// families from core's TypeScript source and emit the AI-facing capability catalog
// (packages/ai/src/tools/capabilities.generated.ts), including the query API doc that
// backs the "shape-query" skill. Zero hand-maintained capability metadata — the real
// source is the single truth.
//
// Run: node scripts/generate-shape-capabilities.mjs

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const factoryPath = resolve(root, "packages/core/src/shape/shapeFactory.ts");
const outPath = resolve(root, "packages/ai/src/tools/capabilities.generated.ts");

// Interface family -> query owner prefix. Shape-family owners are validated at runtime
// against ShapeTypes bit flags; concrete curve owners (runtimeTypes) against curveType.
// Abstract owners (curve/conic/boundedCurve/...) pass the kind check only — sub-interface
// members are not flattened into concrete owners, the doc explains the hierarchy.
const QUERY_SOURCES = [
    {
        file: "packages/core/src/shape/shape.ts",
        family: "shape",
        owners: {
            IShape: "shape",
            IVertex: "vertex",
            IEdge: "edge",
            IWire: "wire",
            IFace: "face",
            IShell: "shell",
            ISolid: "solid",
        },
    },
    {
        file: "packages/core/src/shape/curve.ts",
        family: "curve",
        owners: {
            ICurve: "curve",
            ILine: "line",
            IConic: "conic",
            ICircle: "circle",
            IEllipse: "ellipse",
            IHyperbola: "hyperbola",
            IParabola: "parabola",
            IBoundedCurve: "boundedCurve",
            IBezierCurve: "bezierCurve",
            IBSplineCurve: "bsplineCurve",
            ITrimmedCurve: "trimmedCurve",
            IOffsetCurve: "offsetCurve",
            IComplexCurve: "complexCurve",
        },
        runtimeTypes: {
            line: "line",
            circle: "circle",
            ellipse: "ellipse",
            hyperbola: "hyperbola",
            parabola: "parabola",
            bezierCurve: "bezierCurve",
            bsplineCurve: "bsplineCurve",
            trimmedCurve: "trimmedCurve",
            offsetCurve: "offsetCurve",
        },
    },
    {
        file: "packages/core/src/shape/surface.ts",
        family: "surface",
        owners: {
            ISurface: "surface",
            IPlateSurface: "plateSurface",
            IBoundedSurface: "boundedSurface",
            IElementarySurface: "elementarySurface",
            IOffsetSurface: "offsetSurface",
            ISweptSurface: "sweptSurface",
            ICompositeSurface: "compositeSurface",
            IBSplineSurface: "bsplineSurface",
            IBezierSurface: "bezierSurface",
            IRectangularTrimmedSurface: "rectangularTrimmedSurface",
            IConicalSurface: "conicalSurface",
            ICylindricalSurface: "cylindricalSurface",
            IPlaneSurface: "planeSurface",
            ISphericalSurface: "sphericalSurface",
            IToroidalSurface: "toroidalSurface",
            ISurfaceOfLinearExtrusion: "linearExtrusionSurface",
            ISurfaceOfRevolution: "revolutionSurface",
        },
    },
];

const ENUM_VALUES = {
    Continuity: ["c0", "g1", "c1", "g2", "c2", "c3", "cn"],
    JoinType: ["arc", "tangent", "intersection"],
    OffsetMode: ["skin", "pipe", "rectoVerso"],
};

const SINGLE_SHAPE = new Set([
    "IShape",
    "ISolid",
    "IEdge",
    "IFace",
    "IWire",
    "IVertex",
    "ICompound",
    "ICompoundSolid",
    "IShell",
]);

// Only types that actually appear in parameter positions need listing here — return types
// are classified by the checker against all interface names collected from the sources.
const CURVE_TYPES = new Set(["ICurve"]);

// Class instances whose own data properties serialize cleanly to JSON.
const JSON_OK_CLASSES = new Set([
    "XYZ",
    "XYZLike",
    "BoundingBox",
    "OrientedBoundingBox",
    "Plane",
    "Line",
    "Ax3",
    "Matrix4",
]);

const RETURN_KINDS = {
    ISolid: "solid",
    IEdge: "edge",
    IWire: "wire",
    IFace: "face",
    ICompound: "compound",
    ICompoundSolid: "compound",
    IShell: "shell",
    IVertex: "vertex",
    IShape: "shape",
};

/** Classify a parameter type string; returns { kind, enum? } or null if unusable. */
function classifyParam(raw) {
    const typeStr = raw.replace(/ \| undefined$/, "");
    if (typeStr === "number") return { kind: "number" };
    if (typeStr === "boolean") return { kind: "boolean" };
    if (typeStr === "string") return { kind: "string" };
    if (typeStr === "number[]") return { kind: "numberArray" };
    if (typeStr === "XYZLike" || typeStr === "XYZ") return { kind: "xyz" };
    if (typeStr === "XYZLike[]" || typeStr === "XYZ[]") return { kind: "xyzArray" };
    if (typeStr === "Plane") return { kind: "plane" };
    if (typeStr === "Line") return { kind: "line" };
    if (typeStr === "ShapeType") return { kind: "shapeType" };
    if (CURVE_TYPES.has(typeStr)) return { kind: "curveRef" };
    if (SINGLE_SHAPE.has(typeStr)) return { kind: "ref" };
    if (ENUM_VALUES[typeStr]) return { kind: "enum", enum: ENUM_VALUES[typeStr] };

    // Union of string literals, e.g. "c0" | "g1" | "c1" (Continuity) or "arc" | "tangent".
    if (/^"[^"]*"( \| "[^"]*")*$/.test(typeStr)) {
        return { kind: "enum", enum: typeStr.split(" | ").map((s) => s.replace(/"/g, "")) };
    }

    return classifyUnionParam(typeStr);
}

/** Union-typed parameters: shape unions, ref-or-geometry literals and shape arrays. */
function classifyUnionParam(typeStr) {
    const unionParts = typeStr.split(" | ");

    // Union of single shapes, e.g. IWire | IEdge (a curve that is one of several kinds).
    if (unionParts.every((t) => SINGLE_SHAPE.has(t))) {
        return { kind: "ref" };
    }

    // Geometry ref or an inline line, e.g. IEdge | Line, ICurve | Line.
    if (
        unionParts.includes("Line") &&
        unionParts.every((t) => t === "Line" || SINGLE_SHAPE.has(t) || CURVE_TYPES.has(t))
    ) {
        return { kind: "refOrLine" };
    }

    // Shape ref or an inline plane, e.g. IShape | Plane.
    if (unionParts.includes("Plane") && unionParts.every((t) => t === "Plane" || SINGLE_SHAPE.has(t))) {
        return { kind: "refOrPlane" };
    }

    if (typeStr.endsWith("[]")) {
        const inner = typeStr.slice(0, -2).replace(/^\(|\)$/g, "");
        if (inner.split(" | ").every((t) => SINGLE_SHAPE.has(t))) {
            return { kind: "refArray" };
        }
    }

    return null;
}

function classifyReturn(typeStr) {
    const m = typeStr.match(/^Result<([^,>]+)/);
    const inner = m ? m[1] : typeStr;
    // { shape: IShape; ... } — node created from .shape, array extras reported as refs.
    if (inner.startsWith("{")) {
        const shapeProp = inner.match(/shape:\s*(\w+)/);
        return shapeProp && RETURN_KINDS[shapeProp[1]] ? "shapeWithData" : null;
    }
    if (inner.includes("[]")) return null; // array results are not node-wrappable
    return RETURN_KINDS[inner] ?? null;
}

/** Names of every interface declared in each shape source file (for return-type routing). */
function collectInterfaceNames(program) {
    const names = { shape: new Set(), curve: new Set(), surface: new Set() };
    for (const { file } of QUERY_SOURCES) {
        const sf = program.getSourceFile(resolve(root, file));
        const bucket = file.endsWith("shape.ts")
            ? names.shape
            : file.endsWith("curve.ts")
              ? names.curve
              : names.surface;
        for (const stmt of sf.statements) {
            if (ts.isInterfaceDeclaration(stmt)) bucket.add(stmt.name.text);
        }
    }
    return names;
}

function makeQueryReturnClassifier(checker, ifaceNames) {
    const isJson = (type, depth) => {
        if (depth > 8) return false;
        const F = ts.TypeFlags;
        if (
            type.flags &
            (F.Number | F.String | F.Boolean | F.NumberLiteral | F.StringLiteral | F.BooleanLiteral)
        ) {
            return true;
        }
        const name = type.symbol?.getName();
        if (name && JSON_OK_CLASSES.has(name)) return true;
        if (type.isUnion()) {
            return type.types.every((t) => t.flags & F.Undefined || isJson(t, depth + 1));
        }
        if (type.isIntersection()) {
            return type.types.every((t) => isJson(t, depth + 1));
        }
        if (checker.isArrayType(type) || checker.isTupleType(type)) {
            return checker.getTypeArguments(type).every((t) => isJson(t, depth + 1));
        }
        if (type.flags & F.Object) {
            // Named classes/interfaces (Matrix4, EdgeMeshData, geometry objects, ...) are
            // only allowed via the whitelist above; anonymous object types walk members.
            const decls = type.symbol?.declarations ?? [];
            if (decls.some((d) => ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d))) return false;
            if (type.getCallSignatures().length || type.getConstructSignatures().length) return false;
            const props = type.getProperties();
            if (!props.length) return false;
            return props.every((p) => {
                const decl = p.valueDeclaration ?? p.declarations?.[0];
                if (decl && ts.isMethodSignature(decl)) return false;
                return isJson(checker.getTypeOfSymbol(p), depth + 1);
            });
        }
        return false;
    };

    const isShapeArray = (type) => {
        if (!checker.isArrayType(type)) return false;
        const [arg] = checker.getTypeArguments(type);
        const name = arg?.symbol?.getName();
        return name ? ifaceNames.shape.has(name) : false;
    };

    /** Returns { kind } or null. Result<T, E> is unwrapped (the engine handles it at runtime). */
    return (type) => {
        let t = type;
        if (t.isUnion()) {
            const parts = t.types.filter((x) => !(x.flags & ts.TypeFlags.Undefined));
            if (parts.length === 1) t = parts[0];
        }
        if (t.flags & ts.TypeFlags.Void) return { kind: "mutate" };
        let name = t.symbol?.getName() ?? t.aliasSymbol?.getName();
        if (name === "Result") {
            [t] = checker.getTypeArguments(t);
            if (!t) return null;
            name = t.symbol?.getName() ?? t.aliasSymbol?.getName();
        }
        if (name && ifaceNames.curve.has(name)) return { kind: "curveRef" };
        if (name && ifaceNames.surface.has(name)) return { kind: "surfaceRef" };
        if (name && ifaceNames.shape.has(name)) return { kind: "shapeRef" };
        if (isShapeArray(t)) return { kind: "refList" };
        if (isJson(t, 0)) return { kind: "data" };
        return null;
    };
}

function collectFactoryCapabilities(program, checker, skipped) {
    const sf = program.getSourceFile(factoryPath);
    const capabilities = [];
    for (const stmt of sf.statements) {
        if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== "IShapeFactory") continue;

        for (const member of stmt.members) {
            if (!ts.isMethodSignature(member)) continue;
            const method = member.name.getText(sf);

            const params = classifyParams(member, sf, checker, `${method}()`, skipped);
            if (!params) continue;

            const sig = checker.getSignatureFromDeclaration(member);
            const returnStr = checker.typeToString(checker.getReturnTypeOfSignature(sig));
            const returnKind = classifyReturn(returnStr);
            if (!returnKind) {
                skipped.push(`${method} -> ${returnStr}`);
                continue;
            }

            capabilities.push({ method, returnKind, params });
        }
    }
    return capabilities;
}

function classifyParams(member, sf, checker, context, skipped) {
    const params = [];
    for (const p of member.parameters ?? []) {
        const name = ts.isIdentifier(p.name)
            ? p.name.text
            : ts.isObjectBindingPattern(p.name)
              ? p.name.elements.map((e) => e.name.getText(sf)).join(",")
              : p.name.getText(sf);
        const typeStr = checker.typeToString(checker.getTypeAtLocation(p));
        const cls = classifyParam(typeStr);
        if (!cls) {
            skipped.push(`${context}(${name}: ${typeStr})`);
            return null;
        }
        params.push({ name, kind: cls.kind, enum: cls.enum, required: !p.questionToken });
    }
    return params;
}

function collectQueryCapabilities(program, checker, skipped) {
    const classifyQueryReturn = makeQueryReturnClassifier(checker, collectInterfaceNames(program));
    const capabilities = [];
    const seen = new Set();

    for (const { file, family, owners, runtimeTypes } of QUERY_SOURCES) {
        const sf = program.getSourceFile(resolve(root, file));
        for (const stmt of sf.statements) {
            if (!ts.isInterfaceDeclaration(stmt)) continue;
            const owner = owners[stmt.name.text];
            if (!owner) continue;

            for (const member of stmt.members) {
                const name =
                    ts.isMethodSignature(member) ||
                    ts.isPropertySignature(member) ||
                    ts.isGetAccessorDeclaration(member)
                        ? member.name.getText(sf)
                        : null;
                if (name === null) continue;
                const method = `${owner}.${name}`;
                if (seen.has(method)) continue;

                const cap = classifyQueryMember(
                    member,
                    sf,
                    checker,
                    { method, name, owner, family, runtimeType: runtimeTypes?.[owner] },
                    classifyQueryReturn,
                    skipped,
                );
                if (!cap) continue;
                seen.add(method);
                capabilities.push(cap);
            }
        }
    }
    return capabilities;
}

/** Classify one interface member into a query capability; returns null when unusable. */
function classifyQueryMember(member, sf, checker, base, classifyQueryReturn, skipped) {
    const params = classifyParams(member, sf, checker, base.method, skipped) ?? null;
    if (!params) return null;

    let type;
    let returnStr;
    if (ts.isMethodSignature(member)) {
        const sig = checker.getSignatureFromDeclaration(member);
        type = checker.getReturnTypeOfSignature(sig);
        returnStr = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
    } else {
        type = checker.getTypeAtLocation(member);
        returnStr = checker.typeToString(type);
    }
    const cls = classifyQueryReturn(type);
    if (!cls) {
        skipped.push(`${base.method} -> ${returnStr}`);
        return null;
    }

    return { ...base, returnKind: cls.kind, params, returnStr };
}

const kindLine = (p) => {
    const base = `{ name: ${JSON.stringify(p.name)}, kind: ${JSON.stringify(p.kind)}`;
    const extra = [];
    if (p.enum) extra.push(`enum: ${JSON.stringify(p.enum)}`);
    if (!p.required) extra.push("required: false");
    return extra.length ? `${base}, ${extra.join(", ")} }` : `${base} }`;
};

const paramList = (params) => params.map((p) => `${p.name}: ${p.kind}${p.required ? "" : "?"}`).join(", ");

function queryDocLine(c) {
    const returns =
        c.returnKind === "data"
            ? c.returnStr.length > 140
                ? "object (JSON)"
                : c.returnStr.replace(/\s+/g, " ")
            : c.returnKind === "refList"
              ? "{ count, refs } — also registers sub-shape refs <id>#0..n"
              : c.returnKind === "mutate"
                ? "null — mutates the target ref's geometry in place (re-applied on ref refresh)"
                : `${c.returnKind.replace("Ref", "")} ref (registered under the op id)`;
    return `${c.method}(target${c.params.length ? `, ${paramList(c.params)}` : ""}) -> ${returns}`;
}

function main() {
    const program = ts.createProgram([factoryPath, ...QUERY_SOURCES.map((s) => resolve(root, s.file))], {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        skipLibCheck: true,
    });
    const checker = program.getTypeChecker();

    const skipped = [];
    const capabilities = collectFactoryCapabilities(program, checker, skipped);
    const queries = collectQueryCapabilities(program, checker, skipped);

    writeFileSync(outPath, renderGenerated(capabilities, queries));
    formatGenerated();

    console.log(`generated ${capabilities.length} capabilities, ${queries.length} queries -> ${outPath}`);
    if (skipped.length) {
        console.log(`skipped ${skipped.length} (unusable for AI):`);
        skipped.forEach((s) => {
            console.log(`  - ${s}`);
        });
    }
}

/** Keep the generated file biome-clean so regeneration never produces format diffs. */
function formatGenerated() {
    const fmt = spawnSync("npx", ["biome", "format", "--write", outPath], { stdio: "inherit" });
    if (fmt.status !== 0) {
        console.warn("warning: biome format failed; the generated file may not match repo formatting");
    }
}

function renderQueryEntry(c) {
    const params = c.params.length ? `\n        ${c.params.map(kindLine).join(",\n        ")}\n    ` : "";
    const runtimeType = c.runtimeType ? ` runtimeType: ${JSON.stringify(c.runtimeType)},` : "";
    return `    { method: ${JSON.stringify(c.method)}, name: ${JSON.stringify(c.name)}, owner: ${JSON.stringify(
        c.owner,
    )}, family: ${JSON.stringify(c.family)}, returnKind: ${JSON.stringify(c.returnKind)},${runtimeType} params: [${params}] }`;
}

function buildDocSections(queries) {
    const owners = [...new Set(queries.map((q) => q.owner))];
    return owners.map((owner) => {
        const lines = queries.filter((q) => q.owner === owner).map((q) => `  ${queryDocLine(q)}`);
        const scope =
            queries.find((q) => q.owner === owner)?.family === "shape"
                ? `target must be a ${owner}`
                : `target must be a ${owner} (or a subtype of it)`;
        return `${owner}.* (${scope}):\n${lines.join("\n")}`;
    });
}

function renderGenerated(capabilities, queries) {
    const header = [
        "// Part of the Chili3d Project, under the AGPL-3.0 License.",
        "// See LICENSE file in the project root for full license information.",
        "",
        "// AUTO-GENERATED by scripts/generate-shape-capabilities.mjs — do not edit by hand.",
        "// Source of truth: packages/core/src/shape/{shapeFactory,shape,curve,surface}.ts.",
        "",
    ].join("\n");

    const sourceLines = capabilities.map((c) => `  ${c.method}(${paramList(c.params)}) -> ${c.returnKind}`);
    const docSections = buildDocSections(queries);
    const queryEntries = queries.map(renderQueryEntry).join(",\n");
    const ownerUnion = [...new Set(queries.map((q) => q.owner))].map((o) => JSON.stringify(o)).join(" | ");

    return header + renderBody(capabilities, queryEntries, ownerUnion, sourceLines, docSections);
}

function renderBody(capabilities, queryEntries, ownerUnion, sourceLines, docSections) {
    return `
export type ShapeParamKind =
    | "number" | "boolean" | "string" | "numberArray"
    | "xyz" | "xyzArray" | "plane" | "line"
    | "ref" | "refArray" | "curveRef" | "surfaceRef" | "refOrLine" | "refOrPlane" | "shapeType" | "enum";

export type ShapeReturnKind =
    | "solid" | "edge" | "wire" | "face" | "compound" | "shell" | "vertex" | "shape" | "shapeWithData";

export interface ShapeCapabilityParam {
    name: string;
    kind: ShapeParamKind;
    enum?: string[];
    required?: boolean;
}

export interface ShapeCapability {
    method: string;
    returnKind: ShapeReturnKind;
    params: ShapeCapabilityParam[];
}

export type QueryOwner = ${ownerUnion};

export type QueryFamily = "shape" | "curve" | "surface";

export type QueryReturnKind = "data" | "curveRef" | "surfaceRef" | "shapeRef" | "refList" | "mutate";

export interface QueryCapability {
    method: string;
    name: string;
    owner: QueryOwner;
    family: QueryFamily;
    returnKind: QueryReturnKind;
    /** Concrete curve owners are validated at runtime against the target's curveType. */
    runtimeType?: string;
    params: ShapeCapabilityParam[];
}

export const shapeCapabilities: ShapeCapability[] = [
${capabilities.map((c) => `    { method: ${JSON.stringify(c.method)}, returnKind: ${JSON.stringify(c.returnKind)}, params: [\n        ${c.params.map(kindLine).join(",\n        ")}\n    ] }`).join(",\n")}
];

export const queryCapabilities: QueryCapability[] = [
${queryEntries}
];

export const capabilitiesSource = \`Available modeling capabilities (from IShapeFactory; units: mm, angles: degrees):
${sourceLines.join("\n")}
JSON encoding: XYZ={x,y,z}; Plane={origin:{x,y,z}}; Line={point:{x,y,z},direction:{x,y,z}}; a shape/ref parameter takes an op id from any run_program call on this document or an existing node id; number[] is edge/face sub-shape indices; enum takes one of the listed values. Geometric params (plane/center/normal) may be omitted and default to the origin/Z axis. Params marked with ? are optional and may be omitted; the factory default applies. A method returning "shapeWithData" (removeFillet) creates its node from the result's shape; array extras (newEdges) come back in "results" under "<opId>.<key>" as { count, refs, kind: "shape" } with refs named <opId>#<key>#0..n.
Placement: box/rect/pyramid — plane.origin is a CORNER, the shape extends +dx/+dy/+dz from it. cylinder/cone — center is the BASE-FACE center, the shape extends +dz along normal. sphere — center is the true center. To center a box at P use origin = P - (dx/2,dy/2,dz/2); to center a cylinder/cone at P use center = P - normal*(dz/2).\`;

export const queryApiDoc = \`Shape query API (units: mm, angles: degrees). Run via run_program query ops:
{ "method": "<owner>.<name>", "target": "<ref>", "id": "q1", "args": { ... } }
- target: an op id, an existing node id, a sub-shape ref (q1#2), or a curve/surface ref.
- Refs persist across run_program calls on the same document and re-resolve against the live shape; a ref whose source node was deleted fails with a clear error — re-run the query that produced it.
- Every query op needs an "id"; its return value comes back in the response "results" under that id. Result encodings: data queries return the plain value; curve/surface-producing queries (edge.curve, face.surface, trimmedCurve.basisCurve, ...) return { ref, kind } where kind is "curve" or "surface" — pass ref as the target of follow-up queries, and only to members matching its kind; single-shape queries (wire.toFace, wire.offset, face.outerWire, edge.trim, ...) return { ref, kind: "shape" } — the ref works both as a query target and as a shape argument in creation ops; list queries (shape.findSubShapes, wire.edgeLoop) return { count, refs, kind: "shape" }; mutation queries (curve.reverse, trimmedCurve.setTrim, ...) return null and modify the target ref's geometry in place — the mutation is remembered and re-applied whenever the ref is re-resolved.
- Query ops never consume or delete the referenced node, and never create scene nodes.
- kind encodings: xyz={x,y,z}; plane/refOrPlane={origin:{x,y,z}} (an XY-oriented plane through that point) or, for refOrPlane, a shape ref string; line/refOrLine={point:{x,y,z},direction:{x,y,z}} or a ref string; matrix={array:[16 numbers, column-major]}; shapeType one of solid|shell|face|wire|edge|vertex|compound|compoundSolid; ref/curveRef/surfaceRef take a ref string.
- Type hierarchy: circle/ellipse/hyperbola/parabola are conic; conic/line/bezierCurve/bsplineCurve/trimmedCurve/offsetCurve are curve — curve.* and conic.* members apply to those targets too. Surfaces likewise: cylindricalSurface/planeSurface/sphericalSurface/... are elementarySurface, and every *Surface is a surface. Use curve.curveType to check what a curve ref actually is.
- edge.curve ALWAYS yields a trimmedCurve (it carries the edge's parameter range), even for a straight or circular edge. Chain trimmedCurve.basisCurve to reach the underlying line/circle/bezier/... before using type-specific members like circle.radius or line.direction.
- curve/surface refs come from edge.curve and face.surface; sub-shape refs from shape.findSubShapes / wire.edgeLoop. A face's SURFACE (face.surface → plane/cylinder/...) is NOT its boundary curve: to inspect the edges bounding a face (e.g. the circular rim of a cylinder's top face), run shape.findSubShapes with subshapeType=edge on the face or solid, then edge.curve on the edge refs.

${docSections.join("\n\n")}

Examples:
- Measure a solid: { "method": "shape.volume", "target": "<nodeId>", "id": "v" } -> results.v = 12000
- Face area of a box face: { "method": "shape.findSubShapes", "target": "b", "id": "f", "args": { "subshapeType": "face" } } then { "method": "face.area", "target": "f#0", "id": "a" }
- Face from a wire loop: { "method": "wire.toFace", "target": "<wireRef>", "id": "f" } -> results.f = { ref: "f", kind: "shape" }, then e.g. { "method": "face.area", "target": "f", "id": "a" }
- Curve of a solid's edge (full chain): { "method": "shape.findSubShapes", "target": "<solidId>", "id": "e", "args": { "subshapeType": "edge" } }, then { "method": "edge.curve", "target": "e#0", "id": "tc" } (always a trimmedCurve), then { "method": "trimmedCurve.basisCurve", "target": "tc", "id": "c" }, then { "method": "curve.curveType", "target": "c", "id": "t" } — and when t is "circle", { "method": "circle.radius", "target": "c", "id": "r" }.
- Surface bounds: { "method": "face.surface", "target": "f#0", "id": "s" } then { "method": "surface.bounds", "target": "s", "id": "uv" }\`;
`;
}

main();
