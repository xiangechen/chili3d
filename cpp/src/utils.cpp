// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include "utils.hpp"

#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <GeomAPI_ExtremaCurveCurve.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>

std::vector<ExtremaCCResult> extremaCCs(const Geom_Curve* curve1,
    const Geom_Curve* curve2,
    double maxDistance)
{
    std::vector<ExtremaCCResult> result;
    GeomAPI_ExtremaCurveCurve extrema(curve1, curve2);
    if (extrema.NbExtrema() == 0) {
        return result;
    }

    gp_Pnt p1, p2;
    double u1 = 0, u2 = 0;
    for (int i = 1; i <= extrema.NbExtrema(); i++) {
        double distance = extrema.Distance(i);
        if (distance > maxDistance) {
            continue;
        }
        extrema.Points(i, p1, p2);
        extrema.Parameters(i, u1, u2);
        result.push_back(ExtremaCCResult { .isParallel = extrema.IsParallel(),
            .distance = distance,
            .p1 = Vector3::fromPnt(p1),
            .p2 = Vector3::fromPnt(p2),
            .u1 = u1,
            .u2 = u2 });
    }

    return result;
}

std::optional<ProjectPointResult> projectToCurve(const Geom_Curve* curve,
    gp_Pnt pnt)
{
    GeomAPI_ProjectPointOnCurve projector(pnt, curve);
    if (projector.NbPoints() > 0) {
        return ProjectPointResult {
            .point = Vector3::fromPnt(projector.NearestPoint()),
            .distance = projector.LowerDistance(),
            .parameter = projector.LowerDistanceParameter()
        };
    }

    return std::nullopt;
}

ProjectPointResult nearestEnd(const Geom_Curve* curve, gp_Pnt pnt)
{
    gp_Pnt start = curve->Value(curve->FirstParameter());
    gp_Pnt end = curve->Value(curve->LastParameter());
    double distanceToStart = pnt.Distance(start);
    double distanceToEnd = pnt.Distance(end);
    if (distanceToStart < distanceToEnd) {
        return ProjectPointResult { .point = Vector3::fromPnt(start),
            .distance = distanceToStart,
            .parameter = curve->FirstParameter() };
    } else {
        return ProjectPointResult { .point = Vector3::fromPnt(end),
            .distance = distanceToEnd,
            .parameter = curve->LastParameter() };
    }
}

ProjectPointResult projectOrNearestCP(const Geom_Curve* curve,
    const gp_Pnt& pnt)
{
    auto project = projectToCurve(curve, pnt);
    if (project.has_value()) {
        return project.value();
    }

    return nearestEnd(curve, pnt);
}

double boundingBoxRatio(const TopoDS_Shape& shape, double linearDeflection)
{
    Bnd_Box boundingBox;
    BRepBndLib::Add(shape, boundingBox, false);
    if (boundingBox.IsVoid()) {
        return linearDeflection;
    }
    Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
    boundingBox.Get(xMin, yMin, zMin, xMax, yMax, zMax);

    Standard_Real avgSize = ((xMax - xMin) + (yMax - yMin) + (zMax - zMin)) / 3.0;
    double linDeflection = avgSize * linearDeflection;
    if (linDeflection < Precision::Confusion()) {
        linDeflection = 1.0;
    }
    return linDeflection;
}