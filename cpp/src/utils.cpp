// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#include "utils.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepTools.hxx>
#include <Bnd_Box.hxx>
#include <Extrema_ExtPS.hxx>
#include <GeomAPI_ExtremaCurveCurve.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>

std::vector<ExtremaCCResult> extremaCCs(const Geom_Curve* curve1, const Geom_Curve* curve2, double maxDistance)
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

std::optional<ProjectPointResult> projectToCurve(const Geom_Curve* curve, gp_Pnt pnt)
{
    GeomAPI_ProjectPointOnCurve projector(pnt, curve);
    if (projector.NbPoints() > 0) {
        return ProjectPointResult { .point = Vector3::fromPnt(projector.NearestPoint()),
            .distance = projector.LowerDistance(),
            .parameter = projector.LowerDistanceParameter() };
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
        return ProjectPointResult {
            .point = Vector3::fromPnt(start), .distance = distanceToStart, .parameter = curve->FirstParameter()
        };
    } else {
        return ProjectPointResult {
            .point = Vector3::fromPnt(end), .distance = distanceToEnd, .parameter = curve->LastParameter()
        };
    }
}

ProjectPointResult projectOrNearestCP(const Geom_Curve* curve, const gp_Pnt& pnt)
{
    auto project = projectToCurve(curve, pnt);
    if (project.has_value()) {
        return project.value();
    }

    return nearestEnd(curve, pnt);
}

double boundingBoxRatio(const TopoDS_Shape& shape, double linearDeflection, bool useTriangulation)
{
    Bnd_Box boundingBox;
    BRepBndLib::Add(shape, boundingBox, useTriangulation);
    if (boundingBox.IsVoid()) {
        return linearDeflection;
    }
    double xMin, yMin, zMin, xMax, yMax, zMax;
    boundingBox.Get(xMin, yMin, zMin, xMax, yMax, zMax);

    double avgSize = ((xMax - xMin) + (yMax - yMin) + (zMax - zMin)) / 3.0;
    double linDeflection = avgSize * linearDeflection;
    if (linDeflection < Precision::Confusion()) {
        linDeflection = 1.0;
    }
    return linDeflection;
}

NCollection_Sequence<TopoDS_Shape> shapeArrayToSequenceOfShape(const ShapeArray& shapes)
{
    std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(shapes);
    NCollection_Sequence<TopoDS_Shape> result;
    for (auto& s : shapeVector) {
        result.Append(s);
    }
    return result;
}

NCollection_List<TopoDS_Shape> shapeArrayToListOfShape(const ShapeArray& shapes)
{
    std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(shapes);
    NCollection_List<TopoDS_Shape> result;
    for (auto& s : shapeVector) {
        result.Append(s);
    }
    return result;
}

NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> shapeArrayToMapOfShape(const ShapeArray& shapes)
{
    std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(shapes);
    NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> result;
    for (auto& s : shapeVector) {
        result.Add(s);
    }
    return result;
}

std::optional<gp_Pnt2d> pointToFaceUV(const TopoDS_Face& face, gp_Pnt pnt, double tolerance)
{
    gp_Pnt2d aPuv;
    double aU1, aU2, aV1, aV2;
    Extrema_ExtPS aExtrema;
    BRepAdaptor_Surface aSurf(face, false);
    BRepTools::UVBounds(face, aU1, aU2, aV1, aV2);
    aExtrema.Initialize(aSurf, aU1, aU2, aV1, aV2, tolerance, tolerance);
    aExtrema.Perform(pnt);
    if (!aExtrema.IsDone()) {
        return std::nullopt;
    }
    int aNbExt = aExtrema.NbExt();
    if (!aNbExt) {
        return std::nullopt;
    }
    double aMaxDist = RealLast(), aD;
    int aIndice, i;
    for (i = 1; i <= aNbExt; ++i) {
        aD = aExtrema.SquareDistance(i);
        if (aD < aMaxDist) {
            aMaxDist = aD;
            aIndice = i;
        }
    }
    if (aIndice && aMaxDist <= tolerance) {
        aExtrema.Point(aIndice).Parameter(aU1, aU2);
        aPuv.SetCoord(aU1, aU2);
        return aPuv;
    }
    return std::nullopt;
}