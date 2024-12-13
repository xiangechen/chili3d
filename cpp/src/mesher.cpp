#include "shared.hpp"
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
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
#include <UnitsMethods.hxx>

using namespace emscripten;
using namespace std;

const double ANGLE_DEFLECTION = 0.5;

double boundingBoxRatio(const TopoDS_Shape &shape, double linearDeflection)
{
    Bnd_Box boundingBox;
    BRepBndLib::Add(shape, boundingBox, false);
    if (boundingBox.IsVoid())
    {
        return linearDeflection;
    }
    Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
    boundingBox.Get(xMin, yMin, zMin, xMax, yMax, zMax);

    Standard_Real avgSize = ((xMax - xMin) + (yMax - yMin) + (zMax - zMin)) / 3.0;
    double linDeflection = avgSize * linearDeflection;
    if (linDeflection < Precision::Confusion())
    {
        linDeflection = 1.0;
    }
    return linDeflection;
}

class EdgeMesher
{
private:
    TopoDS_Shape shape;
    double lineDeflection;
    std::vector<float> position;
    /// @brief start1,count1,start2,count2...
    std::vector<size_t> group;
    std::vector<TopoDS_Edge> edges;

    void generateEdgeMeshs()
    {
        auto transform = shape.Location().Transformation().Inverted();

        TopTools_IndexedMapOfShape edgeMap;
        TopExp::MapShapes(this->shape, TopAbs_EDGE, edgeMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(edgeMap); anIt.More(); anIt.Next())
        {
            TopoDS_Edge edge = TopoDS::Edge(anIt.Value());
            edges.push_back(edge);
            generateEdgeMesh(edge, transform);
        }
    }

    void generateEdgeMesh(const TopoDS_Edge &edge, const gp_Trsf &transform)
    {
        auto start = this->position.size() / 3;

        BRepAdaptor_Curve curve(edge);
        GCPnts_TangentialDeflection pnts(curve, ANGLE_DEFLECTION, this->lineDeflection);
        std::optional<gp_Pnt> prePnt = std::nullopt;
        for (int i = 0; i < pnts.NbPoints(); i++)
        {
            auto pnt = pnts.Value(i + 1).Transformed(transform);
            if (prePnt.has_value())
            {
                auto pre = prePnt.value();
                this->position.push_back(pre.X());
                this->position.push_back(pre.Y());
                this->position.push_back(pre.Z());

                this->position.push_back(pnt.X());
                this->position.push_back(pnt.Y());
                this->position.push_back(pnt.Z());
            }
            prePnt = pnt;
        }

        this->group.push_back(start);
        this->group.push_back(this->position.size() / 3 - start);
    }

public:
    EdgeMesher(const TopoDS_Shape &shape, double lineDeflection) : shape(shape), lineDeflection(lineDeflection)
    {
        generateEdgeMeshs();
    }

    NumberArray getPosition()
    {
        return NumberArray(val::array(position));
    }

    NumberArray getGroups()
    {
        return NumberArray(val::array(group));
    }

    size_t getEdgeSize()
    {
        return edges.size();
    }

    TopoDS_Edge &getEdge(size_t index)
    {
        return edges[index];
    }

    EdgeArray getEdges()
    {
        return EdgeArray(val::array(edges));
    }
};

class FaceMesher
{
private:
    TopoDS_Shape shape;
    std::vector<float> position;
    std::vector<float> normal;
    std::vector<float> uv;
    std::vector<size_t> index;
    /// @brief start1,count1,start2,count2...
    std::vector<size_t> group;
    std::vector<TopoDS_Face> faces;

    void generateFaceMeshs()
    {
        auto inverted = shape.Location().Transformation().Inverted();
        TopTools_IndexedMapOfShape faceMap;
        TopExp::MapShapes(this->shape, TopAbs_FACE, faceMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(faceMap); anIt.More(); anIt.Next())
        {
            auto face = TopoDS::Face(anIt.Value());
            faces.push_back(face);
            generateFaceMesh(face, inverted);
        }
    }

    void generateFaceMesh(const TopoDS_Face &face, const gp_Trsf &inverted)
    {
        TopLoc_Location location;
        auto handlePoly = BRep_Tool::Triangulation(face, location);
        if (handlePoly.IsNull())
        {
            return;
        }
        auto trsf = inverted.Multiplied(location.Transformation());

        bool isMirrod = trsf.VectorialPart().Determinant() < 0;
        auto orientation = face.Orientation();
        auto groupStart = this->index.size();
        auto indexStart = this->position.size() / 3;

        this->fillIndex(indexStart, handlePoly, orientation);
        this->fillPosition(trsf, handlePoly);
        this->fillNormal(trsf, face, handlePoly, (orientation == TopAbs_REVERSED) ^ isMirrod);
        this->fillUv(face, handlePoly);

        this->group.push_back(groupStart);
        this->group.push_back(this->index.size() - groupStart);
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
            if (shouldReverse)
            {
                normal.Reverse();
            }
            normal = normal.Transformed(transform);
            this->normal.push_back(normal.X());
            this->normal.push_back(normal.Y());
            this->normal.push_back(normal.Z());
        }
    }

    void fillIndex(size_t indexStart, const Handle(Poly_Triangulation) & handlePoly, const TopAbs_Orientation &orientation)
    {
        for (int index = 0; index < handlePoly->NbTriangles(); index++)
        {
            auto v1(1), v2(2), v3(3);
            if (orientation == TopAbs_REVERSED)
            {
                v2 = 3;
                v3 = 2;
            }

            auto triangle = handlePoly->Triangle(index + 1);
            this->index.push_back(triangle.Value(v1) - 1 + indexStart);
            this->index.push_back(triangle.Value(v2) - 1 + indexStart);
            this->index.push_back(triangle.Value(v3) - 1 + indexStart);
        }
    }

    void fillUv(const TopoDS_Face &face, const Handle(Poly_Triangulation) & handlePoly)
    {
        double aUmin, aUmax, aVmin, aVmax, dUmax, dVmax;
        BRepTools::UVBounds(face, aUmin, aUmax, aVmin, aVmax);
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
        return NumberArray(val::array(position));
    }

    NumberArray getNormal()
    {
        return NumberArray(val::array(normal));
    }

    NumberArray getUV()
    {
        return NumberArray(val::array(uv));
    }

    NumberArray getIndex()
    {
        return NumberArray(val::array(index));
    }

    NumberArray getGroups()
    {
        return NumberArray(val::array(group));
    }

    size_t getFaceSize()
    {
        return faces.size();
    }

    TopoDS_Face &getFace(size_t index)
    {
        return faces[index];
    }

    FaceArray getFaces()
    {
        return FaceArray(val::array(faces));
    }
};

EMSCRIPTEN_BINDINGS(Mesher)
{
    emscripten::function("boundingBoxRatio", &boundingBoxRatio);

    class_<FaceMesher>("FaceMesher")
        .constructor<const TopoDS_Shape &, double>()
        .function("getPosition", &FaceMesher::getPosition)
        .function("getNormal", &FaceMesher::getNormal)
        .function("getUV", &FaceMesher::getUV)
        .function("getIndex", &FaceMesher::getIndex)
        .function("getGroups", &FaceMesher::getGroups)
        .function("getFaceSize", &FaceMesher::getFaceSize)
        .function("getFace", &FaceMesher::getFace)
        .function("getFaces", &FaceMesher::getFaces);

    class_<EdgeMesher>("EdgeMesher")
        .constructor<const TopoDS_Shape &, double>()
        .function("getPosition", &EdgeMesher::getPosition)
        .function("getGroups", &EdgeMesher::getGroups)
        .function("getEdgeSize", &EdgeMesher::getEdgeSize)
        .function("getEdge", &EdgeMesher::getEdge)
        .function("getEdges", &EdgeMesher::getEdges);
}
