// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include "shared.hpp"

#include <TopoDS_Shape.hxx>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(Shared)
{
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

    register_type<Vector3Array>("Array<Vector3>");
    register_type<PointAndParameterArray>("Array<PointAndParameter>");

    register_type<NumberArray>("Array<number>");
    register_type<ShapeArray>("Array<TopoDS_Shape>");
    register_type<EdgeArray>("Array<TopoDS_Edge>");
    register_type<FaceArray>("Array<TopoDS_Face>");
    register_type<WireArray>("Array<TopoDS_Wire>");
    register_type<ShellArray>("Array<TopoDS_Shell>");
    register_type<PntArray>("Array<gp_Pnt>");

    register_optional<double>();
    register_optional<UV>();
    register_optional<PointAndParameter>();
    register_optional<ProjectPointResult>();
    register_optional<std::string>();

    value_object<Domain>("Domain")
        .field("start", &Domain::start)
        .field("end", &Domain::end);
    ;

    value_object<UV>("UV").field("u", &UV::u).field("v", &UV::v);
    ;

    value_object<Vector3>("Vector3")
        .field("x", &Vector3::x)
        .field("y", &Vector3::y)
        .field("z", &Vector3::z);

    value_object<PointAndParameter>("PointAndParameter")
        .field("point", &PointAndParameter::point)
        .field("parameter", &PointAndParameter::parameter);

    value_object<Ax1>("Ax1")
        .field("location", &Ax1::location)
        .field("direction", &Ax1::direction);

    value_object<Ax2>("Ax2")
        .field("location", &Ax2::location)
        .field("direction", &Ax2::direction)
        .field("xDirection", &Ax2::xDirection);

    value_object<Ax3>("Ax3")
        .field("location", &Ax3::location)
        .field("direction", &Ax3::direction)
        .field("xDirection", &Ax3::xDirection);

    value_object<Pln>("Pln")
        .field("location", &Pln::location)
        .field("direction", &Pln::direction)
        .field("xDirection", &Pln::xDirection);

    register_optional<ExtremaCCResult>();

    value_object<ProjectPointResult>("ProjectPointResult")
        .field("point", &ProjectPointResult::point)
        .field("distance", &ProjectPointResult::distance)
        .field("parameter", &ProjectPointResult::parameter);

    value_object<ExtremaCCResult>("ExtremaCCResult")
        .field("distance", &ExtremaCCResult::distance)
        .field("p1", &ExtremaCCResult::p1)
        .field("p2", &ExtremaCCResult::p2)
        .field("isParallel", &ExtremaCCResult::isParallel)
        .field("u1", &ExtremaCCResult::u1)
        .field("u2", &ExtremaCCResult::u2);
}