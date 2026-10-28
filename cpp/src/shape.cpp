// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepExtrema_ExtCC.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepPrim_Builder.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_OBB.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_JoinType.hxx>
#include <GeomConvert.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <IntCurvesFace_Intersector.hxx>
#include <ShapeAnalysis.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "shared.hpp"
#include "utils.hpp"
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Wire.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <ShapeFix_ShapeTolerance.hxx>
#include <ShapeUpgrade_ShellSewing.hxx>

using namespace emscripten;

class Shape {
public:
    static size_t ptr(const TopoDS_Shape& shape)
    {
        return size_t(shape.TShape().get());
    }

    static BoundingBox boundingBox(const TopoDS_Shape& shape, bool useTriangulation)
    {
        Bnd_Box obx;
        BRepBndLib::Add(shape, obx, useTriangulation);
        // A shape without geometry (e.g. an empty compound) leaves a void box, whose corners raise.
        if (obx.IsVoid()) {
            return BoundingBox { Vector3 { 0.0, 0.0, 0.0 }, Vector3 { 0.0, 0.0, 0.0 } };
        }

        return BoundingBox {
            Vector3::fromPnt(obx.CornerMin()),
            Vector3::fromPnt(obx.CornerMax())
        };
    }

    static OrientedBoundingBox orientedBoundingBox(const TopoDS_Shape& shape, bool useTriangulation)
    {
        Bnd_OBB obb;
        BRepBndLib::AddOBB(shape, obb, useTriangulation);
        // A shape without geometry leaves a void OBB with undefined axes.
        if (obb.IsVoid()) {
            return OrientedBoundingBox { Ax3::fromAx3(gp_Ax3()), Vector3 { 0.0, 0.0, 0.0 } };
        }

        return OrientedBoundingBox {
            Ax3::fromAx3(obb.Position()),
            Vector3 { obb.XHSize(), obb.YHSize(), obb.ZHSize() }
        };
    }

    static TopoDS_Shape clone(const TopoDS_Shape& shape)
    {
        BRepBuilderAPI_Copy copy(shape);
        return copy.Shape();
    }

    static TopoDS_Shape transformed(const TopoDS_Shape& shape, const gp_Trsf& trsf)
    {
        BRepBuilderAPI_Transform transform(trsf);
        transform.Perform(shape, true);
        return transform.Shape();
    }

    /**
     * General affine transform — what `transformed` cannot do. `gp_Trsf` is a similarity
     * transform (rotation, uniform scale, mirror, translation), so a body carrying a
     * non-uniform scale is silently misplaced by it. `gp_GTrsf` takes any invertible affine
     * matrix and `BRepBuilderAPI_GTransform` rebuilds the geometry through it (a circle
     * becomes an ellipse), which is what a general placement needs.
     *
     * The twelve values are the affine matrix row by row: (a11, a12, a13, a14) is the first
     * row, translation in the fourth column.
     */
    static TopoDS_Shape transformedGeneral(const TopoDS_Shape& shape, double a11, double a12, double a13,
        double a14, double a21, double a22, double a23, double a24, double a31, double a32, double a33,
        double a34)
    {
        if (shape.IsNull()) {
            return TopoDS_Shape();
        }
        // A singular matrix has no image to build, and GTransform raises on it — with exception
        // catching disabled that would abort the module, so it is checked up front. The test is
        // exact: a uniformly small scale is invertible and must still be transformed, so no
        // absolute epsilon can stand in for "no inverse".
        gp_Mat matrix(a11, a12, a13, a21, a22, a23, a31, a32, a33);
        if (matrix.Determinant() == 0.0) {
            return TopoDS_Shape();
        }
        BRepBuilderAPI_GTransform transform(shape, gp_GTrsf(matrix, gp_XYZ(a14, a24, a34)), true);
        if (!transform.IsDone()) {
            return TopoDS_Shape();
        }
        return transform.Shape();
    }

    static void clean(TopoDS_Shape& shape)
    {
        BRepTools::Clean(shape, true);
    }

    static bool isClosed(const TopoDS_Shape& shape)
    {
        return BRep_Tool::IsClosed(shape);
    }

    static ShapeArray findAncestor(const TopoDS_Shape& from, const TopoDS_Shape& subShape,
        const TopAbs_ShapeEnum& ancestorType)
    {
        NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> map;
        TopExp::MapShapesAndAncestors(from, subShape.ShapeType(), ancestorType, map);
        auto index = map.FindIndex(subShape);
        if (index < 1) {
            return ShapeArray(val::array());
        }
        auto shapes = map.FindFromIndex(index);

        return ShapeArray(val::array(shapes.begin(), shapes.end()));
    }

    static ShapeArray findSubShapes(const TopoDS_Shape& shape, const TopAbs_ShapeEnum& shapeType)
    {
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> indexShape;
        TopExp::MapShapes(shape, shapeType, indexShape);

        return ShapeArray(val::array(indexShape.cbegin(), indexShape.cend()));
    }

    static ShapeArray getDirectSubShapes(const TopoDS_Shape& shape)
    {
        val subShapes = val::array();
        for (TopoDS_Iterator iter(shape); iter.More(); iter.Next()) {
            subShapes.call<void>("push", iter.Value());
        }
        return ShapeArray(subShapes);
    }

    static TopoDS_Shape sectionSS(const TopoDS_Shape& shape, const TopoDS_Shape& otherShape)
    {
        BRepAlgoAPI_Section section(shape, otherShape);
        return section.Shape();
    }

    static TopoDS_Shape sectionSP(const TopoDS_Shape& shape, const Pln& ax3)
    {
        gp_Pln pln = Pln::toPln(ax3);
        BRepAlgoAPI_Section section(shape, pln);
        return section.Shape();
    }

    static TopoDS_Shape splitShapes(const ShapeArray& arguments, const ShapeArray& tools, double tolerance)
    {
        NCollection_List<TopoDS_Shape> argumentsList = shapeArrayToListOfShape(arguments);
        NCollection_List<TopoDS_Shape> toolsList = shapeArrayToListOfShape(tools);
        BRepAlgoAPI_Splitter splitter;
        splitter.SetFuzzyValue(tolerance);
        splitter.SetToFillHistory(false);
        splitter.SetArguments(argumentsList);
        splitter.SetTools(toolsList);
        splitter.SimplifyResult();
        splitter.Build();

        return splitter.Shape();
    }

    static double extremaDistance(const TopoDS_Shape& shape, const TopoDS_Shape& otherShape)
    {
        BRepExtrema_DistShapeShape extrema(shape, otherShape);
        // No solution (e.g. a shape without geometry): Value() raises StdFail_NotDone.
        if (!extrema.IsDone()) {
            return -1.0;
        }
        return extrema.Value();
    }

    static size_t countShape(const TopoDS_Shape& shape, TopAbs_ShapeEnum shapeType)
    {
        size_t size = 0;
        TopExp_Explorer explorer;
        for (explorer.Init(shape, shapeType); explorer.More(); explorer.Next()) {
            size += 1;
        }
        return size;
    }

    static TopoDS_Shape shellSewing(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeUpgrade_ShellSewing sewing;
        return sewing.ApplySewing(shape, tolerance);
    }

    static bool check(const TopoDS_Shape& shape)
    {
        BRepCheck_Analyzer analyzer(shape);
        return analyzer.IsValid();
    }

    static const char* checkStatusName(BRepCheck_Status status)
    {
        switch (status) {
        case BRepCheck_NoError:
            return "No Error";
        case BRepCheck_InvalidPointOnCurve:
            return "Invalid Point On Curve";
        case BRepCheck_InvalidPointOnCurveOnSurface:
            return "Invalid Point On Curve On Surface";
        case BRepCheck_InvalidPointOnSurface:
            return "Invalid Point On Surface";
        case BRepCheck_No3DCurve:
            return "No 3D Curve";
        case BRepCheck_Multiple3DCurve:
            return "Multiple 3D Curve";
        case BRepCheck_Invalid3DCurve:
            return "Invalid 3D Curve";
        case BRepCheck_NoCurveOnSurface:
            return "No Curve On Surface";
        case BRepCheck_InvalidCurveOnSurface:
            return "Invalid Curve On Surface";
        case BRepCheck_InvalidCurveOnClosedSurface:
            return "Invalid Curve On Closed Surface";
        case BRepCheck_InvalidSameRangeFlag:
            return "Invalid Same Range Flag";
        case BRepCheck_InvalidSameParameterFlag:
            return "Invalid Same Parameter Flag";
        case BRepCheck_InvalidDegeneratedFlag:
            return "Invalid Degenerated Flag";
        case BRepCheck_FreeEdge:
            return "Free Edge";
        case BRepCheck_InvalidMultiConnexity:
            return "Invalid Multi Connexity";
        case BRepCheck_InvalidRange:
            return "Invalid Range";
        case BRepCheck_EmptyWire:
            return "Empty Wire";
        case BRepCheck_RedundantEdge:
            return "Redundant Edge";
        case BRepCheck_SelfIntersectingWire:
            return "Self Intersecting Wire";
        case BRepCheck_NoSurface:
            return "No Surface";
        case BRepCheck_InvalidWire:
            return "Invalid Wire";
        case BRepCheck_RedundantWire:
            return "Redundant Wire";
        case BRepCheck_IntersectingWires:
            return "Intersecting Wires";
        case BRepCheck_InvalidImbricationOfWires:
            return "Invalid Imbrication Of Wires";
        case BRepCheck_EmptyShell:
            return "Empty Shell";
        case BRepCheck_RedundantFace:
            return "Redundant Face";
        case BRepCheck_InvalidImbricationOfShells:
            return "Invalid Imbrication Of Shells";
        case BRepCheck_UnorientableShape:
            return "Unorientable Shape";
        case BRepCheck_NotClosed:
            return "Not Closed";
        case BRepCheck_NotConnected:
            return "Not Connected";
        case BRepCheck_SubshapeNotInShape:
            return "Subshape Not In Shape";
        case BRepCheck_BadOrientation:
            return "Bad Orientation";
        case BRepCheck_BadOrientationOfSubshape:
            return "Bad Orientation Of Subshape";
        case BRepCheck_InvalidPolygonOnTriangulation:
            return "Invalid Polygon On Triangulation";
        case BRepCheck_InvalidToleranceValue:
            return "Invalid Tolerance Value";
        case BRepCheck_EnclosedRegion:
            return "Enclosed Region";
        case BRepCheck_CheckFail:
            return "Check Fail";
        default:
            return "Unknown";
        }
    }

    static std::string joinStatusNames(const NCollection_List<BRepCheck_Status>& statusList)
    {
        std::string result;
        for (auto it = statusList.begin(); it != statusList.end(); ++it) {
            if (!result.empty()) {
                result += ", ";
            }
            result += checkStatusName(*it);
        }
        return result;
    }

    static std::string collectFaceStatus(const BRepCheck_Analyzer& analyzer, const TopoDS_Shape& face)
    {
        std::string statuses;
        const auto& faceResult = analyzer.Result(face);
        if (!faceResult.IsNull()) {
            statuses = joinStatusNames(faceResult->Status());
        }
        return statuses;
    }

    static std::vector<FaceCheckResult> checkFaces(const TopoDS_Shape& shape)
    {
        BRepCheck_Analyzer analyzer(shape);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faceMap;
        TopExp::MapShapes(shape, TopAbs_FACE, faceMap);

        std::vector<FaceCheckResult> results;
        for (int i = 1; i <= faceMap.Extent(); i++) {
            const TopoDS_Shape& face = faceMap.FindKey(i);

            FaceCheckResult result;
            result.index = i - 1;
            result.isValid = analyzer.IsValid(face);
            result.status = collectFaceStatus(analyzer, face);
            results.push_back(result);
        }

        return results;
    }

    static TopoDS_Shape
    hlr(const TopoDS_Shape& shape, const gp_Pnt& point, const gp_Dir& direction, const gp_Dir& xDirection)
    {
        gp_Ax3 ax3(point, direction, xDirection);
        gp_Trsf trsf;
        trsf.SetTransformation(ax3);

        HLRAlgo_Projector projector(trsf, false, false);
        Handle(HLRBRep_Algo) algo = new HLRBRep_Algo();
        algo->Add(shape);
        algo->Projector(projector);
        algo->Update();

        HLRBRep_HLRToShape hlrToShape(algo);
        return hlrToShape.VCompound();
    }

    static void setTolerance(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_ShapeTolerance aFixTol;
        aFixTol.SetTolerance(shape, tolerance);
    }

    static double volume(const TopoDS_Shape& shape)
    {
        GProp_GProps props;
        BRepGProp::VolumeProperties(shape, props);
        return props.Mass();
    }
};

class Vertex {
public:
    static Vector3 point(const TopoDS_Vertex& vertex)
    {
        return Vector3::fromPnt(BRep_Tool::Pnt(vertex));
    }
};

class Edge {
public:
    /** Samples of `|D1 × dir|` taken per knot span when asking whether an offset is defined. */
    constexpr static int OFFSET_VANISH_PER_SPAN = 8;
    /**
     * Golden-section steps run on a span whose samples dip — see `Edge::leastCross`. A collapse
     * reached transversally (the derivative reversing, so its magnitude runs straight through
     * zero) leaves a minimum only as small as the bracket is narrow, not squared as a touch of
     * zero would: at 0.618 to the step, this puts the reachable ratio below 1e-14, and the search
     * simply stalls at the last representable parameter past that.
     */
    constexpr static int OFFSET_VANISH_SEARCH_STEPS = 80;
    /**
     * A span whose least sample is within this much of the greatest sample anywhere is searched
     * for a collapse. Loose on purpose: a quadratic touch of zero leaves its span's least sample
     * at roughly a 64th of the peak, so a tight gate would skip the very spans worth searching.
     */
    constexpr static double OFFSET_VANISH_SUSPECT = 0.5;
    /**
     * How close to zero `|D1 × dir|` has to come, against the greatest it reaches, to be a
     * collapse. The kernel's own condition is `<= gp::Resolution()` (`DBL_MIN`) — an exact zero —
     * so this only has to span the gap between "exactly zero" and "small but real", and every
     * order of magnitude it is loosened by is a curve the kernel could have offset refused. The
     * search above reaches machine noise either way a collapse arrives, six orders clear of this.
     * Measured on a hairpin, a curve that turns through a half-turn and keeps a derivative
     * throughout, the ratio is 0.25 — eight orders the other side of it.
     */
    constexpr static double OFFSET_VANISH_RELATIVE = 1e-9;

    static TopoDS_Edge fromCurve(const Geom_Curve* curve)
    {
        Handle(Geom_Curve) handleCurve(curve);
        BRepBuilderAPI_MakeEdge builder(handleCurve);
        return builder.Edge();
    }

    static double curveLength(const TopoDS_Edge& edge)
    {
        GProp_GProps props;
        BRepGProp::LinearProperties(edge, props);
        return props.Mass();
    }

    static double firstParameter(const TopoDS_Edge& edge)
    {
        // BRepAdaptor_Curve raises on an edge with neither a 3D curve nor a pcurve.
        if (!BRep_Tool::IsGeometric(edge)) {
            return 0.0;
        }
        BRepAdaptor_Curve adaptor(edge);
        return adaptor.FirstParameter();
    }

    static double lastParameter(const TopoDS_Edge& edge)
    {
        if (!BRep_Tool::IsGeometric(edge)) {
            return 0.0;
        }
        BRepAdaptor_Curve adaptor(edge);
        return adaptor.LastParameter();
    }

    static Vector3 pointAt(const TopoDS_Edge& edge, double parameter)
    {
        if (!BRep_Tool::IsGeometric(edge)) {
            // A degenerate edge collapses to its vertex point.
            ShapeAnalysis_Edge analysis;
            TopoDS_Vertex vertex = analysis.FirstVertex(edge);
            return vertex.IsNull() ? Vector3 { 0.0, 0.0, 0.0 } : Vector3::fromPnt(BRep_Tool::Pnt(vertex));
        }
        BRepAdaptor_Curve adaptor(edge);
        return Vector3::fromPnt(adaptor.Value(parameter));
    }

    static Vector3 pointOfVertex(const TopoDS_Vertex& vertex)
    {
        // An edge built on an infinite curve has no vertices; BRep_Tool::Pnt raises on a null vertex.
        if (vertex.IsNull()) {
            return Vector3 { 0.0, 0.0, 0.0 };
        }
        return Vector3::fromPnt(BRep_Tool::Pnt(vertex));
    }

    static Vector3 startPoint(const TopoDS_Edge& edge)
    {
        ShapeAnalysis_Edge analysis;
        return pointOfVertex(analysis.FirstVertex(edge));
    }

    static Vector3 endPoint(const TopoDS_Edge& edge)
    {
        ShapeAnalysis_Edge analysis;
        return pointOfVertex(analysis.LastVertex(edge));
    }

    static Vector3Array ends(const TopoDS_Edge& edge)
    {
        ShapeAnalysis_Edge analysis;
        std::vector<Vector3> points = {
            pointOfVertex(analysis.FirstVertex(edge)),
            pointOfVertex(analysis.LastVertex(edge)),
        };
        return Vector3Array(val::array(points));
    }

    static Handle(Geom_TrimmedCurve) curve(const TopoDS_Edge& edge)
    {
        double start(0.0), end(0.0);
        Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, start, end);
        if (curve.IsNull()) {
            // A degenerate edge has no 3D curve to wrap. A C++ raise would abort the WASM
            // module (exceptions are disabled), so report as a catchable JS Error instead.
            val::global("Error").new_(std::string("Edge.curve: degenerate edge has no 3D curve")).throw_();
        }
        Handle(Geom_TrimmedCurve) trimmedCurve = new Geom_TrimmedCurve(curve, start, end);
        return trimmedCurve;
    }

    static TopoDS_Edge trim(const TopoDS_Edge& edge, double start, double end)
    {
        double u1(0.0), u2(0.0);
        Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, u1, u2);
        if (curve.IsNull()) {
            return TopoDS_Edge();
        }
        // A Geom_OffsetCurve on a trimmed basis is bounded by the basis trim range,
        // rebase it on the untrimmed basis so trimming beyond the edge range works.
        Handle(Geom_OffsetCurve) offsetCurve = Handle(Geom_OffsetCurve)::DownCast(curve);
        if (!offsetCurve.IsNull()) {
            Handle(Geom_TrimmedCurve) trimmedBasis = Handle(Geom_TrimmedCurve)::DownCast(offsetCurve->BasisCurve());
            if (!trimmedBasis.IsNull()) {
                curve = new Geom_OffsetCurve(trimmedBasis->BasisCurve(), offsetCurve->Offset(), offsetCurve->Direction());
            }
        }
        BRepBuilderAPI_MakeEdge builder(curve, start, end);
        if (!builder.IsDone()) {
            return TopoDS_Edge();
        }
        return builder.Edge();
    }

    static TopoDS_Edge offset(const TopoDS_Edge& edge, const gp_Dir& dir, double offset)
    {
        double start(0.0), end(0.0);
        Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, start, end);
        if (curve.IsNull()) {
            return TopoDS_Edge();
        }
        // Geom_OffsetCurve raises only for a basis that is both C0 and a B-spline it cannot read
        // as G1 — and it looks through any trim/offset wrapper to the curve underneath, while its
        // own Continuity() reports one order lower than that basis's (a C1 basis reads as C0), so
        // the check has to unwrap rather than read the curve here. The Release build catches
        // nothing (`-sDISABLE_EXCEPTION_CATCHING=1` aborts the module), so that one raise is
        // answered here first.
        Handle(Geom_Curve) basis = curve;
        while (true) {
            if (basis->IsKind(STANDARD_TYPE(Geom_TrimmedCurve))) {
                basis = Handle(Geom_TrimmedCurve)::DownCast(basis)->BasisCurve();
            } else if (basis->IsKind(STANDARD_TYPE(Geom_OffsetCurve))) {
                basis = Handle(Geom_OffsetCurve)::DownCast(basis)->BasisCurve();
            } else {
                break;
            }
        }
        if (basis->Continuity() == GeomAbs_C0 && basis->IsKind(STANDARD_TYPE(Geom_BSplineCurve))
            && !Handle(Geom_BSplineCurve)::DownCast(basis)->IsG1(start, end, Precision::Angular())) {
            return TopoDS_Edge();
        }
        // That is not the only raise in reach, and `MakeEdge` below is where the next one fires:
        // it evaluates the offset at both of its ends (`BRepLib_MakeEdge`), and an offset has no
        // value where the basis' derivative vanishes or runs along `dir` — `CalculateD0` reports
        // that, `GeomAdaptor_Curve::EvalD0` turns it into `Geom_UndefinedValue`, and the Release
        // build aborts the module on it. A clamped basis whose first two control points coincide
        // is the ordinary way in: its derivative at the first knot is (degree/span)·(pole2−pole1),
        // which is zero. Measured: a cubic with two coincident leading poles aborted here.
        // This stays for every kind of basis, not just the splines `offsetUndefined` reads below:
        // an analytic curve can lose the reading at an end too — a line offset along its own
        // direction has its derivative parallel to `dir` — and that is a null edge, not a scan.
        if (basis->EvalD1(start).D1.CrossMagnitude(dir) <= gp::Resolution()
            || basis->EvalD1(end).D1.CrossMagnitude(dir) <= gp::Resolution()) {
            return TopoDS_Edge();
        }
        // The ends are not the only place the derivative can vanish, and the reading has no offset
        // there either — this is reached through the curve rather than through its bounds.
        if (basis->IsKind(STANDARD_TYPE(Geom_BSplineCurve)) || basis->IsKind(STANDARD_TYPE(Geom_BezierCurve))) {
            Handle(Geom_BSplineCurve) spline = Handle(Geom_BSplineCurve)::DownCast(basis);
            if (spline.IsNull()) {
                spline = GeomConvert::CurveToBSplineCurve(basis);
            }
            if (offsetUndefined(spline, dir)) {
                return TopoDS_Edge();
            }
        }
        Handle(Geom_TrimmedCurve) trimmedCurve = new Geom_TrimmedCurve(curve, start, end);
        Handle(Geom_OffsetCurve) offsetCurve = new Geom_OffsetCurve(trimmedCurve, offset, dir);
        BRepBuilderAPI_MakeEdge builder(offsetCurve);
        if (!builder.IsDone()) {
            return TopoDS_Edge();
        }
        return builder.Edge();
    }

    /** `|D1(u) × dir|` — the one quantity `Geom_OffsetCurveUtils::CalculateD0` refuses on. */
    static double crossAt(const Handle(Geom_BSplineCurve) & spline, double u, const gp_Dir& dir)
    {
        return spline->EvalD1(u).D1.CrossMagnitude(dir);
    }

    /**
     * The smallest `|D1 × dir|` on `[from, to]`, by golden-section search. A collapse of the
     * derivative is a *local* minimum of it, and the search wants only that the shape around one
     * keeps falling towards it and rising after — which it does, whether the magnitude curves to
     * the bottom (the derivative's own value touching zero) or runs straight through it (the
     * derivative reversing). A derivative-based step would need the second derivative's sign to
     * behave at exactly the point that is degenerating; this needs nothing of it.
     */
    static double leastCross(
        const Handle(Geom_BSplineCurve) & spline, const gp_Dir& dir, double from, double to)
    {
        constexpr double PHI = 0.6180339887498949;
        double low = from, high = to;
        double left = high - (high - low) * PHI;
        double right = low + (high - low) * PHI;
        double leftCross = crossAt(spline, left, dir);
        double rightCross = crossAt(spline, right, dir);
        for (int step = 0; step < OFFSET_VANISH_SEARCH_STEPS; step++) {
            if (leftCross < rightCross) {
                high = right;
                right = left;
                rightCross = leftCross;
                left = high - (high - low) * PHI;
                leftCross = crossAt(spline, left, dir);
            } else {
                low = left;
                left = right;
                leftCross = rightCross;
                right = low + (high - low) * PHI;
                rightCross = crossAt(spline, right, dir);
            }
        }
        return std::min(leftCross, rightCross);
    }

    /**
     * Whether an offset of this B-spline has no value anywhere — the one thing the kernel's offset
     * cannot survive. `Geom_OffsetCurveUtils::CalculateD0` reports it wherever
     * `|D1 × dir| <= gp::Resolution()` (`DBL_MIN`, an *exact* zero), `GeomAdaptor_Curve::EvalD0`
     * turns that into a `Geom_UndefinedValue`, and the Release build aborts the whole module on it
     * because it catches nothing. `MakeEdge` only ever evaluates the two ends, so a collapse in
     * between gives way while building and dies on the next evaluation of the edge it returned.
     *
     * Reading the curve, not the control vectors: the derivative of a B-spline is a B-spline whose
     * control vectors are `p/(u[i+p+1] − u[i+1])·(P[i+1] − P[i])`, so a *zero* one is two
     * neighbouring control points that coincide. But the converse does not hold — a curve whose
     * derivative control vectors are all non-zero can still cancel to zero between them: a cubic
     * through (0,0), (1,0), (0,0), (1,0) has `3(2t−1)²` for its derivative, zero at `t = ½`, and its
     * three derivative control vectors are none of them zero. That reading also *refuses* curves it
     * should not: a span a thousandth of its neighbours leaves one control vector small while the
     * derivative itself, mixing its neighbours, stays whole.
     *
     * A curve that only turns, however far — a hook, a hairpin — keeps its derivative away from
     * zero everywhere and is unaffected: measured on such a cubic, the derivative falls to a
     * quarter of its peak, eight orders of magnitude clear of the threshold below.
     */
    static bool offsetUndefined(const Handle(Geom_BSplineCurve) & spline, const gp_Dir& dir)
    {
        // every read below raises outside its range, and a raise is an abort of its own
        const int degree = spline->Degree();
        const int knots = spline->NbKnots();
        if (degree < 1 || knots < 2 || spline->NbPoles() < 2) {
            return true;
        }
        const double first = spline->FirstParameter();
        const double last = spline->LastParameter();
        if (!(last > first)) {
            return true;
        }

        // Sampled a knot span at a time: a span is where the curve is one polynomial, and a
        // collapse is local to one, so a span far shorter than its neighbours (which a step over
        // the whole curve would straddle) still gets its own samples.
        std::vector<double> sampleUs;
        std::vector<double> sampleCrosses;
        std::vector<int> spanStarts;
        std::vector<int> spanEnds;
        for (int span = 1; span <= knots - 1; span++) {
            const double from = spline->Knot(span);
            const double to = spline->Knot(span + 1);
            if (!(to > from)) {
                continue; // a repeated knot bounds no span
            }
            spanStarts.push_back(static_cast<int>(sampleUs.size()));
            for (int i = 0; i <= OFFSET_VANISH_PER_SPAN; i++) {
                const double u = from + ((to - from) * i) / OFFSET_VANISH_PER_SPAN;
                sampleUs.push_back(u);
                sampleCrosses.push_back(crossAt(spline, u, dir));
            }
            spanEnds.push_back(static_cast<int>(sampleUs.size()) - 1);
        }
        if (sampleCrosses.empty()) {
            return true;
        }
        const double largest = *std::max_element(sampleCrosses.begin(), sampleCrosses.end());
        if (largest <= 0.0) {
            return true; // no derivative at all: nothing to offset
        }

        // A span whose samples dip is where a collapse can hide, and it is what the search is for.
        // The gate is deliberately loose, because samples alone see very little of one: a span's
        // least sample sits at a sixteenth of its peak where the magnitude runs straight through
        // the zero and a sixty-fourth where it only touches it, and either is well inside this. A
        // tight gate would skip the very spans worth searching, and catching a collapse would come
        // down to whether it happened to land on a sample. A span that merely varies in speed is
        // searched too, costs one golden-section run, and answers far above the threshold.
        double least = largest;
        for (size_t span = 0; span < spanStarts.size(); span++) {
            const int start = spanStarts[span];
            const int end = spanEnds[span];
            double spanLeast = sampleCrosses[start];
            for (int i = start + 1; i <= end; i++) {
                spanLeast = std::min(spanLeast, sampleCrosses[i]);
            }
            least = std::min(least, spanLeast);
            if (spanLeast <= largest * OFFSET_VANISH_SUSPECT) {
                least = std::min(least, leastCross(spline, dir, sampleUs[start], sampleUs[end]));
            }
        }
        return least <= largest * OFFSET_VANISH_RELATIVE;
    }

    static PointAndParameterArray intersect(const TopoDS_Edge& edge, const TopoDS_Edge& otherEdge)
    {
        std::vector<PointAndParameter> points;
        if (edge.IsNull() || otherEdge.IsNull() || BRep_Tool::Degenerated(edge)
            || BRep_Tool::Degenerated(otherEdge)) {
            return PointAndParameterArray(val::array(points));
        }

        double start1(0.0), end1(0.0), start2(0.0), end2(0.0);
        Handle(Geom_Curve) curve1 = BRep_Tool::Curve(edge, start1, end1);
        Handle(Geom_Curve) curve2 = BRep_Tool::Curve(otherEdge, start2, end2);
        if (curve1.IsNull() || curve2.IsNull()) {
            return PointAndParameterArray(val::array(points));
        }

        BRepExtrema_ExtCC cc(edge, otherEdge);
        if (cc.IsDone() && cc.NbExt() > 0 && !cc.IsParallel()) {
            for (int i = 1; i <= cc.NbExt(); i++) {
                if (cc.SquareDistance(i) > Precision::Intersection()) {
                    continue;
                }
                PointAndParameter pointAndParameter = {
                    Vector3::fromPnt(cc.PointOnE1(i)),
                    cc.ParameterOnE1(i),
                };
                points.push_back(pointAndParameter);
            }
        }

        return PointAndParameterArray(val::array(points));
    }
};

class Wire {
public:
    static TopoDS_Shape offset(const TopoDS_Wire& wire, double distance, const GeomAbs_JoinType& joinType)
    {
        BRepOffsetAPI_MakeOffset offsetter(wire, joinType);
        offsetter.Perform(distance);
        if (offsetter.IsDone()) {
            return offsetter.Shape();
        }
        return TopoDS_Shape();
    }

    static TopoDS_Face makeFace(const TopoDS_Wire& wire)
    {
        BRepBuilderAPI_MakeFace face(wire);
        return face.Face();
    }

    static EdgeArray edgeLoop(const TopoDS_Wire& wire)
    {
        std::vector<TopoDS_Edge> edges;
        BRepTools_WireExplorer explorer(wire);
        for (; explorer.More(); explorer.Next()) {
            edges.push_back(TopoDS::Edge(explorer.Current()));
        }
        return EdgeArray(val::array(edges));
    }
};

class Face {
public:
    static double area(const TopoDS_Face& face)
    {
        GProp_GProps props;
        BRepGProp::SurfaceProperties(face, props);
        return props.Mass();
    }

    static TopoDS_Shape offset(const TopoDS_Face& face, double distance, const GeomAbs_JoinType& joinType)
    {
        BRepOffsetAPI_MakeOffset offsetter(face, joinType);
        offsetter.Perform(distance);
        if (offsetter.IsDone()) {
            return offsetter.Shape();
        }
        return TopoDS_Shape();
    }

    static Domain curveOnSurface(const TopoDS_Face& face, const TopoDS_Edge& edge)
    {
        double start(0.0), end(0.0);
        if (BRep_Tool::CurveOnSurface(edge, face, start, end).IsNull()) {
            return Domain();
        }
        Domain domain = { start, end };
        return domain;
    }

    static bool containsPoint(const TopoDS_Face& face, const Vector3& point, bool containsEdge, double tolerance)
    {
        // A face without a geometric surface (e.g. an STL-imported face) contains nothing.
        if (BRep_Tool::Surface(face).IsNull()) {
            return false;
        }
        gp_Pnt pnt(point.x, point.y, point.z);

        auto aPuv = pointToFaceUV(face, pnt, tolerance);
        if (!aPuv.has_value()) {
            return false;
        }

        BRepClass_FaceClassifier classifier(face, aPuv.value(), tolerance);
        auto state = classifier.State();
        if (containsEdge && state == TopAbs_ON) {
            return true;
        }
        return state == TopAbs_IN;
    }

    static std::optional<Vector3> intersectLine(const TopoDS_Face& face, const Vector3& point, const Vector3& direction, double tolerance)
    {
        if (BRep_Tool::Surface(face).IsNull()) {
            return std::nullopt;
        }
        gp_Lin line(gp_Pnt(point.x, point.y, point.z), gp_Dir(direction.x, direction.y, direction.z));

        IntCurvesFace_Intersector anIntersector(face, tolerance);
        anIntersector.Perform(line, -1e12, 1e12);
        if (anIntersector.IsDone() && anIntersector.NbPnt() > 0) {
            return Vector3::fromPnt(anIntersector.Pnt(1));
        }
        return std::nullopt;
    }

    static void normal(const TopoDS_Face& face, double u, double v, gp_Pnt& point, gp_Vec& normal)
    {
        // A face without a geometric surface has no normal; leave the zero-initialized outputs.
        if (BRep_Tool::Surface(face).IsNull()) {
            return;
        }
        BRepGProp_Face gpProp(face);
        gpProp.Normal(u, v, point, normal);
    }

    static WireArray wires(const TopoDS_Face& face)
    {
        std::vector<TopoDS_Wire> wires;
        TopExp_Explorer explorer;
        for (explorer.Init(face, TopAbs_WIRE); explorer.More(); explorer.Next()) {
            wires.push_back(TopoDS::Wire(explorer.Current()));
        }
        return WireArray(val::array(wires));
    }

    static TopoDS_Wire outerWire(const TopoDS_Face& face)
    {
        return BRepTools::OuterWire(face);
    }

    static Handle(Geom_Surface) surface(const TopoDS_Face& face)
    {
        return BRep_Tool::Surface(face);
    }
};

class Solid {
public:
    static bool containsPoint(const TopoDS_Shape& shape, const Vector3& point, bool containsSurface, double tolerance)
    {
        gp_Pnt pnt(point.x, point.y, point.z);
        BRepClass3d_SolidClassifier classifier(shape, pnt, tolerance);
        TopAbs_State state = classifier.State();
        if (state == TopAbs_IN) {
            return true;
        } else if (state == TopAbs_OUT) {
            return false;
        } else if (state == TopAbs_ON && containsSurface) {
            return true;
        }

        return false;
    }
};

EMSCRIPTEN_BINDINGS(Shape)
{
    class_<Shape>("Shape")
        .class_function("ptr", &Shape::ptr)
        .class_function("boundingBox", &Shape::boundingBox)
        .class_function("orientedBoundingBox", &Shape::orientedBoundingBox)
        .class_function("extremaDistance", &Shape::extremaDistance)
        .class_function("clean", &Shape::clean)
        .class_function("clone", &Shape::clone)
        .class_function("transformed", &Shape::transformed)
        .class_function("transformedGeneral", &Shape::transformedGeneral)
        .class_function("findAncestor", &Shape::findAncestor)
        .class_function("findSubShapes", &Shape::findSubShapes)
        .class_function("getDirectSubShapes", &Shape::getDirectSubShapes)
        .class_function("sectionSS", &Shape::sectionSS)
        .class_function("sectionSP", &Shape::sectionSP)
        .class_function("isClosed", &Shape::isClosed)
        .class_function("splitShapes", &Shape::splitShapes)
        .class_function("check", &Shape::check)
        .class_function("checkFaces", &Shape::checkFaces)
        .class_function("hlr", &Shape::hlr)
        .class_function("shellSewing", &Shape::shellSewing)
        .class_function("setTolerance", &Shape::setTolerance)
        .class_function("volume", &Shape::volume);

    class_<Vertex>("Vertex").class_function("point", &Vertex::point);

    class_<Edge>("Edge")
        .class_function("fromCurve", &Edge::fromCurve, allow_raw_pointers())
        .class_function("curve", &Edge::curve)
        .class_function("curveLength", &Edge::curveLength)
        .class_function("firstParameter", &Edge::firstParameter)
        .class_function("lastParameter", &Edge::lastParameter)
        .class_function("pointAt", &Edge::pointAt)
        .class_function("startPoint", &Edge::startPoint)
        .class_function("endPoint", &Edge::endPoint)
        .class_function("ends", &Edge::ends)
        .class_function("trim", &Edge::trim)
        .class_function("intersect", &Edge::intersect)
        .class_function("offset", &Edge::offset);

    class_<Wire>("Wire")
        .class_function("offset", &Wire::offset)
        .class_function("makeFace", &Wire::makeFace)
        .class_function("edgeLoop", &Wire::edgeLoop);

    class_<Face>("Face")
        .class_function("area", &Face::area)
        .class_function("offset", &Face::offset)
        .class_function("outerWire", &Face::outerWire)
        .class_function("surface", &Face::surface)
        .class_function("normal", &Face::normal)
        .class_function("intersectLine", &Face::intersectLine)
        .class_function("curveOnSurface", &Face::curveOnSurface)
        .class_function("containsPoint", &Face::containsPoint);

    class_<Solid>("Solid")
        .class_function("containsPoint", &Solid::containsPoint);
}
