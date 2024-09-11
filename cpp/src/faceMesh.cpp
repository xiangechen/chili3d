#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <BRep_Tool.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <Standard_Handle.hxx>
#include <TopoDS.hxx>
#include <TopLoc_Location.hxx>
#include <TopExp_Explorer.hxx>
#include <Poly_Triangulation.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepTools.hxx>

using namespace emscripten;
using namespace std;

class FaceMesh
{
private:
    TopoDS_Shape shape;
    std::vector<float> position;
    std::vector<float> normal;
    std::vector<float> uv;
    std::vector<int> index;
    /// @brief start1,count1,material1,start2,count2,material2...
    std::vector<int> group;

    void generateMeshs()
    {
        auto transform = shape.Location().Transformation().Inverted();
        TopExp_Explorer explorer(this->shape, TopAbs_FACE);
        for (; explorer.More(); explorer.Next())
        {
            auto start = this->position.size() / 3;

            generateFaceMesh(TopoDS::Face(explorer.Current()), transform);

            this->group.push_back(start);
            this->group.push_back(this->position.size() / 3 - start);
            this->group.push_back(0);
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

        this->fillPosition(transform, handlePoly);
        this->fillIndex(handlePoly, orientation);
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

    void fillIndex(const Handle(Poly_Triangulation) & handlePoly, const TopAbs_Orientation &orientation)
    {
        auto startIndex = this->position.size() / 3;
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
    FaceMesh(const TopoDS_Shape &shape) : shape(shape)
    {
        BRepMesh_IncrementalMesh mesh(shape, 0.1, 0.5);
        generateMeshs();
    }

    val getPosition()
    {
        return val(typed_memory_view(position.size(), position.data()));
    }

    val getNormal()
    {
        return val(typed_memory_view(normal.size(), normal.data()));
    }

    val getUV()
    {
        return val(typed_memory_view(uv.size(), uv.data()));
    }

    val getIndex()
    {
        return val(typed_memory_view(index.size(), index.data()));
    }

    val getGroups()
    {
        return val(typed_memory_view(group.size(), group.data()));
    }
};

EMSCRIPTEN_BINDINGS(FaceMesh)
{

    class_<FaceMesh>("FaceMesh")
        .constructor<TopoDS_Shape>()
        .function("getPosition", &FaceMesh::getPosition)
        .function("getNormal", &FaceMesh::getNormal)
        .function("getUV", &FaceMesh::getUV)
        .function("getIndex", &FaceMesh::getIndex)
        .function("getGroups", &FaceMesh::getGroups);
}
