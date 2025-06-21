// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepExtrema_ExtCC.hxx>
#include <BRepFeat_SplitShape.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepPrim_Builder.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_JoinType.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeAnalysis.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
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

#include "shared.hpp"

using namespace emscripten;

class Shape {
public:
    static TopoDS_Shape clone(const TopoDS_Shape& shape)
    {
        BRepBuilderAPI_Copy copy(shape);
        return copy.Shape();
    }

    static bool isClosed(const TopoDS_Shape& shape)
    {
        return BRep_Tool::IsClosed(shape);
    }

    static ShapeArray findAncestor(const TopoDS_Shape& from,
        const TopoDS_Shape& subShape,
        const TopAbs_ShapeEnum& ancestorType)
    {
        TopTools_IndexedDataMapOfShapeListOfShape map;
        TopExp::MapShapesAndAncestors(from, subShape.ShapeType(), ancestorType,
            map);
        auto index = map.FindIndex(subShape);
        auto shapes = map.FindFromIndex(index);

        return ShapeArray(val::array(shapes.begin(), shapes.end()));
    }

    static ShapeArray findSubShapes(const TopoDS_Shape& shape,
        const TopAbs_ShapeEnum& shapeType)
    {
        TopTools_IndexedMapOfShape indexShape;
        TopExp::MapShapes(shape, shapeType, indexShape);

        return ShapeArray(val::array(indexShape.cbegin(), indexShape.cend()));
    }

    static ShapeArray iterShape(const TopoDS_Shape& shape)
    {
        val new_array = val::array();
        for (TopoDS_Iterator iter(shape); iter.More(); iter.Next()) {
            new_array.call<void>("push", iter.Value());
        }
        return ShapeArray(new_array);
    }

    static TopoDS_Shape sectionSS(const TopoDS_Shape& shape,
        const TopoDS_Shape& otherShape)
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

    static TopoDS_Shape splitByEdgeOrWires(const TopoDS_Shape& shape,
        const ShapeArray& splitters)
    {
        std::vector<TopoDS_Shape> shapeVector = vecFromJSArray<TopoDS_Shape>(splitters);
        TopTools_SequenceOfShape shapes;
        for (auto& s : shapeVector) {
            shapes.Append(s);
        }

        BRepFeat_SplitShape splitter(shape);
        splitter.Add(shapes);
        splitter.Build();
        return splitter.Shape();
    }

    static TopoDS_Shape removeFeature(const TopoDS_Shape& shape,
        const ShapeArray& faces)
    {
        std::vector<TopoDS_Shape> facesVector = vecFromJSArray<TopoDS_Shape>(faces);
        BRepAlgoAPI_Defeaturing defea;
        defea.SetShape(shape);
        for (auto& face : facesVector) {
            defea.AddFaceToRemove(face);
        }
        defea.SetRunParallel(true);
        defea.Build();
        return defea.Shape();
    }

    static TopoDS_Compound shapeWires(const TopoDS_Shape& shape)
    {
        BRep_Builder builder;
        TopoDS_Compound compound;
        builder.MakeCompound(compound);

        TopExp_Explorer explorer;
        for (explorer.Init(shape, TopAbs_WIRE); explorer.More(); explorer.Next()) {
            builder.Add(compound, TopoDS::Wire(explorer.Current()));
        }

        return compound;
    }

    static size_t countShape(const TopoDS_Shape& shape,
        TopAbs_ShapeEnum shapeType)
    {
        size_t size = 0;
        TopExp_Explorer explorer;
        for (explorer.Init(shape, shapeType); explorer.More(); explorer.Next()) {
            size += 1;
        }
        return size;
    }

    static bool hasOnlyOneSub(const TopoDS_Shape& shape,
        TopAbs_ShapeEnum shapeType)
    {
        size_t size = 0;
        TopExp_Explorer explorer;
        for (explorer.Init(shape, shapeType); explorer.More(); explorer.Next()) {
            size += 1;
            if (size > 1) {
                return false;
            }
        }
        return size == 1;
    }

    static TopoDS_Shape removeSubShape(TopoDS_Shape& shape,
        const ShapeArray& subShapes)
    {
        std::vector<TopoDS_Shape> subShapesVector = vecFromJSArray<TopoDS_Shape>(subShapes);

        auto source = hasOnlyOneSub(shape, TopAbs_FACE) ? shapeWires(shape) : shape;
        TopTools_IndexedDataMapOfShapeListOfShape mapEF;
        TopExp::MapShapesAndAncestors(source, TopAbs_EDGE, TopAbs_FACE, mapEF);
        BRepTools_ReShape reShape;
        for (auto& subShape : subShapesVector) {
            reShape.Remove(subShape);

            TopTools_ListOfShape faces;
            if (mapEF.FindFromKey(subShape, faces)) {
                for (auto& face : faces) {
                    reShape.Remove(face);
                }
            }
        }

        ShapeFix_Shape fixer(reShape.Apply(source));
        fixer.Perform();

        return fixer.Shape();
    }

    static TopoDS_Shape replaceSubShape(const TopoDS_Shape& shape,
        const TopoDS_Shape& subShape,
        const TopoDS_Shape& newShape)
    {
        BRepTools_ReShape reShape;
        reShape.Replace(subShape, newShape);

        ShapeFix_Shape fixer(reShape.Apply(shape));
        fixer.Perform();

        return fixer.Shape();
    }

    static TopoDS_Shape sewing(const TopoDS_Shape& shape1,
        const TopoDS_Shape& shape2)
    {
        BRepBuilderAPI_Sewing sewing;
        sewing.Add(shape1);
        sewing.Add(shape2);

        sewing.Perform();
        return sewing.SewedShape();
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
    static TopoDS_Edge fromCurve(const Geom_Curve* curve)
    {
        Handle_Geom_Curve handleCurve(curve);
        BRepBuilderAPI_MakeEdge builder(handleCurve);
        return builder.Edge();
    }

    static double curveLength(const TopoDS_Edge& edge)
    {
        GProp_GProps props;
        BRepGProp::LinearProperties(edge, props);
        return props.Mass();
    }

    static Handle_Geom_TrimmedCurve curve(const TopoDS_Edge& edge)
    {
        double start(0.0), end(0.0);
        auto curve = BRep_Tool::Curve(edge, start, end);
        Handle_Geom_TrimmedCurve trimmedCurve = new Geom_TrimmedCurve(curve, start, end);
        return trimmedCurve;
    }

    static TopoDS_Edge trim(const TopoDS_Edge& edge, double start, double end)
    {
        double u1(0.0), u2(0.0);
        auto curve = BRep_Tool::Curve(edge, u1, u2);
        BRepBuilderAPI_MakeEdge builder(curve, start, end);
        return builder.Edge();
    }

    static TopoDS_Edge offset(const TopoDS_Edge& edge,
        const gp_Dir& dir,
        double offset)
    {
        double start(0.0), end(0.0);
        auto curve = BRep_Tool::Curve(edge, start, end);
        Handle_Geom_TrimmedCurve trimmedCurve = new Geom_TrimmedCurve(curve, start, end);
        Handle_Geom_OffsetCurve offsetCurve = new Geom_OffsetCurve(trimmedCurve, offset, dir);
        BRepBuilderAPI_MakeEdge builder(offsetCurve);
        return builder.Edge();
    }

    static PointAndParameterArray intersect(const TopoDS_Edge& edge,
        const TopoDS_Edge& otherEdge)
    {
        std::vector<PointAndParameter> points;
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
    static TopoDS_Shape offset(const TopoDS_Wire& wire,
        double distance,
        const GeomAbs_JoinType& joinType)
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

    static TopoDS_Shape offset(const TopoDS_Face& face,
        double distance,
        const GeomAbs_JoinType& joinType)
    {
        BRepOffsetAPI_MakeOffset offsetter(face, joinType);
        offsetter.Perform(distance);
        if (offsetter.IsDone()) {
            return offsetter.Shape();
        }
        return TopoDS_Shape();
    }

    static Domain curveOnSurface(const TopoDS_Face& face,
        const TopoDS_Edge& edge)
    {
        double start(0.0), end(0.0);
        if (BRep_Tool::CurveOnSurface(edge, face, start, end).IsNull()) {
            return Domain();
        }
        Domain domain = { start, end };
        return domain;
    }

    static void normal(const TopoDS_Face& face,
        double u,
        double v,
        gp_Pnt& point,
        gp_Vec& normal)
    {
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

    static Handle_Geom_Surface surface(const TopoDS_Face& face)
    {
        return BRep_Tool::Surface(face);
    }
};

class Solid {
public:
    static double volume(const TopoDS_Solid& solid)
    {
        GProp_GProps props;
        BRepGProp::VolumeProperties(solid, props);
        return props.Mass();
    }
};

EMSCRIPTEN_BINDINGS(Shape)
{
    class_<Shape>("Shape")
        .class_function("clone", &Shape::clone)
        .class_function("findAncestor", &Shape::findAncestor)
        .class_function("findSubShapes", &Shape::findSubShapes)
        .class_function("iterShape", &Shape::iterShape)
        .class_function("sectionSS", &Shape::sectionSS)
        .class_function("sectionSP", &Shape::sectionSP)
        .class_function("isClosed", &Shape::isClosed)
        .class_function("splitByEdgeOrWires", &Shape::splitByEdgeOrWires)
        .class_function("removeFeature", &Shape::removeFeature)
        .class_function("removeSubShape", &Shape::removeSubShape)
        .class_function("replaceSubShape", &Shape::replaceSubShape)
        .class_function("sewing", &Shape::sewing);

    class_<Vertex>("Vertex").class_function("point", &Vertex::point);

    class_<Edge>("Edge")
        .class_function("fromCurve", &Edge::fromCurve, allow_raw_pointers())
        .class_function("curve", &Edge::curve)
        .class_function("curveLength", &Edge::curveLength)
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
        .class_function("curveOnSurface", &Face::curveOnSurface);

    class_<Solid>("Solid").class_function("volume", &Solid::volume);
}
