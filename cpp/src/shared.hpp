// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#pragma once

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#define STR(x) #x
#define REGISTER_HANDLE(T)                                       \
    class_<Handle_##T>(STR(Handle_##T))                          \
        .constructor<const T*>()                                 \
        .function("get", &Handle_##T::get, allow_raw_pointers()) \
        .function("isNull", &Handle_##T::IsNull)

class Math {
public:
    constexpr static const double PI = 3.14159265358979323846;
    constexpr static const double PI_2 = PI * 2;
    constexpr static const double PI_h = PI / 2;
};

struct Domain {
    double start;
    double end;
};

struct UV {
    double u;
    double v;
};

struct Vector3 {
    double x;
    double y;
    double z;

    static gp_XYZ toXYZ(const Vector3& p) { return gp_XYZ(p.x, p.y, p.z); }

    static gp_Pnt toPnt(const Vector3& p) { return gp_Pnt(p.x, p.y, p.z); }

    static Vector3 fromPnt(const gp_Pnt& p)
    {
        return Vector3 { p.X(), p.Y(), p.Z() };
    }

    static gp_Dir toDir(const Vector3& p) { return gp_Dir(p.x, p.y, p.z); }

    static Vector3 fromDir(const gp_Dir& p)
    {
        return Vector3 { p.X(), p.Y(), p.Z() };
    }

    static gp_Vec toVec(const Vector3& p) { return gp_Vec(p.x, p.y, p.z); }

    static Vector3 fromVec(const gp_Vec& p)
    {
        return Vector3 { p.X(), p.Y(), p.Z() };
    }
};

struct PointAndParameter {
    Vector3 point;
    double parameter;
};

struct Ax1 {
    Vector3 location;
    Vector3 direction;

    static gp_Ax1 toAx1(const Ax1& a)
    {
        return gp_Ax1(Vector3::toPnt(a.location), Vector3::toDir(a.direction));
    }

    static Ax1 fromAx1(const gp_Ax1& a)
    {
        return Ax1 { Vector3::fromPnt(a.Location()), Vector3::fromDir(a.Direction()) };
    }
};

struct Ax2 {
    Vector3 location;
    Vector3 direction;
    Vector3 xDirection;

    static gp_Ax2 toAx2(const Ax2& a)
    {
        return gp_Ax2(Vector3::toPnt(a.location), Vector3::toDir(a.direction),
            Vector3::toDir(a.xDirection));
    }

    static Ax2 fromAx2(const gp_Ax2& a)
    {
        return Ax2 { Vector3::fromPnt(a.Location()), Vector3::fromDir(a.Direction()),
            Vector3::fromDir(a.XDirection()) };
    }
};

struct Ax3 {
    Vector3 location;
    Vector3 direction;
    Vector3 xDirection;

    static gp_Ax2 toAx2(const Ax3& a)
    {
        return gp_Ax2(Vector3::toPnt(a.location), Vector3::toDir(a.direction),
            Vector3::toDir(a.xDirection));
    }

    static Ax3 fromAx2(const gp_Ax2& a)
    {
        return Ax3 { Vector3::fromPnt(a.Location()), Vector3::fromDir(a.Direction()),
            Vector3::fromDir(a.XDirection()) };
    }

    static gp_Ax3 toAx3(const Ax3& a)
    {
        return gp_Ax3(Vector3::toPnt(a.location), Vector3::toDir(a.direction),
            Vector3::toDir(a.xDirection));
    }

    static Ax3 fromAx3(const gp_Ax3& a)
    {
        return Ax3 { Vector3::fromPnt(a.Location()), Vector3::fromDir(a.Direction()),
            Vector3::fromDir(a.XDirection()) };
    }

    static gp_Pln toPln(const Ax3& a) { return gp_Pln(toAx3(a)); }
};

struct Pln {
    Vector3 location;
    Vector3 direction;
    Vector3 xDirection;

    static gp_Pln toPln(const Pln& a) { return gp_Pln(toAx3(a)); }

    static gp_Ax3 toAx3(const Pln& a)
    {
        return gp_Ax3(Vector3::toPnt(a.location), Vector3::toDir(a.direction),
            Vector3::toDir(a.xDirection));
    }

    static Pln fromAx3(const gp_Ax3& a)
    {
        return Pln { Vector3::fromPnt(a.Location()), Vector3::fromDir(a.Direction()),
            Vector3::fromDir(a.XDirection()) };
    }

    static Pln fromPln(const gp_Pln& a)
    {
        return Pln { Vector3::fromPnt(a.Location()),
            Vector3::fromDir(a.Axis().Direction()),
            Vector3::fromDir(a.XAxis().Direction()) };
    }
};

struct ProjectPointResult {
    Vector3 point;
    double distance;
    double parameter;
};

struct ExtremaCCResult {
    bool isParallel;
    double distance;
    Vector3 p1;
    Vector3 p2;
    double u1;
    double u2;
};

EMSCRIPTEN_DECLARE_VAL_TYPE(Int8Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Int16Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Int32Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint8Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint16Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint32Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Float32Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(Float64Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(BigInt64Array)
EMSCRIPTEN_DECLARE_VAL_TYPE(BigUint64Array)

EMSCRIPTEN_DECLARE_VAL_TYPE(Vector3Array)

EMSCRIPTEN_DECLARE_VAL_TYPE(NumberArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(EdgeArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(WireArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(FaceArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(ShellArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(ShapeArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(PointAndParameterArray)
EMSCRIPTEN_DECLARE_VAL_TYPE(PntArray)
