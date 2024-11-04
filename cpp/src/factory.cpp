#include "shared.hpp"
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <ChFi2d_AnaFilletAlgo.hxx>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <Geom_BezierCurve.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>
#include <ShapeAnalysis_WireOrder.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>

using namespace emscripten;

struct ShapeResult
{
    TopoDS_Shape shape;
    bool isOk;
    std::string error;
};

class ShapeFactory
{
public:

    static TopoDS_Edge filletEdges(TopoDS_Edge& edge1, TopoDS_Edge& edge2, gp_Pnt& point1, gp_Pnt& point2, gp_Pnt& point3, double radius)
    {
        ChFi2d_AnaFilletAlgo f = ChFi2d_AnaFilletAlgo();
        double a = ((point2.Y() - point1.Y()) * (point3.Z() - point1.Z()) - (point2.Z() - point1.Z()) * (point3.Y() - point1.Y()));
        double b = ((point2.Z() - point1.Z()) * (point3.X() - point1.X()) - (point2.X() - point1.X()) * (point3.Z() - point1.Z()));
        double c = ((point2.X() - point1.X()) * (point3.Y() - point1.Y()) - (point2.Y() - point1.Y()) * (point3.X() - point1.X()));
        double d = (0 - (a * point1.X() + b * point1.Y() + c * point1.Z()));
        f.Init(edge1, edge2, gp_Pln(a, b, c, d));
        f.Perform(radius);
        return f.Result(edge1, edge2);
    }


    static ShapeResult pipe(double outside_diameter, double wall_thickness, double bending_radius, const Vector3Array &points)
    {
        std::vector<Vector3> pts = vecFromJSArray<Vector3>(points);

        BRepBuilderAPI_MakeWire makeWire;

        std::vector<gp_Pnt> pointVec;
        std::vector<TopoDS_Edge> edgeVec;
        std::vector<TopoDS_Edge> filletVec;

        if (pts.size() == 1)
        {
            return ShapeResult{TopoDS_Shape(), false, "Please select more than one points to create a pipe"};
        }
        else if (pts.size() == 2)
        {
            gp_Pnt p1 = Vector3::toPnt(pts[0]);
            gp_Pnt p2 = Vector3::toPnt(pts[1]);
            TopoDS_Edge ed1 = BRepBuilderAPI_MakeEdge(p1, p2).Edge();
            makeWire.Add(ed1);
        }
        else
        {
            for (int index = 0; index < pts.size()-2; index = index + 1)
            {
                if (index == 0) 
                {
                    gp_Pnt p1 = Vector3::toPnt(pts[index]);
                    gp_Pnt p2 = Vector3::toPnt(pts[index+1]);
                    gp_Pnt p3 = Vector3::toPnt(pts[index+2]);
                    pointVec.push_back(p1);
                    pointVec.push_back(p2);
                    pointVec.push_back(p3);
                    TopoDS_Edge ed1 = BRepBuilderAPI_MakeEdge(p1, p2).Edge();
                    TopoDS_Edge ed2 = BRepBuilderAPI_MakeEdge(p2, p3).Edge();
                    ChFi2d_AnaFilletAlgo f = ChFi2d_AnaFilletAlgo();
                    double a = ((p2.Y() - p1.Y()) * (p3.Z() - p1.Z()) - (p2.Z() - p1.Z()) * (p3.Y() - p1.Y()));
                    double b = ((p2.Z() - p1.Z()) * (p3.X() - p1.X()) - (p2.X() - p1.X()) * (p3.Z() - p1.Z()));
                    double c = ((p2.X() - p1.X()) * (p3.Y() - p1.Y()) - (p2.Y() - p1.Y()) * (p3.X() - p1.X()));
                    double d = (0 - (a * p1.X() + b * p1.Y() + c * p1.Z()));
                    gp_Pln plane1 = gp_Pln(a, b, c, d);
                    f.Init(ed1, ed2, plane1);
                    f.Perform(bending_radius);
                    TopoDS_Edge fillet = f.Result(ed1, ed2);
                    filletVec.push_back(fillet);
                    edgeVec.push_back(ed1);
                    edgeVec.push_back(ed2);
                }
                else
                {
                    // gp_Pnt p1 = pointVec[index];
                    // gp_Pnt p2 = pointVec[index+1];
                    gp_Pnt p3 = Vector3::toPnt(pts[index+2]);
                    pointVec.push_back(p3);
                    // TopoDS_Edge ed1 = edgeVec[index];
                    TopoDS_Edge ed2 = BRepBuilderAPI_MakeEdge(pointVec[index+1], p3).Edge();
                    ChFi2d_AnaFilletAlgo f = ChFi2d_AnaFilletAlgo();
                    double a = ((pointVec[index+1].Y() - pointVec[index].Y()) * (p3.Z() - pointVec[index].Z()) - (pointVec[index+1].Z() - pointVec[index].Z()) * (p3.Y() - pointVec[index].Y()));
                    double b = ((pointVec[index+1].Z() - pointVec[index].Z()) * (p3.X() - pointVec[index].X()) - (pointVec[index+1].X() - pointVec[index].X()) * (p3.Z() - pointVec[index].Z()));
                    double c = ((pointVec[index+1].X() - pointVec[index].X()) * (p3.Y() - pointVec[index].Y()) - (pointVec[index+1].Y() - pointVec[index].Y()) * (p3.X() - pointVec[index].X()));
                    double d = (0 - (a * pointVec[index].X() + b * pointVec[index].Y() + c * pointVec[index].Z()));
                    gp_Pln plane1 = gp_Pln(a, b, c, d);
                    f.Init(edgeVec[index], ed2, plane1);
                    f.Perform(bending_radius);
                    TopoDS_Edge fillet = f.Result(edgeVec[index], ed2);
                    filletVec.push_back(fillet);
                    edgeVec.push_back(ed2);
                }

                
            }

            for (int index = 0; index < edgeVec.size(); index = index + 1)
            {
                if (index == edgeVec.size()-1)
                {
                    makeWire.Add(edgeVec[index]);
                }
                else
                {
                    makeWire.Add(edgeVec[index]);
                    makeWire.Add(filletVec[index]);
                }
            }
        }

        TopoDS_Wire wire = makeWire.Wire();
        // the pipe (outer part)
        gp_Pnt p1 = Vector3::toPnt(pts[0]);
        gp_Pnt p2 = Vector3::toPnt(pts[1]);
        gp_Dir direction = gp_Dir(p2.X() - p1.X(), p2.Y() - p1.Y(), p2.Z() - p1.Z());
        gp_Circ circle_out = gp_Circ(gp_Ax2(p1, direction), outside_diameter/2);
        TopoDS_Edge profile_edge_out = BRepBuilderAPI_MakeEdge(circle_out).Edge();
        TopoDS_Wire profile_wire_out = BRepBuilderAPI_MakeWire(profile_edge_out).Wire();
        TopoDS_Face profile_face_out = BRepBuilderAPI_MakeFace(profile_wire_out).Face();
        TopoDS_Shape pipe_out = BRepOffsetAPI_MakePipe(wire, profile_face_out).Shape();
        // the pipe (inner part)
        gp_Circ circle_inner = gp_Circ(gp_Ax2(p1, direction), outside_diameter/2-wall_thickness);
        TopoDS_Edge profile_edge_inner = BRepBuilderAPI_MakeEdge(circle_inner).Edge();
        TopoDS_Wire profile_wire_inner = BRepBuilderAPI_MakeWire(profile_edge_inner).Wire();
        TopoDS_Face profile_face_inner = BRepBuilderAPI_MakeFace(profile_wire_inner).Face();
        TopoDS_Shape pipe_inner = BRepOffsetAPI_MakePipe(wire, profile_face_inner).Shape();
        // cut the inner part from the outer part
        TopoDS_Shape pipe_cut = BRepAlgoAPI_Cut(pipe_out, pipe_inner).Shape();

        if (!makeWire.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create pipe"};
        }

        return ShapeResult{pipe_cut, true, ""};
    }

    static ShapeResult box(const Ax3 &ax3, double x, double y, double z)
    {
        gp_Pln pln = Ax3::toPln(ax3);
        BRepBuilderAPI_MakeFace makeFace(pln, 0, x, 0, y);
        if (!makeFace.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create box"};
        }

        gp_Vec vec(pln.Axis().Direction());
        vec.Multiply(z);
        BRepPrimAPI_MakePrism box(makeFace.Face(), vec);
        if (!box.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create box"};
        }
        return ShapeResult{box.Shape(), true, ""};
    }

    static ShapeResult sweep(const TopoDS_Shape &profile, const TopoDS_Wire &wire)
    {
        BRepOffsetAPI_MakePipe pipe(wire, profile);
        if (!pipe.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to sweep profile"};
        }
        return ShapeResult{pipe.Shape(), true, ""};
    }

    static ShapeResult revolve(const TopoDS_Shape &profile, const Ax1 &axis, double rad)
    {
        BRepPrimAPI_MakeRevol revol(profile, Ax1::toAx1(axis), rad);
        if (!revol.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to revolve profile"};
        }
        return ShapeResult{revol.Shape(), true, ""};
    }

    static ShapeResult prism(const TopoDS_Shape &profile, const Vector3 &vec)
    {
        gp_Vec vec3 = Vector3::toVec(vec);
        BRepPrimAPI_MakePrism prism(profile, vec3);
        if (!prism.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create prism"};
        }
        return ShapeResult{prism.Shape(), true, ""};
    }

    static ShapeResult polygon(const Vector3Array &points)
    {
        std::vector<Vector3> pts = vecFromJSArray<Vector3>(points);
        BRepBuilderAPI_MakePolygon poly;
        for (auto &p : pts)
        {
            poly.Add(Vector3::toPnt(p));
        }
        if (!poly.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create polygon"};
        }
        return ShapeResult{poly.Wire(), true, ""};
    }

    static ShapeResult arc(const Vector3 &normal, const Vector3 &center, const Vector3 &start, double rad)
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
        if (!edge.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create arc"};
        }
        return ShapeResult{edge.Edge(), true, ""};
    }

    static ShapeResult circle(const Vector3 &normal, const Vector3 &center, double radius)
    {
        gp_Ax2 ax2(Vector3::toPnt(center), Vector3::toDir(normal));
        gp_Circ circ(ax2, radius);
        BRepBuilderAPI_MakeEdge edge(circ);
        if (!edge.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create circle"};
        }
        return ShapeResult{edge.Edge(), true, ""};
    }

    static ShapeResult rect(const Ax3 &pln, double width, double height)
    {
        BRepBuilderAPI_MakeFace makeFace(Ax3::toPln(pln), 0, width, 0, height);
        if (!makeFace.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create rectangle"};
        }
        return ShapeResult{makeFace.Face(), true, ""};
    }

    static ShapeResult bezier(const Vector3Array &points, const NumberArray &weights)
    {
        std::vector<Vector3> pts = vecFromJSArray<Vector3>(points);
        TColgp_Array1OfPnt arrayofPnt(1, pts.size());
        for (int i = 0; i < pts.size(); i++)
        {
            arrayofPnt.SetValue(i + 1, Vector3::toPnt(pts[i]));
        }

        std::vector<double> wts = vecFromJSArray<double>(weights);
        TColStd_Array1OfReal arrayOfWeight(1, wts.size());
        for (int i = 0; i < wts.size(); i++)
        {
            arrayOfWeight.SetValue(i + 1, wts[i]);
        }

        Handle_Geom_Curve curve = wts.size() > 0
                                      ? new Geom_BezierCurve(arrayofPnt, arrayOfWeight)
                                      : new Geom_BezierCurve(arrayofPnt);
        BRepBuilderAPI_MakeEdge edge(curve);
        if (!edge.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create bezier"};
        }
        return ShapeResult{edge.Edge(), true, ""};
    }

    static ShapeResult point(const Vector3 &point)
    {
        BRepBuilderAPI_MakeVertex makeVertex(Vector3::toPnt(point));
        if (!makeVertex.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create point"};
        }
        return ShapeResult{makeVertex.Vertex(), true, ""};
    }

    static ShapeResult line(const Vector3 &start, const Vector3 &end)
    {
        BRepBuilderAPI_MakeEdge makeEdge(Vector3::toPnt(start), Vector3::toPnt(end));
        if (!makeEdge.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create line"};
        }
        return ShapeResult{makeEdge.Edge(), true, ""};
    }

    static void orderEdge(BRepBuilderAPI_MakeWire& wire, const std::vector<TopoDS_Edge> &edges)
    {
        ShapeAnalysis_WireOrder order;
        ShapeAnalysis_Edge analysis;
        for (auto &edge : edges)
        {
            order.Add(
                BRep_Tool::Pnt(analysis.FirstVertex(edge)).XYZ(),
                BRep_Tool::Pnt(analysis.LastVertex(edge)).XYZ());
        }
        order.Perform(true);
        if (order.IsDone())
        {
            for (int i = 0; i < order.NbEdges(); i++)
            {
                int index = order.Ordered(i + 1);
                auto edge = edges[abs(index) - 1];
                if (index < 0)
                {
                    edge.Reverse();
                }
                wire.Add(edge);
            }
        }

    }

    static ShapeResult wire(const EdgeArray &edges)
    {
        std::vector<TopoDS_Edge> edgesVec = vecFromJSArray<TopoDS_Edge>(edges);
        if (edgesVec.size() == 0)
        {
            return ShapeResult{TopoDS_Shape(), false, "No edges provided"};
        }
        BRepBuilderAPI_MakeWire wire;
        if (edgesVec.size() == 1)
        {
            wire.Add(edgesVec[0]);
        } 
        else 
        {
            orderEdge(wire, edgesVec);
        }
        
        if (!wire.IsDone())
        {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create wire"};
        }
        return ShapeResult{wire.Wire(), true, ""};
    }

    static ShapeResult face(const WireArray& wires) {
        std::vector<TopoDS_Wire> wiresVec = vecFromJSArray<TopoDS_Wire>(wires);
        BRepBuilderAPI_MakeFace makeFace(wiresVec[0]);
        for (int i = 1; i < wiresVec.size(); i++) {
            makeFace.Add(wiresVec[i]);
        }
        if (!makeFace.IsDone()) {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create face"};
        }
        return ShapeResult{makeFace.Face(), true, ""};
    }

    static ShapeResult makeThickSolidBySimple(const TopoDS_Shape &shape, double thickness) {
        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidBySimple(shape, thickness);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create thick solid"};
        }
        return ShapeResult{makeThickSolid.Shape(), true, ""};
    }

    static ShapeResult makeThickSolidByJoin(const TopoDS_Shape &shape, const ShapeArray &shapes, double thickness) {
        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(shapes);
        TopTools_ListOfShape shapesList;
        for (auto shape : shapesVec) {
            shapesList.Append(shape);
        }
        BRepOffsetAPI_MakeThickSolid makeThickSolid;
        makeThickSolid.MakeThickSolidByJoin(shape, shapesList, thickness, 1e-6);
        if (!makeThickSolid.IsDone()) {
            return ShapeResult{TopoDS_Shape(), false, "Failed to create thick solid"};
        }
        return ShapeResult{makeThickSolid.Shape(), true, ""};
    }

    static ShapeResult booleanOperate(BRepAlgoAPI_BooleanOperation& boolOperater, const ShapeArray &args, const ShapeArray& tools) {
        std::vector<TopoDS_Shape> argsVec = vecFromJSArray<TopoDS_Shape>(args);
        TopTools_ListOfShape argsList;
        for (auto shape : argsVec) {
            argsList.Append(shape);
        }
        
        std::vector<TopoDS_Shape> toolsVec = vecFromJSArray<TopoDS_Shape>(tools);
        TopTools_ListOfShape toolsList;
        for (auto shape : toolsVec) {
            toolsList.Append(shape);
        }
        
        boolOperater.SetArguments(argsList);
        boolOperater.SetTools(toolsList);
        boolOperater.Build();
        if (!boolOperater.IsDone()) {
            return ShapeResult{TopoDS_Shape(), false, "Failed to build boolean operation"};
        }
        return ShapeResult{boolOperater.Shape(), true, ""};
    }

    static ShapeResult booleanCommon(const ShapeArray &args, const ShapeArray& tools) {
        BRepAlgoAPI_Common api;
        api.SetRunParallel(true);
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanCut(const ShapeArray &args, const ShapeArray& tools) {
        BRepAlgoAPI_Cut api;
        api.SetRunParallel(true);
        return booleanOperate(api, args, tools);
    }

    static ShapeResult booleanFuse(const ShapeArray &args, const ShapeArray& tools) {
        BRepAlgoAPI_Fuse api;
        api.SetRunParallel(true);
        return booleanOperate(api, args, tools);
    }

    static ShapeResult combine(const ShapeArray &shapes) {
        std::vector<TopoDS_Shape> shapesVec = vecFromJSArray<TopoDS_Shape>(shapes);
        TopoDS_Compound compound;
        BRep_Builder builder;
        builder.MakeCompound(compound);
        for (auto shape : shapesVec) {
            builder.Add(compound, shape);
        }
        return ShapeResult{compound, true, ""};
    }

};

EMSCRIPTEN_BINDINGS(ShapeFactory)
{
    class_<ShapeResult>("ShapeResult")
        .property("shape", &ShapeResult::shape)
        .property("isOk", &ShapeResult::isOk)
        .property("error", &ShapeResult::error);

    class_<ShapeFactory>("ShapeFactory")
        .class_function("box", &ShapeFactory::box)
        .class_function("pipe", &ShapeFactory::pipe)
        .class_function("sweep", &ShapeFactory::sweep)
        .class_function("revolve", &ShapeFactory::revolve)
        .class_function("prism", &ShapeFactory::prism)
        .class_function("polygon", &ShapeFactory::polygon)
        .class_function("circle", &ShapeFactory::circle)
        .class_function("arc", &ShapeFactory::arc)
        .class_function("bezier", &ShapeFactory::bezier)
        .class_function("rect", &ShapeFactory::rect)
        .class_function("point", &ShapeFactory::point)
        .class_function("line", &ShapeFactory::line)
        .class_function("wire", &ShapeFactory::wire)
        .class_function("face", &ShapeFactory::face)
        .class_function("makeThickSolidBySimple", &ShapeFactory::makeThickSolidBySimple)
        .class_function("makeThickSolidByJoin", &ShapeFactory::makeThickSolidByJoin)
        .class_function("booleanCommon", &ShapeFactory::booleanCommon)
        .class_function("booleanCut", &ShapeFactory::booleanCut)
        .class_function("booleanFuse", &ShapeFactory::booleanFuse)
        .class_function("combine", &ShapeFactory::combine)

    ;

}