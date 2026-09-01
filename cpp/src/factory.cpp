// Part of the Chili3d Project, under the LGPL-3.0 License.
// See LICENSE-chili-wasm.text file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "shared.hpp"
#include "utils.hpp"
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFeat_MakePrism.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_Mode.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepProj_Projection.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <ChFi2d_Builder.hxx>
#include <ChFi2d_ChamferAPI.hxx>
#include <ChFi2d_FilletAPI.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <HelixBRep_BuilderHelix.hxx>
#include <NCollection_Array1.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <ShapeFix_Face.hxx>
#include <ShapeFix_FixSmallFace.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_ShapeTolerance.hxx>
#include <ShapeFix_Solid.hxx>
#include <ShapeFix_Wire.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <deque>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>

using namespace emscripten;

struct ShapeResult {
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
};

struct RemoveFilletResult {
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
    ShapeArray newEdges;
};

struct ShapesResult {
    ShapeArray shapes;
    bool isOk;
    std::string error;
};

struct TrackedShapeResult {
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
    // output face/edge index (TopExp::MapShapes order) -> input index, -1 = new sub-shape
    std::vector<int> faceMap;
    std::vector<int> edgeMap;
};

// Marks output sub-shapes identical to or derived (Modified/Generated — guarded, some
// algorithms only implement Generated) from `inShape` with its input index.
static void mapInputShape(BRepBuilderAPI_MakeShape& algo, const TopoDS_Shape& inShape, int inIndex,
    const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& outMap, std::vector<int>& map)
{
    auto markDerived = [&](const NCollection_List<TopoDS_Shape>& derived) {
        for (const TopoDS_Shape& shape : derived) {
            int outIndex = outMap.FindIndex(shape);
            if (outIndex > 0 && map[outIndex - 1] < 0) {
                map[outIndex - 1] = inIndex;
            }
        }
    };
    int identical = outMap.FindIndex(inShape);
    if (identical > 0 && map[identical - 1] < 0) {
        map[identical - 1] = inIndex;
    }
    try {
        markDerived(algo.Modified(inShape));
    } catch (const Standard_Failure&) {
    }
    try {
        markDerived(algo.Generated(inShape));
    } catch (const Standard_Failure&) {
    }
}

// Maps each output sub-shape of `type` to the input sub-shape it derives from (identity
// first — some algorithms keep input shapes as-is, e.g. the prism bottom face).
// Sub-shapes without an input origin keep -1.
static std::vector<int> shapeHistory(BRepBuilderAPI_MakeShape& algo, const TopoDS_Shape& input,
    const TopoDS_Shape& output, TopAbs_ShapeEnum type)
{
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> inMap;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> outMap;
    TopExp::MapShapes(input, type, inMap);
    TopExp::MapShapes(output, type, outMap);
    std::vector<int> map(outMap.Extent(), -1);
    for (int i = 1; i <= inMap.Extent(); i++) {
        mapInputShape(algo, inMap.FindKey(i), i - 1, outMap, map);
    }
    return map;
}

static std::vector<int> faceHistory(BRepBuilderAPI_MakeShape& algo, const TopoDS_Shape& input, const TopoDS_Shape& output)
{
    return shapeHistory(algo, input, output, TopAbs_FACE);
}

static std::vector<int> edgeHistory(BRepBuilderAPI_MakeShape& algo, const TopoDS_Shape& input, const TopoDS_Shape& output)
{
    return shapeHistory(algo, input, output, TopAbs_EDGE);
}

// Compute the plane formed by two edges at their shared vertex from their tangent vectors.
static std::optional<gp_Dir> computeNormal(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, const TopoDS_Vertex& vertex)
{
    double p1 = BRep_Tool::Parameter(vertex, edge1);
    double p2 = BRep_Tool::Parameter(vertex, edge2);

    double cf, cl;
    Handle(Geom_Curve) curve1 = BRep_Tool::Curve(edge1, cf, cl);
    Handle(Geom_Curve) curve2 = BRep_Tool::Curve(edge2, cf, cl);

    gp_Pnt pt;
    gp_Vec tan1, tan2;
    curve1->D1(p1, pt, tan1);
    curve2->D1(p2, pt, tan2);

    gp_Vec normal = tan1.Crossed(tan2);
    if (normal.Magnitude() < Precision::Angular()) {
        return std::nullopt;
    }

    return gp_Dir(normal);
}

// Find the common vertex shared by two edges. Returns null if none.
static TopoDS_Vertex findCommonVertex(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2)
{
    TopExp_Explorer v1(edge1, TopAbs_VERTEX);
    for (; v1.More(); v1.Next()) {
        auto vertex1 = v1.Current();
        TopExp_Explorer v2(edge2, TopAbs_VERTEX);
        for (; v2.More(); v2.Next()) {
            if (vertex1.IsSame(v2.Current())) {
                return TopoDS::Vertex(vertex1);
            }
        }
    }
    return TopoDS_Vertex();
}

// Build a JS array [edge1, edge2, edge3] from three edges.
static val buildEdgeTriple(const TopoDS_Edge& a, const TopoDS_Edge& b, const TopoDS_Edge& c)
{
    val edges = val::array();
    edges.call<void>("push", a);
    edges.call<void>("push", b);
    edges.call<void>("push", c);
    return edges;
}

// Line equivalent of a curve, unwrapping trimmed and offset curves (an offset of a line
// is the same line translated, with the same parametrization). Null when not linear.
static Handle(Geom_Line) asLine(const Handle(Geom_Curve) & curve)
{
    if (auto trimmed = Handle(Geom_TrimmedCurve)::DownCast(curve))
        return asLine(trimmed->BasisCurve());
    if (auto line = Handle(Geom_Line)::DownCast(curve))
        return line;
    if (auto offset = Handle(Geom_OffsetCurve)::DownCast(curve)) {
        if (auto basisLine = asLine(offset->BasisCurve())) {
            gp_Vec shift(basisLine->Value(0.0), offset->Value(0.0));
            return new Geom_Line(
                gp_Lin(basisLine->Lin().Location().Translated(shift), basisLine->Lin().Direction()));
        }
    }
    return nullptr;
}

// The curve underlying an edge with its parameter range, unwrapping trimmed curves. An
// offset of a line is replaced by the equivalent plain line, so that fillet/chamfer
// operate at the offset position instead of the pre-offset one.
static Handle(Geom_Curve) basisCurve(const TopoDS_Edge& edge, double& first, double& last)
{
    Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
    if (auto line = asLine(curve))
        return line;
    if (auto trimmed = Handle(Geom_TrimmedCurve)::DownCast(curve))
        curve = trimmed->BasisCurve();
    return curve;
}

struct CornerPlane {
    gp_Pnt point; // intersection of the two support lines
    gp_Dir normal; // normal of the plane containing both edges
    double param1 = 0.0; // corner parameter on the first support line
    double param2 = 0.0; // corner parameter on the second support line
};

// Compute the corner reference point and the plane for a 2D fillet/chamfer between two
// edges. Only straight edges are supported: they must be coplanar and non-parallel, and
// the corner is the intersection of their support lines, which need not lie on the
// edges themselves.
static std::optional<CornerPlane> computeCornerPlane(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2,
    std::string& error)
{
    double f, l;
    Handle(Geom_Line) line1 = Handle(Geom_Line)::DownCast(basisCurve(edge1, f, l));
    Handle(Geom_Line) line2 = Handle(Geom_Line)::DownCast(basisCurve(edge2, f, l));
    if (line1.IsNull() || line2.IsNull()) {
        error = "Edges must be Line";
        return std::nullopt;
    }

    gp_Vec d1(line1->Lin().Direction());
    gp_Vec d2(line2->Lin().Direction());
    gp_Vec normal = d1.Crossed(d2);
    if (normal.Magnitude() < Precision::Angular()) {
        error = "Edges must not be parallel";
        return std::nullopt;
    }

    gp_Vec p12(line1->Lin().Location(), line2->Lin().Location());
    if (std::abs(p12.Dot(normal) / normal.Magnitude()) > Precision::Confusion()) {
        error = "Edges must be coplanar";
        return std::nullopt;
    }

    // intersection of the support lines: p12 = t1 * d1 - t2 * d2, solved by crossing with d2 and d1 respectively
    double denom = normal.SquareMagnitude();
    double t1 = p12.Crossed(d2).Dot(normal) / denom;
    double t2 = p12.Crossed(d1).Dot(normal) / denom;
    return CornerPlane { line1->Lin().Location().Translated(d1.Multiplied(t1)), gp_Dir(normal), t1, t2 };
}

// Build an edge whose range covers the corner parameter p. When p cuts the edge in two,
// only the longer side is kept, so that fillets/chamfers consume the shorter side; when p
// lies outside, the edge is extended up to p (OCCT fillets can trim but never prolongate).
static TopoDS_Edge edgeThroughCorner(const Handle(Geom_Curve) & basis, double first, double last, double p)
{
    if (p > first && p < last) {
        return p - first >= last - p ? BRepBuilderAPI_MakeEdge(basis, first, p).Edge()
                                     : BRepBuilderAPI_MakeEdge(basis, p, last).Edge();
    }
    return BRepBuilderAPI_MakeEdge(basis, std::min(first, p), std::max(last, p)).Edge();
}

// Endpoints of an edge, evaluated on its underlying curve.
static void edgeEndPoints(const TopoDS_Edge& edge, gp_Pnt& start, gp_Pnt& end)
{
    double first, last;
    Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
    start = curve->Value(first);
    end = curve->Value(last);
}

// ChFi2d may trim either side of the corner, so the kept side is rebuilt
// deterministically: from the fillet tangent point (whichever arc endpoint lies on this
// curve) to the end of the edge farthest from the corner.
static TopoDS_Edge edgeToFarEnd(const Handle(Geom_Curve) & basis, double first, double last,
    double cornerParam, const gp_Pnt& arcStart, const gp_Pnt& arcEnd)
{
    GeomAPI_ProjectPointOnCurve fromStart(arcStart, basis);
    GeomAPI_ProjectPointOnCurve fromEnd(arcEnd, basis);
    double tangent = fromStart.LowerDistance() <= fromEnd.LowerDistance()
        ? fromStart.LowerDistanceParameter()
        : fromEnd.LowerDistanceParameter();
    double farEnd = cornerParam - first >= last - cornerParam ? first : last;
    return BRepBuilderAPI_MakeEdge(basis, std::min(tangent, farEnd), std::max(tangent, farEnd)).Edge();
}

static std::string mapBuildWireError(const BRepBuilderAPI_WireError& error)
{
    switch (error) {
    case BRepBuilderAPI_EmptyWire:
        return "Empty Wire";
    case BRepBuilderAPI_DisconnectedWire:
        return "Disconnected Wire";
    case BRepBuilderAPI_NonManifoldWire:
        return "Non Mainfold Wire";
    default:
        return "Done";
    }
};

class ShapeFactory {
public:
    static ShapeResult box(const Pln& ax3, double x, double y, double z)
    {
        gp_Pln pln = Pln::toPln(ax3);
        BRepBuilderAPI_MakeFace makeFace(pln, 0, x, 0, y);
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create box" };
        }

        gp_Vec vec(pln.Axis().Direction());
        vec.Multiply(z);
        BRepPrimAPI_MakePrism box(makeFace.Face(), vec);
        if (!box.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create box" };
        }
        return ShapeResult { box.Shape(), true, "" };
    }

    static ShapeResult cone(const Vector3& normal, const Vector3& center, double radius, double radiusUp, double height)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        TopoDS_Shape cone = BRepPrimAPI_MakeCone(ax2, radius, radiusUp, height).Shape();
        return ShapeResult { cone, true, "" };
    }

    static ShapeResult sphere(const Vector3& center, double radius)
    {
        TopoDS_Shape sphere = BRepPrimAPI_MakeSphere(Vector3::toPnt(center), radius).Shape();
        return ShapeResult { sphere, true, "" };
    }

    static ShapeResult ellipse(const Vector3& normal, const Vector3& center, const Vector3& xvec, double majorRadius,
        double minorRadius)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal), Vector3::toDir(xvec));
        gp_Elips ellipse(ax2, majorRadius, minorRadius);
        BRepBuilderAPI_MakeEdge edge(ellipse);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create ellipse" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    /**
     * TODO
     */
    static ShapeResult ellipsoid(const Vector3& normal, const Vector3& center, const Vector3& xvec, double xRadius,
        double yRadius, double zRadius)
    {
        TopoDS_Shape sphere = BRepPrimAPI_MakeSphere(1).Solid();

        gp_GTrsf transform;
        transform.SetValue(1, 1, xRadius);
        transform.SetValue(2, 2, yRadius);
        transform.SetValue(3, 3, zRadius);
        transform.SetTranslationPart(gp_XYZ(center.x, center.y, center.z));

        BRepBuilderAPI_GTransform builder(sphere, transform);
        if (builder.IsDone()) {
            TopoDS_Shape ellipsoid = builder.Shape();
            return ShapeResult { ellipsoid, true, "" };
        }
        return ShapeResult { TopoDS_Shape(), false, "" };
    }

    static ShapeResult pyramid(const Pln& ax3, double x, double y, double z)
    {
        if (abs(x) <= Precision::Confusion() || abs(y) <= Precision::Confusion() || abs(z) <= Precision::Confusion()) {
            return ShapeResult { TopoDS_Shape(), false, "Invalid dimensions" };
        }

        gp_Pln pln = Pln::toPln(ax3);
        auto xvec = gp_Vec(pln.XAxis().Direction()).Multiplied(x);
        auto yvec = gp_Vec(pln.YAxis().Direction()).Multiplied(y);
        auto zvec = gp_Vec(pln.Axis().Direction()).Multiplied(z);
        auto p1 = pln.Location();
        auto p2 = p1.Translated(xvec);
        auto p3 = p1.Translated(xvec).Translated(yvec);
        auto p4 = p1.Translated(yvec);
        auto top = pln.Location().Translated((xvec + yvec) * 0.5 + zvec);

        std::vector<TopoDS_Face> faces = {
            TopoDS::Face(pointsToFace({ p1, p2, p3, p4, p1 }).shape), TopoDS::Face(pointsToFace({ p1, p2, top, p1 }).shape),
            TopoDS::Face(pointsToFace({ p2, p3, top, p2 }).shape), TopoDS::Face(pointsToFace({ p3, p4, top, p3 }).shape),
            TopoDS::Face(pointsToFace({ p4, p1, top, p4 }).shape)
        };

        return facesToSolid(faces);
    }

    static ShapeResult pointsToFace(std::vector<gp_Pnt>&& points)
    {
        auto wire = pointsToWire(points);
        if (!wire.isOk) {
            return wire;
        }

        BRepBuilderAPI_MakeFace face(TopoDS::Wire(wire.shape));
        if (!face.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face" };
        }
        return ShapeResult { face.Face(), true, "" };
    }

    static ShapeResult pointsToWire(std::vector<gp_Pnt>& points)
    {
        BRepBuilderAPI_MakePolygon poly;
        for (auto& p : points) {
            poly.Add(p);
        }
        if (!poly.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create polygon" };
        }
        return ShapeResult { poly.Wire(), true, "" };
    }

    static ShapeResult facesToSolid(const std::vector<TopoDS_Face>& faces)
    {
        TopoDS_Shell shell;
        BRep_Builder shellBuilder;
        shellBuilder.MakeShell(shell);
        for (const auto& face : faces) {
            shellBuilder.Add(shell, face);
        }

        BRepBuilderAPI_MakeSolid solidBuilder(shell);
        if (!solidBuilder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create solid" };
        }

        return ShapeResult { solidBuilder.Solid(), true, "" };
    }

    static ShapeResult cylinder(const Vector3& normal, const Vector3& center, double radius, double height)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        BRepPrimAPI_MakeCylinder cylinder(ax2, radius, height);
        cylinder.Build();
        if (!cylinder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create cylinder" };
        }
        return ShapeResult { cylinder.Solid(), true, "" };
    }

    static ShapeResult sweep(const ShapeArray& sections, const TopoDS_Wire& path, bool isFrenet, bool isForceC1)
    {
        BRepOffsetAPI_MakePipeShell pipe(path);
        if (isFrenet) {
            pipe.SetMode(isFrenet);
        }

        if (isForceC1) {
            pipe.SetTransitionMode(BRepBuilderAPI_RoundCorner);
            pipe.SetForceApproxC1(isForceC1);
        } else {
            pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
        }

        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(sections);
        for (const auto& shape : shapesVec) {
            pipe.Add(shape);
        }

        pipe.Build();
        pipe.MakeSolid();

        if (!pipe.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to sweep profile" };
        }
        return ShapeResult { pipe.Shape(), true, "" };
    }

    static ShapeResult revolve(const TopoDS_Shape& profile, const Ax1& axis, double rad)
    {
        BRepPrimAPI_MakeRevol revol(profile, Ax1::toAx1(axis), rad);
        if (!revol.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to revolve profile" };
        }
        return ShapeResult { revol.Shape(), true, "" };
    }

    static TrackedShapeResult revolveTracked(const TopoDS_Shape& profile, const Ax1& axis, double rad)
    {
        BRepPrimAPI_MakeRevol revol(profile, Ax1::toAx1(axis), rad);
        if (!revol.IsDone()) {
            return TrackedShapeResult { TopoDS_Shape(), false, "Failed to revolve profile", {}, {} };
        }
        return TrackedShapeResult { revol.Shape(), true, "", faceHistory(revol, profile, revol.Shape()),
            edgeHistory(revol, profile, revol.Shape()) };
    }

    static ShapeResult prism(const TopoDS_Shape& profile, const Vector3& vec)
    {
        gp_Vec vec3 = Vector3::toVec(vec);
        BRepPrimAPI_MakePrism prism(profile, vec3);
        if (!prism.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create prism" };
        }
        return ShapeResult { prism.Shape(), true, "" };
    }

    static TrackedShapeResult prismTracked(const TopoDS_Shape& profile, const Vector3& vec)
    {
        gp_Vec vec3 = Vector3::toVec(vec);
        BRepPrimAPI_MakePrism prism(profile, vec3);
        if (!prism.IsDone()) {
            return TrackedShapeResult { TopoDS_Shape(), false, "Failed to create prism", {}, {} };
        }
        return TrackedShapeResult { prism.Shape(), true, "", faceHistory(prism, profile, prism.Shape()),
            edgeHistory(prism, profile, prism.Shape()) };
    }

    static ShapeResult pushPull(const TopoDS_Shape& sbase, const TopoDS_Shape& pbase, const Vector3& vec)
    {
        gp_Vec v = Vector3::toVec(vec);
        gp_Trsf trsf;
        trsf.SetTranslation(v);
        BRepBuilderAPI_Transform transform(trsf);
        transform.Perform(pbase);
        gp_Dir dir(v);
        auto sur = BRep_Tool::Surface(TopoDS::Face(pbase));
        auto plane = Handle(Geom_Plane)::DownCast(sur);
        auto method = plane->Pln().Axis().Direction().Dot(dir) > 0 ? 1 : 0;
        if (pbase.Orientation() == TopAbs_REVERSED) {
            method = 1 - method;
        }
        BRepFeat_MakePrism prism(sbase, pbase, TopoDS::Face(transform.Shape()), dir, method, false);
        prism.Perform(v.Magnitude());
        if (!prism.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create prism" };
        }
        return ShapeResult { prism.Shape(), true, "" };
    }

    static ShapeResult polygon(const Vector3Array& points)
    {
        std::vector<Vector3> vector3s = vecFromJSArray<Vector3>(points);
        std::vector<gp_Pnt> pnts;
        for (auto& p : vector3s) {
            pnts.push_back(Vector3::toPnt(p));
        }
        return pointsToWire(pnts);
    }

    static ShapeResult arc(const Vector3& normal, const Vector3& center, const Vector3& start, double rad)
    {
        gp_Pnt centerPnt = Vector3::toPnt(center);
        gp_Pnt startPnt = Vector3::toPnt(start);
        gp_Dir xvec = gp_Dir(startPnt.XYZ() - centerPnt.XYZ());
        gp_Ax2 ax2(centerPnt, Vector3::toDir(normal), xvec);
        gp_Circ circ(ax2, centerPnt.Distance(startPnt));
        double startAng(0), endAng(rad);
        if (rad < 0) {
            startAng = Math::PI_2 + rad;
            endAng = Math::PI_2;
        }
        BRepBuilderAPI_MakeEdge edge(circ, startAng, endAng);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create arc" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult circle(const Vector3& normal, const Vector3& center, double radius)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        gp_Circ circ(ax2, radius);
        BRepBuilderAPI_MakeEdge edge(circ);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create circle" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult rect(const Pln& pln, double width, double height)
    {
        BRepBuilderAPI_MakeFace makeFace(Pln::toPln(pln), 0, width, 0, height);
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create rectangle" };
        }
        return ShapeResult { makeFace.Face(), true, "" };
    }

    static ShapeResult bezier(const Vector3Array& points, const NumberArray& weights)
    {
        std::vector<Vector3> pts = vecFromJSArray<Vector3>(points);
        NCollection_Array1<gp_Pnt> arrayofPnt(1, pts.size());
        for (int i = 0; i < pts.size(); i++) {
            arrayofPnt.SetValue(i + 1, Vector3::toPnt(pts[i]));
        }

        std::vector<double> wts = vecFromJSArray<double>(weights);
        NCollection_Array1<double> arrayOfWeight(1, wts.size());
        for (int i = 0; i < wts.size(); i++) {
            arrayOfWeight.SetValue(i + 1, wts[i]);
        }

        Handle(Geom_Curve) curve = wts.size() > 0 ? new Geom_BezierCurve(arrayofPnt, arrayOfWeight) : new Geom_BezierCurve(arrayofPnt);
        BRepBuilderAPI_MakeEdge edge(curve);
        if (!edge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create bezier" };
        }
        return ShapeResult { edge.Edge(), true, "" };
    }

    static ShapeResult helix(
        const Vector3& origin,
        const Vector3& normal,
        const Vector3& xDir,
        double radius,
        double pitch,
        double angle)
    {
        if (radius < Precision::Confusion()) {
            return ShapeResult { TopoDS_Shape(), false, "The radius is too small." };
        }
        if (std::abs(pitch) < Precision::Confusion()) {
            return ShapeResult { TopoDS_Shape(), false, "The pitch is too small." };
        }
        if (std::abs(angle) < Precision::Angular()) {
            return ShapeResult { TopoDS_Shape(), false, "The angle is too small." };
        }

        gp_Ax3 axis(Vector3::toPnt(origin), Vector3::toDir(normal), Vector3::toDir(xDir));

        NCollection_Array1<double> pitches(1, 1);
        pitches(1) = pitch;
        NCollection_Array1<double> nbTurns(1, 1);
        nbTurns(1) = std::abs(angle) / Math::PI_2;

        HelixBRep_BuilderHelix helixBuilder;
        helixBuilder.SetParameters(axis, 2.0 * radius, pitches, nbTurns);
        helixBuilder.Perform();

        if (helixBuilder.ErrorStatus() != 0) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create helix" };
        }

        return ShapeResult { helixBuilder.Shape(), true, "" };
    }

    static ShapeResult point(const Vector3& point)
    {
        BRepBuilderAPI_MakeVertex makeVertex(Vector3::toPnt(point));
        if (!makeVertex.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create point" };
        }
        return ShapeResult { makeVertex.Vertex(), true, "" };
    }

    static ShapeResult line(const Vector3& start, const Vector3& end)
    {
        BRepBuilderAPI_MakeEdge makeEdge(Vector3::toPnt(start), Vector3::toPnt(end));
        if (!makeEdge.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create line" };
        }
        return ShapeResult { makeEdge.Edge(), true, "" };
    }

    struct EdgeEndpoints {
        gp_Pnt first;
        gp_Pnt last;
    };

    // Returns the unused edge whose endpoint is nearest to either chain end within confusion
    // tolerance, or ends.size() when nothing connects. `prepend` selects the chain end to
    // extend, `reversed` tells whether the edge must be flipped to continue the chain.
    static size_t nextChainEdge(
        const std::vector<EdgeEndpoints>& ends,
        const std::vector<bool>& used,
        const gp_Pnt& front,
        const gp_Pnt& back,
        bool& prepend,
        bool& reversed)
    {
        size_t next = ends.size();
        double best = Precision::Confusion() * Precision::Confusion();
        for (size_t i = 0; i < ends.size(); i++) {
            if (used[i]) {
                continue;
            }
            auto tryCandidate = [&](double squareDistance, bool candidatePrepend, bool candidateReversed) {
                if (squareDistance < best) {
                    best = squareDistance;
                    next = i;
                    prepend = candidatePrepend;
                    reversed = candidateReversed;
                }
            };
            tryCandidate(back.SquareDistance(ends[i].first), false, false);
            tryCandidate(back.SquareDistance(ends[i].last), false, true);
            tryCandidate(front.SquareDistance(ends[i].last), true, false);
            tryCandidate(front.SquareDistance(ends[i].first), true, true);
        }
        return next;
    }

    // Chains edges into a wire deterministically: start from the first edge, then repeatedly
    // extend the chain at whichever end has the nearest connecting edge, reversing edges
    // that connect backwards. Extending at both ends is required because the first edge may
    // sit anywhere along the geometric chain. ShapeAnalysis_WireOrder was dropped: with
    // near-coincident endpoints (e.g. edges from an offset curve) it could assign a wrong
    // orientation, twisting the wire.
    static bool orderEdge(const std::vector<TopoDS_Edge>& edges, std::vector<TopoDS_Edge>& ordered)
    {
        ShapeAnalysis_Edge analysis;
        std::vector<EdgeEndpoints> ends;
        ends.reserve(edges.size());
        for (const auto& edge : edges) {
            ends.push_back(
                { BRep_Tool::Pnt(analysis.FirstVertex(edge)), BRep_Tool::Pnt(analysis.LastVertex(edge)) });
        }

        std::vector<bool> used(edges.size(), false);
        used[0] = true;
        std::deque<std::pair<size_t, bool>> chain; // (edge index, reversed)
        chain.emplace_back(0, false);
        gp_Pnt front = ends[0].first;
        gp_Pnt back = ends[0].last;

        for (size_t count = 1; count < edges.size(); count++) {
            bool prepend = false;
            bool reversed = false;
            size_t next = nextChainEdge(ends, used, front, back, prepend, reversed);
            if (next == edges.size()) {
                return false; // remaining edges are disconnected from the chain
            }
            if (prepend) {
                chain.emplace_front(next, reversed);
                front = reversed ? ends[next].last : ends[next].first;
            } else {
                chain.emplace_back(next, reversed);
                back = reversed ? ends[next].first : ends[next].last;
            }
            used[next] = true;
        }

        ordered.reserve(edges.size());
        for (const auto& [index, reversed] : chain) {
            TopoDS_Edge edge = edges[index];
            if (reversed) {
                edge.Reverse();
            }
            ordered.push_back(edge);
        }
        return true;
    }

    static ShapeResult wire(const EdgeArray& edges)
    {
        std::vector<TopoDS_Edge> edgesVec = vecFromJSArray<TopoDS_Edge>(edges);
        if (edgesVec.size() == 0) {
            return ShapeResult { TopoDS_Shape(), false, "No edges provided" };
        }

        // BRepBuilderAPI_MakeWire replaces coincident vertices of the added edges in place
        // (vertex sharing). Repeated calls with the same input edges would progressively
        // corrupt them, so build from copies instead.
        std::vector<TopoDS_Edge> copies;
        copies.reserve(edgesVec.size());
        for (auto& edge : edgesVec) {
            copies.push_back(TopoDS::Edge(BRepBuilderAPI_Copy(edge).Shape()));
        }

        BRepBuilderAPI_MakeWire wire;
        if (copies.size() == 1) {
            wire.Add(copies[0]);
        } else {
            std::vector<TopoDS_Edge> ordered;
            if (!orderEdge(copies, ordered)) {
                return ShapeResult { TopoDS_Shape(), false, mapBuildWireError(BRepBuilderAPI_DisconnectedWire) };
            }
            for (const auto& edge : ordered) {
                wire.Add(edge);
            }
        }

        if (!wire.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, mapBuildWireError(wire.Error()) };
        }
        return ShapeResult { wire.Wire(), true, "" };
    }

    static ShapeResult face(const WireArray& wires)
    {
        std::vector<TopoDS_Wire> wiresVec = vecFromJSArray<TopoDS_Wire>(wires);
        BRepBuilderAPI_MakeFace makeFace(wiresVec[0]);
        for (int i = 1; i < wiresVec.size(); i++) {
            makeFace.Add(wiresVec[i]);
        }
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face" };
        }

        ShapeFix_Face faceFix(makeFace.Face());
        faceFix.FixOrientation();
        faceFix.Perform();

        return ShapeResult { faceFix.Face(), true, "" };
    }

    static ShapeResult faceFromSurface(const WireArray& wires, const TopoDS_Face& sourceFace)
    {
        std::vector<TopoDS_Wire> wiresVec = vecFromJSArray<TopoDS_Wire>(wires);
        Handle(Geom_Surface) surface = BRep_Tool::Surface(sourceFace);
        for (auto& w : wiresVec) {
            ShapeFix_Wire sfw(w, sourceFace, Precision::Confusion());
            sfw.FixReorder();
            sfw.FixConnected();
            sfw.Perform();
            w = sfw.Wire();
        }

        BRepBuilderAPI_MakeFace makeFace(surface, wiresVec[0]);
        for (int i = 1; i < wiresVec.size(); i++) {
            makeFace.Add(wiresVec[i]);
        }
        if (!makeFace.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create face from surface" };
        }

        TopoDS_Face result = makeFace.Face();

        // Rebuild pcurves on the new face — missing pcurves cause mesh defects.
        BRepLib::BuildCurves3d(result, Precision::Confusion());

        ShapeFix_Face faceFix(result);
        faceFix.FixOrientation();
        faceFix.Perform();

        return ShapeResult { faceFix.Face(), true, "" };
    }

    static ShapeResult shell(const FaceArray& faces)
    {
        std::vector<TopoDS_Face> facesVec = vecFromJSArray<TopoDS_Face>(faces);

        TopoDS_Shell shell;
        BRep_Builder shellBuilder;
        shellBuilder.MakeShell(shell);
        for (const auto& face : facesVec) {
            shellBuilder.Add(shell, face);
        }

        return ShapeResult { shell, true, "" };
    }

    static ShapeResult solid(const ShellArray& shells)
    {
        std::vector<TopoDS_Shell> shellsVec = vecFromJSArray<TopoDS_Shell>(shells);

        BRepBuilderAPI_MakeSolid makeSolid;
        for (auto shell : shellsVec) {
            makeSolid.Add(shell);
        }
        if (!makeSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create solid" };
        }
        return ShapeResult { makeSolid.Solid(), true, "" };
    }

    static ShapeResult makeThickSolidBySimple(const TopoDS_Shape& shape, double thickness)
    {
        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidBySimple(shape, thickness);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create thick solid" };
        }
        return ShapeResult { makeThickSolid.Shape(), true, "" };
    }

    static ShapeResult makeThickSolidByJoin(const TopoDS_Shape& shape,
        const ShapeArray& shapes,
        double thickness,
        const GeomAbs_JoinType& joinType,
        const BRepOffset_Mode& mode,
        bool intersection)
    {
        auto shapesList = shapeArrayToListOfShape(shapes);

        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidByJoin(shape, shapesList, thickness, 1e-6, mode, intersection, false, joinType);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create thick solid" };
        }
        return ShapeResult { makeThickSolid.Shape(), true, "" };
    }

    // Removes every edge of `shape` that is not in `keepShapes` through the given
    // ReShape. Returns true if at least one edge was removed.
    static bool removeNonKeptEdges(
        BRepTools_ReShape& reshape,
        const TopoDS_Shape& shape,
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keepShapes)
    {
        bool removed = false;
        for (TopExp_Explorer edgeExplorer(shape, TopAbs_EDGE); edgeExplorer.More(); edgeExplorer.Next()) {
            if (!keepShapes.Contains(edgeExplorer.Current())) {
                reshape.Remove(edgeExplorer.Current());
                removed = true;
            }
        }
        return removed;
    }

    // Splitting a face with an edge that ends inside the face leaves a dangling "spur"
    // edge as an open internal wire. UnifySameDomain cannot remove it, and the shared
    // vertex also blocks unification of the collinear boundary edges it touches. Such
    // open internal wires are invalid as holes, so drop them before unifying. A spur
    // wire is dropped entirely only when none of its edges is requested to be kept;
    // otherwise only the edges that are not in keepShapes are removed from it.
    // Returns true if anything was removed from `face`.
    static bool removeSpurWires(
        BRepTools_ReShape& reshape,
        const TopoDS_Shape& face,
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keepShapes)
    {
        TopExp_Explorer wireExplorer(face, TopAbs_WIRE);
        if (!wireExplorer.More()) {
            return false;
        }
        bool removed = false;
        // The first wire is the outer boundary and is always kept.
        for (wireExplorer.Next(); wireExplorer.More(); wireExplorer.Next()) {
            const TopoDS_Shape& wire = wireExplorer.Current();
            if (BRep_Tool::IsClosed(wire)) {
                continue;
            }
            bool hasKeptEdge = false;
            for (TopExp_Explorer edgeExplorer(wire, TopAbs_EDGE); edgeExplorer.More(); edgeExplorer.Next()) {
                if (keepShapes.Contains(edgeExplorer.Current())) {
                    hasKeptEdge = true;
                    break;
                }
            }
            if (!hasKeptEdge) {
                reshape.Remove(wire);
                removed = true;
            } else if (removeNonKeptEdges(reshape, wire, keepShapes)) {
                removed = true;
            }
        }
        return removed;
    }

    // Returns true when `face` has at least one edge and every boundary edge is in `keepShapes`.
    static bool isFullyKeptFace(
        const TopoDS_Shape& face,
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keepShapes)
    {
        bool hasEdge = false;
        for (TopExp_Explorer edgeExplorer(face, TopAbs_EDGE); edgeExplorer.More(); edgeExplorer.Next()) {
            if (!keepShapes.Contains(edgeExplorer.Current())) {
                return false;
            }
            hasEdge = true;
        }
        return hasEdge;
    }

    // Prepares `shape` for UnifySameDomain in a single traversal with a single ReShape:
    // drops spur wires (see removeSpurWires) and detaches faces that are fully bounded
    // by kept edges. Such faces must survive unification as separate faces: with
    // AllowInternalEdges enabled, UnifySameDomain would otherwise merge them into their
    // same-domain neighbors and demote the kept edges to internal edges of the merged
    // face. Detached faces are appended to `protectedFaces`; the caller sews them back
    // after unifying. A fully kept face needs no spur check: every edge of it is kept,
    // so spur removal would be a no-op for it anyway.
    static TopoDS_Shape preprocessForUnify(
        const TopoDS_Shape& shape,
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keepShapes,
        NCollection_List<TopoDS_Shape>& protectedFaces)
    {
        BRepTools_ReShape reshape;
        bool modified = false;
        for (TopExp_Explorer faceExplorer(shape, TopAbs_FACE); faceExplorer.More(); faceExplorer.Next()) {
            const TopoDS_Shape& face = faceExplorer.Current();
            if (!keepShapes.IsEmpty() && isFullyKeptFace(face, keepShapes)) {
                reshape.Remove(face);
                protectedFaces.Append(face);
                modified = true;
                continue;
            }
            modified |= removeSpurWires(reshape, face, keepShapes);
        }
        return modified ? reshape.Apply(shape) : shape;
    }

    static ShapeResult simplifyShape(
        const TopoDS_Shape& shape,
        const bool theUnifyEdges,
        const bool theUnifyFaces,
        const ShapeArray& keepShapes,
        double linearTolerance,
        double angularTolerance)
    {
        auto keepShapesList = shapeArrayToMapOfShape(keepShapes);

        NCollection_List<TopoDS_Shape> protectedFaces;
        TopoDS_Shape input = preprocessForUnify(shape, keepShapesList, protectedFaces);
        if (!protectedFaces.IsEmpty() && !TopExp_Explorer(input, TopAbs_FACE).More()) {
            // Every face is fully bounded by kept edges; nothing can be unified.
            return ShapeResult { shape, true, "" };
        }

        ShapeUpgrade_UnifySameDomain anUnifier(input, theUnifyEdges, theUnifyFaces, true);
        anUnifier.SetLinearTolerance(linearTolerance);
        anUnifier.SetAngularTolerance(angularTolerance);
        anUnifier.KeepShapes(keepShapesList);
        if (!keepShapesList.IsEmpty()) {
            anUnifier.AllowInternalEdges(true);
        }
        anUnifier.Build();

        TopoDS_Shape result = anUnifier.Shape();
        if (!protectedFaces.IsEmpty()) {
            BRepBuilderAPI_Sewing sewing;
            sewing.Add(result);
            for (const auto& face : protectedFaces) {
                sewing.Add(face);
            }
            sewing.Perform();
            result = sewing.SewedShape();
            if (result.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(result)) {
                BRepBuilderAPI_MakeSolid makeSolid(TopoDS::Shell(result));
                if (makeSolid.IsDone()) {
                    result = makeSolid.Solid();
                }
            }
        }
        return ShapeResult { result, true, "" };
    }

    static ShapeResult booleanOperate(BRepAlgoAPI_BooleanOperation& boolOperater, const ShapeArray& args,
        const ShapeArray& tools)
    {
        auto argsList = shapeArrayToListOfShape(args);
        auto toolsList = shapeArrayToListOfShape(tools);

        boolOperater.SetToFillHistory(false);
        boolOperater.SetArguments(argsList);
        boolOperater.SetTools(toolsList);
        boolOperater.SetFuzzyValue(1e-6);
        boolOperater.Build();

        if (!boolOperater.IsDone()) {
            std::ostringstream oss;
            boolOperater.DumpErrors(oss);
            return ShapeResult { TopoDS_Shape(), false, oss.str() };
        }

        return ShapeResult { boolOperater.Shape(), true, "" };
    }

    static ShapeResult booleanCommon(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Common api;
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanCut(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Cut api;
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanFuse(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Fuse api;
        return booleanOperate(api, args, tools);
    }

    static TopoDS_Compound compoundOf(const std::vector<TopoDS_Shape>& shapes)
    {
        TopoDS_Compound compound;
        BRep_Builder builder;
        builder.MakeCompound(compound);
        for (auto shape : shapes) {
            builder.Add(compound, shape);
        }
        return compound;
    }

    // Unlike booleanOperate, history filling stays enabled — it is the whole point here.
    // The history input enumerates args then tools, so output indexes >= arg face count
    // originate from a tool body. `simplify` unifies same-domain faces (as the untracked
    // fuse path does); OCCT merges the simplification into the operation history.
    static TrackedShapeResult booleanOperateTracked(BRepAlgoAPI_BooleanOperation& boolOperater,
        const ShapeArray& args, const ShapeArray& tools, bool simplify)
    {
        auto argsList = shapeArrayToListOfShape(args);
        auto toolsList = shapeArrayToListOfShape(tools);

        boolOperater.SetArguments(argsList);
        boolOperater.SetTools(toolsList);
        boolOperater.SetFuzzyValue(1e-6);
        boolOperater.Build();

        if (!boolOperater.IsDone()) {
            std::ostringstream oss;
            boolOperater.DumpErrors(oss);
            return TrackedShapeResult { TopoDS_Shape(), false, oss.str(), {}, {} };
        }

        // SimplifyResult runs after Build; it merges the unification into the history.
        if (simplify) {
            boolOperater.SimplifyResult(true, true);
        }

        TopoDS_Compound inputCompound;
        {
            std::vector<TopoDS_Shape> inputs = vecFromJSArray<TopoDS_Shape>(args);
            auto toolVec = vecFromJSArray<TopoDS_Shape>(tools);
            inputs.insert(inputs.end(), toolVec.begin(), toolVec.end());
            inputCompound = compoundOf(inputs);
        }
        return TrackedShapeResult { boolOperater.Shape(), true, "",
            faceHistory(boolOperater, inputCompound, boolOperater.Shape()),
            edgeHistory(boolOperater, inputCompound, boolOperater.Shape()) };
    }

    static TrackedShapeResult booleanCommonTracked(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Common api;
        return booleanOperateTracked(api, args, tools, false);
    }

    static TrackedShapeResult booleanCutTracked(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Cut api;
        return booleanOperateTracked(api, args, tools, false);
    }

    static TrackedShapeResult booleanFuseTracked(const ShapeArray& args, const ShapeArray& tools)
    {
        BRepAlgoAPI_Fuse api;
        return booleanOperateTracked(api, args, tools, true);
    }

    static ShapeResult combine(const ShapeArray& shapes)
    {
        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(shapes);
        return ShapeResult { compoundOf(shapesVec), true, "" };
    }

    static ShapeResult fillet(const TopoDS_Shape& shape, const NumberArray& edges, double radius)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeFillet makeFillet(shape);
        for (auto edge : edgeVec) {
            makeFillet.Add(radius, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeFillet.Build();
        if (!makeFillet.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to fillet" };
        }

        return ShapeResult { makeFillet.Shape(), true, "" };
    }

    static TrackedShapeResult filletTracked(const TopoDS_Shape& shape, const NumberArray& edges, double radius)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeFillet makeFillet(shape);
        for (auto edge : edgeVec) {
            makeFillet.Add(radius, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeFillet.Build();
        if (!makeFillet.IsDone()) {
            return TrackedShapeResult { TopoDS_Shape(), false, "Failed to fillet", {}, {} };
        }

        return TrackedShapeResult { makeFillet.Shape(), true, "", faceHistory(makeFillet, shape, makeFillet.Shape()),
            edgeHistory(makeFillet, shape, makeFillet.Shape()) };
    }

    static ShapeResult chamfer(const TopoDS_Shape& shape, const NumberArray& edges, double distance)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeChamfer makeChamfer(shape);
        for (auto edge : edgeVec) {
            makeChamfer.Add(distance, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeChamfer.Build();
        if (!makeChamfer.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to chamfer" };
        }
        return ShapeResult { makeChamfer.Shape(), true, "" };
    }

    static TrackedShapeResult chamferTracked(const TopoDS_Shape& shape, const NumberArray& edges, double distance)
    {
        std::vector<int> edgeVec = vecFromJSArray<int>(edges);

        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);

        BRepFilletAPI_MakeChamfer makeChamfer(shape);
        for (auto edge : edgeVec) {
            makeChamfer.Add(distance, TopoDS::Edge(edgeMap.FindKey(edge + 1)));
        }
        makeChamfer.Build();
        if (!makeChamfer.IsDone()) {
            return TrackedShapeResult { TopoDS_Shape(), false, "Failed to chamfer", {}, {} };
        }

        return TrackedShapeResult { makeChamfer.Shape(), true, "", faceHistory(makeChamfer, shape, makeChamfer.Shape()),
            edgeHistory(makeChamfer, shape, makeChamfer.Shape()) };
    }

    static ShapeResult fillet2d(const TopoDS_Face& face, const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double radius)
    {
        TopoDS_Vertex commonVertex = findCommonVertex(edge1, edge2);
        if (commonVertex.IsNull()) {
            return ShapeResult { TopoDS_Shape(), false, "Edges must share a common vertex" };
        }

        ChFi2d_Builder builder(face);
        builder.AddFillet(commonVertex, radius);
        if (builder.Status() != ChFi2d_IsDone) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create 2D fillet" };
        }

        return ShapeResult { builder.Result(), true, "" };
    }

    static ShapesResult filletEdge2d(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double radius)
    {
        std::string error;
        auto corner = computeCornerPlane(edge1, edge2, error);
        if (!corner.has_value()) {
            return ShapesResult { ShapeArray(val::array()), false, error };
        }

        double f1, l1, f2, l2;
        Handle(Geom_Curve) c1 = basisCurve(edge1, f1, l1);
        Handle(Geom_Curve) c2 = basisCurve(edge2, f2, l2);
        TopoDS_Edge e1 = edgeThroughCorner(c1, f1, l1, corner->param1);
        TopoDS_Edge e2 = edgeThroughCorner(c2, f2, l2, corner->param2);

        gp_Pln plane(corner->point, corner->normal);
        ChFi2d_FilletAPI fillet(e1, e2, plane);
        if (!fillet.Perform(radius)) {
            return ShapesResult { ShapeArray(val::array()), false, "Failed to create 2D fillet" };
        }
        TopoDS_Edge newE1, newE2;
        TopoDS_Edge filletEdge = fillet.Result(corner->point, newE1, newE2);
        if (filletEdge.IsNull()) {
            return ShapesResult { ShapeArray(val::array()), false, "Failed to get fillet result" };
        }

        gp_Pnt arcStart, arcEnd;
        edgeEndPoints(filletEdge, arcStart, arcEnd);
        newE1 = edgeToFarEnd(c1, f1, l1, corner->param1, arcStart, arcEnd);
        newE2 = edgeToFarEnd(c2, f2, l2, corner->param2, arcStart, arcEnd);

        return ShapesResult { ShapeArray(buildEdgeTriple(newE1, filletEdge, newE2)), true, "" };
    }

    static ShapeResult chamfer2d(const TopoDS_Face& face, const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double distance)
    {
        ChFi2d_Builder builder(face);
        builder.AddChamfer(edge1, edge2, distance, distance);
        if (builder.Status() != ChFi2d_IsDone) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create 2D chamfer" };
        }

        return ShapeResult { builder.Result(), true, "" };
    }

    static ShapesResult chamferEdge2d(const TopoDS_Edge& edge1, const TopoDS_Edge& edge2, double distance)
    {
        std::string error;
        auto corner = computeCornerPlane(edge1, edge2, error);
        if (!corner.has_value()) {
            return ShapesResult { ShapeArray(val::array()), false, error };
        }

        double f1, l1, f2, l2;
        Handle(Geom_Curve) c1 = basisCurve(edge1, f1, l1);
        Handle(Geom_Curve) c2 = basisCurve(edge2, f2, l2);

        // for a line the parameter measures arc length, so the cut is at corner +/- distance
        double p1 = GeomAPI_ProjectPointOnCurve(corner->point, c1).LowerDistanceParameter();
        double p2 = GeomAPI_ProjectPointOnCurve(corner->point, c2).LowerDistanceParameter();

        // keep the side of the corner that contains the edge midpoint
        double cut1 = p1 + ((f1 + l1) / 2 > p1 ? distance : -distance);
        double cut2 = p2 + ((f2 + l2) / 2 > p2 ? distance : -distance);
        double end1 = cut1 > p1 ? l1 : f1;
        double end2 = cut2 > p2 ? l2 : f2;

        TopoDS_Edge newE1 = BRepBuilderAPI_MakeEdge(c1, std::min(cut1, end1), std::max(cut1, end1)).Edge();
        TopoDS_Edge newE2 = BRepBuilderAPI_MakeEdge(c2, std::min(cut2, end2), std::max(cut2, end2)).Edge();
        TopoDS_Edge chamferEdge = BRepBuilderAPI_MakeEdge(c1->Value(cut1), c2->Value(cut2)).Edge();

        return ShapesResult { ShapeArray(buildEdgeTriple(newE1, chamferEdge, newE2)), true, "" };
    }

    static ShapeResult loft(const ShapeArray& sections, bool isSolid, bool isRuled, GeomAbs_Shape continuity)
    {
        std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(sections);
        if (shapeVector.size() < 2) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft: at least 2 sections are required" };
        }
        if (shapeVector.size() == 2 && shapeVector[0].ShapeType() == TopAbs_VERTEX && shapeVector[1].ShapeType() == TopAbs_VERTEX) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft: must have at least 1 wires" };
        }

        BRepOffsetAPI_ThruSections loftBuilder(isSolid, isRuled);
        if (!isRuled) {
            loftBuilder.SetContinuity(continuity);
        }

        for (auto& profile : shapeVector) {
            if (profile.ShapeType() == TopAbs_WIRE) {
                loftBuilder.AddWire(TopoDS::Wire(profile));
            } else if (profile.ShapeType() == TopAbs_VERTEX) {
                loftBuilder.AddVertex(TopoDS::Vertex(profile));
            }
        }
        loftBuilder.Build();
        if (!loftBuilder.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to loft" };
        }
        return ShapeResult { loftBuilder.Shape(), true, "" };
    }

    static ShapeResult curveProjection(const TopoDS_Shape& curve, const TopoDS_Shape& targetFace, const gp_Dir& dir)
    {
        BRepProj_Projection curveProjection(curve, targetFace, dir);
        if (!curveProjection.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to create curve projection" };
        }
        return ShapeResult { curveProjection.Shape(), true, "" };
    }

    static ShapeResult fixShape(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_Shape fixer(shape);
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static ShapeResult fixSmallFace(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_FixSmallFace fixer;
        fixer.Init(shape);
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static ShapeResult fixSolid(const TopoDS_Shape& shape, double tolerance)
    {
        ShapeFix_Solid fixer;
        fixer.Init(TopoDS::Solid(shape));
        fixer.SetPrecision(tolerance);
        fixer.Perform();
        return ShapeResult { fixer.Shape(), true, "" };
    }

    static bool hasAnySub(const TopoDS_Shape& shape, TopAbs_ShapeEnum shapeType)
    {
        TopExp_Explorer explorer;
        explorer.Init(shape, shapeType);
        return explorer.More();
    }

    // Rebuilds `shape` with the removals recorded in `reShape`. Wires whose parent face was
    // removed are appended alongside the result, so their remaining edges are preserved.
    static TopoDS_Shape applyKeepingWires(BRepTools_ReShape& reShape,
        const TopoDS_Shape& shape,
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keptWires)
    {
        auto result = reShape.Apply(shape);
        if (keptWires.IsEmpty() && !result.IsNull()) {
            return result;
        }

        BRep_Builder builder;
        TopoDS_Compound compound;
        builder.MakeCompound(compound);
        if (!result.IsNull()) {
            builder.Add(compound, result);
        }
        for (NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>::Iterator it(keptWires); it.More(); it.Next()) {
            auto keptWire = reShape.Apply(it.Value());
            if (!keptWire.IsNull() && hasAnySub(keptWire, TopAbs_EDGE)) {
                builder.Add(compound, keptWire);
            }
        }
        return compound;
    }

    static ShapeResult removeFeature(const TopoDS_Shape& shape, const ShapeArray& faces)
    {
        std::vector<TopoDS_Shape> facesVector = vecFromJSArray<TopoDS_Shape>(faces);
        BRepAlgoAPI_Defeaturing defea;
        defea.SetShape(shape);
        for (auto& face : facesVector) {
            defea.AddFaceToRemove(face);
        }
        defea.SetRunParallel(true);
        defea.Build();
        if (!defea.IsDone()) {
            return ShapeResult { TopoDS_Shape(), false, "Failed to remove feature" };
        }
        return ShapeResult { defea.Shape(), true, "" };
    }

    static RemoveFilletResult removeFillet(const TopoDS_Shape& shape, const ShapeArray& faces)
    {
        std::vector<TopoDS_Shape> facesVector = vecFromJSArray<TopoDS_Shape>(faces);
        BRepAlgoAPI_Defeaturing defea;
        defea.SetShape(shape);
        for (auto& face : facesVector) {
            defea.AddFaceToRemove(face);
        }
        defea.SetRunParallel(true);
        defea.Build();
        if (!defea.IsDone()) {
            return RemoveFilletResult { TopoDS_Shape(), false, "Failed to remove fillet", ShapeArray(val::array()) };
        }

        val newEdges = val::array();
        TopExp_Explorer explorer;
        for (explorer.Init(shape, TopAbs_FACE); explorer.More(); explorer.Next()) {
            auto face = TopoDS::Face(explorer.Current());
            auto list = defea.Generated(face);
            for (auto& s : list) {
                newEdges.call<void>("push", s);
            }
        }
        return RemoveFilletResult { defea.Shape(), true, "", ShapeArray(newEdges) };
    }

    // A face referencing a removed edge becomes invalid: drop it, but keep its
    // wires so the remaining edges are preserved.
    static void removeFacesUsingEdge(BRepTools_ReShape& reShape,
        const NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>& mapEF,
        const TopoDS_Shape& edge,
        NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& removedFaces,
        NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& keptWires)
    {
        if (!mapEF.Contains(edge)) {
            return;
        }
        for (const auto& face : mapEF.FindFromKey(edge)) {
            if (!removedFaces.Add(face)) {
                continue;
            }
            reShape.Remove(face);
            for (TopExp_Explorer explorer(face, TopAbs_WIRE); explorer.More(); explorer.Next()) {
                keptWires.Add(explorer.Current());
            }
        }
    }

    static ShapeResult removeSubShape(const TopoDS_Shape& shape, const ShapeArray& subShapes)
    {
        std::vector<TopoDS_Shape> subShapesVector = vecFromJSArray<TopoDS_Shape>(subShapes);
        if (subShapesVector.empty()) {
            return ShapeResult { shape, false, "Not remove anything" };
        }

        NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> mapEF;
        TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, mapEF);

        BRepTools_ReShape reShape;
        NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> removedFaces; // dedupe faces dropped because one of their edges was removed
        NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> keptWires;
        for (const auto& subShape : subShapesVector) {
            reShape.Remove(subShape);
            if (subShape.ShapeType() != TopAbs_EDGE) {
                continue;
            }
            removeFacesUsingEdge(reShape, mapEF, subShape, removedFaces, keptWires);
        }

        TopoDS_Shape result = applyKeepingWires(reShape, shape, keptWires);
        if (result.IsSame(shape)) {
            return ShapeResult { shape, false, "Not remove anything" };
        }

        return ShapeResult { result, true, "" };
    }

    static ShapeResult replaceSubShapes(const TopoDS_Shape& shape,
        const ShapeArray& oldShapes, const ShapeArray& newShapes)
    {
        NCollection_Sequence<TopoDS_Shape> oldSeq = shapeArrayToSequenceOfShape(oldShapes);
        NCollection_Sequence<TopoDS_Shape> newSeq = shapeArrayToSequenceOfShape(newShapes);

        BRepTools_ReShape reShape;
        for (int i = 1; i <= oldSeq.Length() && i <= newSeq.Length(); i++) {
            reShape.Replace(oldSeq.Value(i), newSeq.Value(i));
        }

        return ShapeResult { reShape.Apply(shape), true, "" };
    }

    static ShapeResult sewing(const ShapeArray& shapes)
    {
        std::vector<TopoDS_Shape> shapeVector = emscripten::vecFromJSArray<TopoDS_Shape>(shapes);

        BRepBuilderAPI_Sewing sewing;
        for (auto& shape : shapeVector) {
            sewing.Add(shape);
        }
        sewing.Perform();

        TopoDS_Shape result = sewing.SewedShape();
        if (result.ShapeType() == TopAbs_SHELL) {
            BRepCheck_Analyzer analyzer(result);
            if (analyzer.IsValid()) {
                BRepBuilderAPI_MakeSolid mkSolid(TopoDS::Shell(result));
                if (mkSolid.IsDone())
                    result = mkSolid.Solid();
            }
        }

        return ShapeResult { result, true, "" };
    }
};

EMSCRIPTEN_BINDINGS(ShapeFactory)
{
    class_<ShapeResult>("ShapeResult")
        .property("shape", &ShapeResult::shape, return_value_policy::reference())
        .property("isOk", &ShapeResult::isOk)
        .property("error", &ShapeResult::error);

    class_<RemoveFilletResult>("RemoveFilletResult")
        .property("shape", &RemoveFilletResult::shape, return_value_policy::reference())
        .property("isOk", &RemoveFilletResult::isOk)
        .property("error", &RemoveFilletResult::error)
        .property("newEdges", &RemoveFilletResult::newEdges);

    class_<ShapesResult>("ShapesResult")
        .property("shapes", &ShapesResult::shapes)
        .property("isOk", &ShapesResult::isOk)
        .property("error", &ShapesResult::error);

    class_<TrackedShapeResult>("TrackedShapeResult")
        .property("shape", &TrackedShapeResult::shape, return_value_policy::reference())
        .property("isOk", &TrackedShapeResult::isOk)
        .property("error", &TrackedShapeResult::error)
        .property("faceMap", &TrackedShapeResult::faceMap)
        .property("edgeMap", &TrackedShapeResult::edgeMap);

    class_<ShapeFactory>("ShapeFactory")
        .class_function("box", &ShapeFactory::box)
        .class_function("cone", &ShapeFactory::cone)
        .class_function("sphere", &ShapeFactory::sphere)
        .class_function("ellipsoid", &ShapeFactory::ellipsoid)
        .class_function("ellipse", &ShapeFactory::ellipse)
        .class_function("cylinder", &ShapeFactory::cylinder)
        .class_function("pyramid", &ShapeFactory::pyramid)
        .class_function("sweep", &ShapeFactory::sweep)
        .class_function("revolve", &ShapeFactory::revolve)
        .class_function("prism", &ShapeFactory::prism)
        .class_function("pushPull", &ShapeFactory::pushPull)
        .class_function("polygon", &ShapeFactory::polygon)
        .class_function("circle", &ShapeFactory::circle)
        .class_function("arc", &ShapeFactory::arc)
        .class_function("bezier", &ShapeFactory::bezier)
        .class_function("helix", &ShapeFactory::helix)
        .class_function("rect", &ShapeFactory::rect)
        .class_function("point", &ShapeFactory::point)
        .class_function("line", &ShapeFactory::line)
        .class_function("wire", &ShapeFactory::wire)
        .class_function("face", &ShapeFactory::face)
        .class_function("faceFromSurface", &ShapeFactory::faceFromSurface)
        .class_function("shell", &ShapeFactory::shell)
        .class_function("solid", &ShapeFactory::solid)
        .class_function("makeThickSolidBySimple", &ShapeFactory::makeThickSolidBySimple)
        .class_function("makeThickSolidByJoin", &ShapeFactory::makeThickSolidByJoin)
        .class_function("simplifyShape", &ShapeFactory::simplifyShape)
        .class_function("booleanCommon", &ShapeFactory::booleanCommon)
        .class_function("booleanCut", &ShapeFactory::booleanCut)
        .class_function("booleanFuse", &ShapeFactory::booleanFuse)
        .class_function("combine", &ShapeFactory::combine)
        .class_function("fillet", &ShapeFactory::fillet)
        .class_function("chamfer", &ShapeFactory::chamfer)
        .class_function("revolveTracked", &ShapeFactory::revolveTracked)
        .class_function("prismTracked", &ShapeFactory::prismTracked)
        .class_function("booleanCommonTracked", &ShapeFactory::booleanCommonTracked)
        .class_function("booleanCutTracked", &ShapeFactory::booleanCutTracked)
        .class_function("booleanFuseTracked", &ShapeFactory::booleanFuseTracked)
        .class_function("filletTracked", &ShapeFactory::filletTracked)
        .class_function("chamferTracked", &ShapeFactory::chamferTracked)
        .class_function("fillet2d", &ShapeFactory::fillet2d)
        .class_function("chamfer2d", &ShapeFactory::chamfer2d)
        .class_function("filletEdge2d", &ShapeFactory::filletEdge2d)
        .class_function("chamferEdge2d", &ShapeFactory::chamferEdge2d)
        .class_function("fixShape", &ShapeFactory::fixShape)
        .class_function("fixSmallFace", &ShapeFactory::fixSmallFace)
        .class_function("fixSolid", &ShapeFactory::fixSolid)
        .class_function("loft", &ShapeFactory::loft)
        .class_function("curveProjection", &ShapeFactory::curveProjection)
        .class_function("removeFeature", &ShapeFactory::removeFeature)
        .class_function("removeFillet", &ShapeFactory::removeFillet)
        .class_function("removeSubShape", &ShapeFactory::removeSubShape)
        .class_function("replaceSubShapes", &ShapeFactory::replaceSubShapes)
        .class_function("sewing", &ShapeFactory::sewing);
}