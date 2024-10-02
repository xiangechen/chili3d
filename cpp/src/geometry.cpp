#include "shared.hpp"
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_Surface.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <GeomLib_Tool.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Handle.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <optional>
#include <GeomProjLib.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomLib_IsPlanarSurface.hxx>
#include <optional>
#include <GeomAPI_ExtremaCurveCurve.hxx>
#include <GCPnts_UniformAbscissa.hxx>
#include <GCPnts_AbscissaPoint.hxx>

using namespace emscripten;

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


class Curve {
private:
    static Vector3Array getPoints(const GCPnts_UniformAbscissa& uniformAbscissa, const Geom_Curve* curve) {
        std::vector<Vector3> points;
        for (int i = 1; i <= uniformAbscissa.NbPoints(); i++) {
            points.push_back(Vector3::fromPnt(curve->Value(uniformAbscissa.Parameter(i))));
        }
        return Vector3Array(val::array(points));
    }

public:
    static Handle_Geom_Line makeLine(const Vector3& start, const Vector3& dir) {
        Handle_Geom_Line line = new Geom_Line(Vector3::toPnt(start), Vector3::toDir(dir));
        return line;
    }

    static Handle_Geom_TrimmedCurve trim(const Geom_Curve* curve, double start, double end) {
        Handle_Geom_TrimmedCurve trimmedCurve = new Geom_TrimmedCurve(curve, start, end);
        return trimmedCurve;
    }

    static Vector3Array projects(const Geom_Curve* curve, const Vector3& point) {
        GeomAPI_ProjectPointOnCurve projector(Vector3::toPnt(point), curve);
        std::vector<Vector3> points;
        for (int i = 1; i <= projector.NbPoints(); i++) {
            points.push_back(Vector3::fromPnt(projector.Point(i)));
        }
        
        return Vector3Array(val::array(points));
    }

    static std::optional<ExtremaCCResult> nearestExtremaCC(const Geom_Curve* curve1, const Geom_Curve* curve2) {
        GeomAPI_ExtremaCurveCurve extrema(curve1, curve2);
        if (extrema.NbExtrema() == 0) {
            return std::nullopt;
        }

        gp_Pnt p1, p2;
        extrema.NearestPoints(p1, p2);
        double u1, u2;
        extrema.LowerDistanceParameters(u1, u2);
        return ExtremaCCResult {
            .isParallel = extrema.IsParallel(),
            .distance = extrema.LowerDistance(),
            .p1 = Vector3::fromPnt(p1),
            .p2 = Vector3::fromPnt(p2),
            .u1 = u1,
            .u2 = u2
        };
    }

    static Vector3Array uniformAbscissaWithLength(const Geom_Curve* curve, double length) {
        GeomAdaptor_Curve adaptorCurve(curve);
        GCPnts_UniformAbscissa uniformAbscissa(adaptorCurve, length);
        return getPoints(uniformAbscissa, curve);
    }

    static Vector3Array uniformAbscissaWithCount(const Geom_Curve* curve, int nbPoints) {
        GeomAdaptor_Curve adaptorCurve(curve);
        GCPnts_UniformAbscissa uniformAbscissa(adaptorCurve, nbPoints);
        return getPoints(uniformAbscissa, curve);
    }

    static ProjectPointResult projectOrNearest(const Geom_Curve* curve, const Vector3& point) {
        gp_Pnt pnt = Vector3::toPnt(point);
        GeomAPI_ProjectPointOnCurve projector(pnt, curve);
        if (projector.NbPoints() > 0) {
            return ProjectPointResult {
                .point = Vector3::fromPnt(projector.NearestPoint()),
                .distance = projector.LowerDistance(),
                .parameter = projector.LowerDistanceParameter()
            };
        }

        gp_Pnt start = curve->Value(curve->FirstParameter());
        gp_Pnt end = curve->Value(curve->LastParameter());
        double distanceToStart = pnt.Distance(start);
        double distanceToEnd = pnt.Distance(end);
        if (distanceToStart < distanceToEnd) {
            return ProjectPointResult {
                .point = Vector3::fromPnt(start),
                .distance = distanceToStart,
                .parameter = curve->FirstParameter()
            };
        } else {
            return ProjectPointResult {
                .point = Vector3::fromPnt(end),
                .distance = distanceToEnd,
                .parameter = curve->LastParameter()
            };
        }
    }

    static std::optional<double> parameter(const Geom_Curve* curve, const Vector3& point, double maxDistance) {
        double parameter = 0;
        gp_Pnt pnt = Vector3::toPnt(point);
        if (GeomLib_Tool::Parameter(curve, pnt, maxDistance, parameter)) {
            return parameter;
        }
        return std::nullopt;
    }

    static double curveLength(const Geom_Curve* curve) {
        GeomAdaptor_Curve adaptorCurve(curve);
        return GCPnts_AbscissaPoint::Length(adaptorCurve);
    }

};

struct SurfaceBounds {
    double u1;
    double u2;
    double v1;
    double v2;
};

class Surface {
public:
    static Handle_Geom_Curve projectCurve(const Geom_Surface* surface, const Geom_Curve* curve) {
        return GeomProjLib::Project(curve, surface);
    }

    static Vector3Array projectPoint(const Geom_Surface* surface, const Vector3& point) {
        gp_Pnt pnt = Vector3::toPnt(point);
        GeomAPI_ProjectPointOnSurf projector(pnt, surface);
        std::vector<gp_Pnt> points;
        for (size_t i = 0; i < projector.NbPoints(); i++)
        {
            points.push_back(projector.Point(i + 1));
        }
        
        return Vector3Array(val::array(points.begin(), points.end()));
    }

    static bool isPlanar(const Geom_Surface* surface) {
        GeomLib_IsPlanarSurface isPlanarSurface(surface);
        return isPlanarSurface.IsPlanar();
    }

    static std::optional<UV> parameters(const Geom_Surface* surface, const Vector3& point, double maxDistance) {
        double u(0), v(0);
        gp_Pnt pnt = Vector3::toPnt(point);
        if (GeomLib_Tool::Parameters(surface, pnt, maxDistance, u, v)) {
            return UV {
                .u = u,
                .v = v
            };
        }
        return std::nullopt;
    }

    static std::optional<PointAndParameter> nearestPoint(const Geom_Surface* surface, const Vector3& point) {
        gp_Pnt pnt = Vector3::toPnt(point);
        GeomAPI_ProjectPointOnSurf projector(pnt, surface);
        if (projector.IsDone()) {
            return PointAndParameter {
                .point = Vector3::fromPnt(projector.NearestPoint()),
                .parameter = projector.LowerDistance()
            };
        }
        return std::nullopt;
    }

    static SurfaceBounds bounds(const Geom_Surface* surface) {
        double u1, u2, v1, v2;
        surface->Bounds(u1, u2, v1, v2);
        return SurfaceBounds {
            .u1 = u1,
            .u2 = u2,
            .v1 = v1,
            .v2 = v2
        };
    }

};

EMSCRIPTEN_BINDINGS(Geometry) {
    register_optional<ExtremaCCResult>();

    value_object<ProjectPointResult>("ProjectPointResult")
        .field("point", &ProjectPointResult::point)
        .field("distance", &ProjectPointResult::distance)
        .field("parameter", &ProjectPointResult::parameter)
    ;

    value_object<ExtremaCCResult>("ExtremaCCResult")
        .field("distance", &ExtremaCCResult::distance)
        .field("p1", &ExtremaCCResult::p1)
        .field("p2", &ExtremaCCResult::p2)
        .field("isParallel", &ExtremaCCResult::isParallel)
        .field("u1", &ExtremaCCResult::u1)
        .field("u2", &ExtremaCCResult::u2)
    ;

    class_<Curve>("Curve")
        .class_function("makeLine", &Curve::makeLine)
        .class_function("trim", &Curve::trim, allow_raw_pointers())
        .class_function("projectOrNearest", &Curve::projectOrNearest, allow_raw_pointers())
        .class_function("uniformAbscissaWithCount", &Curve::uniformAbscissaWithCount, allow_raw_pointers())
        .class_function("uniformAbscissaWithLength", &Curve::uniformAbscissaWithLength, allow_raw_pointers())
        .class_function("nearestExtremaCC", &Curve::nearestExtremaCC, allow_raw_pointers())
        .class_function("parameter", &Curve::parameter, allow_raw_pointers())
        .class_function("curveLength", &Curve::curveLength, allow_raw_pointers())
        .class_function("projects", &Curve::projects, allow_raw_pointers())
    ;

    value_object<SurfaceBounds>("SurfaceBounds")
        .field("u1", &SurfaceBounds::u1)
        .field("u2", &SurfaceBounds::u2)
        .field("v1", &SurfaceBounds::v1)
        .field("v2", &SurfaceBounds::v2)
    ;

    class_<Surface>("Surface")
        .class_function("projectCurve", &Surface::projectCurve, allow_raw_pointers())
        .class_function("projectPoint", &Surface::projectPoint, allow_raw_pointers())
        .class_function("isPlanar", &Surface::isPlanar, allow_raw_pointers())
        .class_function("parameters", &Surface::parameters, allow_raw_pointers())
        .class_function("nearestPoint", &Surface::nearestPoint, allow_raw_pointers())
        .class_function("bounds", &Surface::bounds, allow_raw_pointers())
    ;

}