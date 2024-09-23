#include "shared.hpp"
#include <TopoDS_Shape.hxx>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(Shared) {
    register_type<Int8Array>("Int8Array");
    register_type<Int16Array>("Int16Array");
    register_type<Int32Array>("Int32Array");
    register_type<Uint8Array>("Uint8Array");
    register_type<Uint16Array>("Uint16Array");
    register_type<Uint32Array>("Uint32Array");
    register_type<Float32Array>("Float32Array");
    register_type<Float64Array>("Float64Array");
    register_type<BigInt64Array>("BigInt64Array");
    register_type<BigUint64Array>("BigUint64Array");

    register_type<NumberArray>("Array<number>");
    register_type<ShapeArray>("Array<TopoDS_Shape>");
    register_type<EdgeArray>("Array<TopoDS_Edge>");
    register_type<FaceArray>("Array<TopoDS_Face>");
    register_type<WireArray>("Array<TopoDS_Wire>");
    register_type<PntArray>("Array<gp_Pnt>");
    
    value_object<Domain>("Domain");

}