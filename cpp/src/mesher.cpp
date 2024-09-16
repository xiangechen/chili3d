#include "base.hpp"
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <GCPnts_TangentialDeflection.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard_Handle.hxx>
#include <TopExp_Explorer.hxx>
#include <TopExp.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS.hxx>

using namespace emscripten;
using namespace std;

const double ANGLE_DEFLECTION = 0.5;

class EdgeMesher
{
private:
    TopoDS_Shape shape;
    double lineDeflection;
    std::vector<float> position;
    /// @brief start1,count1,start2,count2...
    std::vector<uint32_t> group;
    std::vector<TopoDS_Edge> edges;

    void generateEdgeMeshs()
    {
        auto transform = shape.Location().Transformation().Inverted();

        TopTools_IndexedMapOfShape edgeMap;
        TopExp::MapShapes(this->shape, TopAbs_EDGE, edgeMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(edgeMap); anIt.More(); anIt.Next())
        {
            auto start = this->position.size() / 3;

            TopoDS_Edge edge = TopoDS::Edge(anIt.Value());
            edges.push_back(edge);
            generateEdgeMesh(edge, transform);

            this->group.push_back(start);
            this->group.push_back(this->position.size() / 3 - start);
        }
    }

    void generateEdgeMesh(const TopoDS_Edge& edge, const gp_Trsf &transform)
    {
        BRepAdaptor_Curve curve(edge);
        GCPnts_TangentialDeflection pnts(curve, ANGLE_DEFLECTION, this->lineDeflection);
        for (int i = 0; i < pnts.NbPoints(); i++)
        {
            auto pnt = pnts.Value(i + 1).Transformed(transform);
            position.push_back(pnt.X());
            position.push_back(pnt.Y());
            position.push_back(pnt.Z());
        }
    }

public:
    EdgeMesher(const TopoDS_Shape& shape, double lineDeflection) : shape(shape), lineDeflection(lineDeflection)
    {
        generateEdgeMeshs();
    }

    NumberArray getPosition()
    {
        return NumberArray(val::array(position.begin(), position.end()));
    }

    NumberArray getGroups()
    {
        return NumberArray(val::array(group.begin(), group.end()));
    }

    size_t getEdgeSize()
    {
        return edges.size();
    }

    TopoDS_Edge& getEdge(size_t index)
    {
        return edges[index];
    }

};

class FaceMesher
{
private:
    TopoDS_Shape shape;
    std::vector<float> position;
    std::vector<float> normal;
    std::vector<float> uv;
    std::vector<uint32_t> index;
    /// @brief start1,count1,start2,count2...
    std::vector<uint32_t> group;
    std::vector<TopoDS_Face> faces;

    void generateFaceMeshs()
    {
        auto transform = shape.Location().Transformation().Inverted();
        TopTools_IndexedMapOfShape faceMap;
        TopExp::MapShapes(this->shape, TopAbs_FACE, faceMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(faceMap); anIt.More(); anIt.Next())
        {
            auto start = this->position.size() / 3;
            auto face = TopoDS::Face(anIt.Value());
            faces.push_back(face);
            generateFaceMesh(face, transform);

            this->group.push_back(start);
            this->group.push_back(this->position.size() / 3 - start);
        }
    }

    void generateFaceMesh(const TopoDS_Face &face, const gp_Trsf &transform)
    {
        TopLoc_Location location;
        auto handlePoly = BRep_Tool::Triangulation(face, location);
        if (handlePoly.IsNull())
        {
            return;
        }

        auto trsf = location.Transformation();
        bool isMirrod = trsf.VectorialPart().Determinant() < 0;
        trsf = trsf.Multiplied(transform);
        auto orientation = face.Orientation();
        auto startIndex = this->position.size() / 3;

        this->fillIndex(startIndex, handlePoly, orientation);
        this->fillPosition(transform, handlePoly);
        this->fillNormal(transform, face, handlePoly, (orientation == TopAbs_REVERSED) ^ isMirrod);
        this->fillUv(face, handlePoly);
    }

    void fillPosition(const gp_Trsf &transform, const Handle(Poly_Triangulation) & handlePoly)
    {
        for (int index = 0; index < handlePoly->NbNodes(); index++)
        {
            auto pnt = handlePoly->Node(index + 1).Transformed(transform);
            this->position.push_back(pnt.X());
            this->position.push_back(pnt.Y());
            this->position.push_back(pnt.Z());
        }
    }

    void fillNormal(const gp_Trsf &transform, const TopoDS_Face &face, const Handle(Poly_Triangulation) & handlePoly, bool shouldReverse)
    {
        BRepLib_ToolTriangulatedShape::ComputeNormals(face, handlePoly);
        for (int index = 0; index < handlePoly->NbNodes(); index++)
        {
            auto normal = handlePoly->Normal(index + 1);
            if (shouldReverse) {
                normal.Reverse();
            }
            normal = normal.Transformed(transform);
            this->normal.push_back(normal.X());
            this->normal.push_back(normal.Y());
            this->normal.push_back(normal.Z());
        }
    }

    void fillIndex(size_t startIndex, const Handle(Poly_Triangulation) & handlePoly, const TopAbs_Orientation &orientation)
    {
        for (int index = 0; index < handlePoly->NbTriangles(); index++)
        {
            auto triangle = handlePoly->Triangle(index + 1);
            if (orientation == TopAbs_REVERSED)
            {
                this->index.push_back(triangle.Value(1) - 1 + startIndex);
                this->index.push_back(triangle.Value(3) - 1 + startIndex);
                this->index.push_back(triangle.Value(2) - 1 + startIndex);
            }
            else
            {
                this->index.push_back(triangle.Value(1) - 1 + startIndex);
                this->index.push_back(triangle.Value(2) - 1 + startIndex);
                this->index.push_back(triangle.Value(3) - 1 + startIndex);
            }
        }
    }

    void fillUv(const TopoDS_Face &face, const Handle(Poly_Triangulation) & handlePoly) 
    {
        double aUmin (0.0), aUmax (0.0), aVmin (0.0), aVmax (0.0), dUmax (0.0), dVmax (0.0);
        BRepTools::UVBounds (face, aUmin, aUmax, aVmin, aVmax);
        dUmax = (aUmax - aUmin);
        dVmax = (aVmax - aVmin);
        for (int index = 0; index < handlePoly->NbNodes(); index++)
        {
            auto uv = handlePoly->UVNode(index + 1);
            this->uv.push_back((uv.X() - aUmin) / dUmax);
            this->uv.push_back((uv.Y() - aVmin) / dVmax);
        }
    }

public:
    FaceMesher(const TopoDS_Shape &shape, double lineDeflection) : shape(shape)
    {
        BRepMesh_IncrementalMesh mesh(shape, lineDeflection, false, 0.1);
        generateFaceMeshs();
    }

    NumberArray getPosition()
    {
        return NumberArray(val::array(position.begin(), position.end()));
    }

    NumberArray getNormal()
    {
        return NumberArray(val::array(normal.begin(), normal.end()));
    }

    NumberArray getUV()
    {
        return NumberArray(val::array(uv.begin(), uv.end()));
    }

    NumberArray getIndex()
    {
        return NumberArray(val::array(index.begin(), index.end()));
    }

    NumberArray getGroups()
    {
        return NumberArray(val::array(group.begin(), group.end()));
    }

    size_t getFaceSize()
    {
        return faces.size();
    }

    TopoDS_Face& getFace(size_t index) {
        return faces[index];
    }
};

EMSCRIPTEN_BINDINGS(Mesher)
{
    class_<FaceMesher>("FaceMesher")
        .constructor<const TopoDS_Shape &, double>()
        .function("getPosition", &FaceMesher::getPosition)
        .function("getNormal", &FaceMesher::getNormal)
        .function("getUV", &FaceMesher::getUV)
        .function("getIndex", &FaceMesher::getIndex)
        .function("getGroups", &FaceMesher::getGroups)
        .function("getFaceSize", &FaceMesher::getFaceSize)
        .function("getFace", &FaceMesher::getFace)
    ;

    class_<EdgeMesher>("EdgeMesher")
        .constructor<const TopoDS_Shape &, double>()
        .function("getPosition", &EdgeMesher::getPosition)
        .function("getGroups", &EdgeMesher::getGroups)
        .function("getEdgeSize", &EdgeMesher::getEdgeSize)
        .function("getEdge", &EdgeMesher::getEdge)
    ;

    

}
