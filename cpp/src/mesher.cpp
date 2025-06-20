// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard_Handle.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <UnitsMethods.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "shared.hpp"
#include "utils.hpp"

using namespace emscripten;
using namespace std;

const double ANGLE_DEFLECTION = 0.2;

void addPointToPosition(const gp_Pnt& pnt,
    std::optional<gp_Pnt>& prePnt,
    std::vector<float>& position)
{
    if (prePnt.has_value()) {
        auto pre = prePnt.value();
        position.push_back(pre.X());
        position.push_back(pre.Y());
        position.push_back(pre.Z());

        position.push_back(pnt.X());
        position.push_back(pnt.Y());
        position.push_back(pnt.Z());
    }
    prePnt = pnt;
}

void pointByGCTangential(const TopoDS_Edge& edge,
    double lineDeflection,
    std::vector<float>& position)
{
    BRepAdaptor_Curve curve(edge);
    GCPnts_TangentialDeflection pnts(curve, ANGLE_DEFLECTION, lineDeflection);

    std::optional<gp_Pnt> prePnt = std::nullopt;
    for (int i = 0; i < pnts.NbPoints(); i++) {
        addPointToPosition(pnts.Value(i + 1), prePnt, position);
    }
}

struct EdgeMeshData {
    NumberArray position;
    /// @brief start1,count1,start2,count2...
    NumberArray group;
    EdgeArray edges;
};

struct FaceMeshData {
    NumberArray position;
    NumberArray normal;
    NumberArray uv;
    NumberArray index;
    /// @brief start1,count1,start2,count2...
    NumberArray group;
    FaceArray faces;
};

struct MeshData {
    EdgeMeshData edgeMeshData;
    FaceMeshData faceMeshData;
};

class EdgeMesher {
public:
    double lineDeflection;
    std::vector<float> position;
    /// @brief start1,count1,start2,count2...
    std::vector<size_t> group;
    std::vector<TopoDS_Edge> edges;

    EdgeMesher(double lineDeflection)
        : lineDeflection(lineDeflection)
    {
    }

    void generateEdgeMesh(const TopoDS_Edge& edge,
        const Handle(Poly_Triangulation) & triangulation)
    {
        auto start = this->position.size() / 3;

        if (triangulation.IsNull()) {
            pointByGCTangential(edge, this->lineDeflection, this->position);
        } else {
            TopLoc_Location location;
            Handle(Poly_PolygonOnTriangulation) polygon = BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
            if (polygon.IsNull()) {
                pointByGCTangential(edge, this->lineDeflection, this->position);
            } else {
                auto trsf = location.Transformation();
                pointByFaceTriangulation(polygon, triangulation, trsf);
            }
        }

        this->group.push_back(start);
        this->group.push_back(this->position.size() / 3 - start);
    }

    void pointByFaceTriangulation(
        const Handle_Poly_PolygonOnTriangulation& polygon,
        const Handle_Poly_Triangulation& triangulation,
        const gp_Trsf& transform)
    {
        std::optional<gp_Pnt> prePnt = std::nullopt;
        auto nodeIndex = polygon->Nodes();
        for (auto i = nodeIndex.Lower(); i <= nodeIndex.Upper(); i++) {
            auto pnt = triangulation->Node(nodeIndex[i]).Transformed(transform);
            addPointToPosition(pnt, prePnt, this->position);
        }
    }
};

class FaceMesher {
public:
    std::vector<float> position;
    std::vector<float> normal;
    std::vector<float> uv;
    std::vector<size_t> index;
    /// @brief start1,count1,start2,count2...
    std::vector<size_t> group;
    std::vector<TopoDS_Face> faces;

    void generateFaceMesh(const TopoDS_Face& face,
        const Handle(Poly_Triangulation) & handlePoly,
        const gp_Trsf& trsf)
    {
        if (handlePoly.IsNull()) {
            return;
        }

        bool isMirrod = trsf.VectorialPart().Determinant() < 0;
        auto orientation = face.Orientation();
        auto groupStart = this->index.size();
        auto indexStart = this->position.size() / 3;

        this->fillIndex(indexStart, handlePoly, orientation);
        this->fillPosition(trsf, handlePoly);
        this->fillNormal(trsf, face, handlePoly,
            (orientation == TopAbs_REVERSED) ^ isMirrod);
        this->fillUv(face, handlePoly);

        this->group.push_back(groupStart);
        this->group.push_back(this->index.size() - groupStart);
    }

    void fillPosition(const gp_Trsf& transform,
        const Handle(Poly_Triangulation) & handlePoly)
    {
        for (int index = 0; index < handlePoly->NbNodes(); index++) {
            auto pnt = handlePoly->Node(index + 1).Transformed(transform);
            this->position.push_back(pnt.X());
            this->position.push_back(pnt.Y());
            this->position.push_back(pnt.Z());
        }
    }

    void fillNormal(const gp_Trsf& transform,
        const TopoDS_Face& face,
        const Handle(Poly_Triangulation) & handlePoly,
        bool shouldReverse)
    {
        BRepLib_ToolTriangulatedShape::ComputeNormals(face, handlePoly);
        for (int index = 0; index < handlePoly->NbNodes(); index++) {
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

    void fillIndex(size_t indexStart,
        const Handle(Poly_Triangulation) & handlePoly,
        const TopAbs_Orientation& orientation)
    {
        for (int index = 0; index < handlePoly->NbTriangles(); index++) {
            auto v1(1), v2(2), v3(3);
            if (orientation == TopAbs_REVERSED) {
                v2 = 3;
                v3 = 2;
            }

            auto triangle = handlePoly->Triangle(index + 1);
            this->index.push_back(triangle.Value(v1) - 1 + indexStart);
            this->index.push_back(triangle.Value(v2) - 1 + indexStart);
            this->index.push_back(triangle.Value(v3) - 1 + indexStart);
        }
    }

    void fillUv(const TopoDS_Face& face,
        const Handle(Poly_Triangulation) & handlePoly)
    {
        double aUmin, aUmax, aVmin, aVmax, dUmax, dVmax;
        BRepTools::UVBounds(face, aUmin, aUmax, aVmin, aVmax);
        dUmax = (aUmax - aUmin);
        dVmax = (aVmax - aVmin);
        for (int index = 0; index < handlePoly->NbNodes(); index++) {
            auto uv = handlePoly->UVNode(index + 1);
            this->uv.push_back((uv.X() - aUmin) / dUmax);
            this->uv.push_back((uv.Y() - aVmin) / dVmax);
        }
    }
};

class Mesher {
    TopoDS_Shape shape;
    double lineDeflection;

public:
    Mesher(const TopoDS_Shape& shape, double lineDeflection)
        : shape(shape)
    {
        this->lineDeflection = boundingBoxRatio(shape, lineDeflection);
    }

    NumberArray edgesMeshPosition()
    {
        std::vector<float> position;
        TopTools_IndexedMapOfShape edgeMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(edgeMap); anIt.More();
             anIt.Next()) {
            TopoDS_Edge edge = TopoDS::Edge(anIt.Value());
            pointByGCTangential(edge, this->lineDeflection, position);
        }

        return NumberArray(val::array(position));
    }

    MeshData mesh()
    {
        BRepMesh_IncrementalMesh mesh(shape, lineDeflection, true, ANGLE_DEFLECTION,
            true);

        std::unordered_map<TopoDS_Face, Handle(Poly_Triangulation)> facePolyMap;
        auto faceMeshData = meshFaces(facePolyMap);
        auto edgeMeshData = meshEdges(facePolyMap);

        return MeshData { edgeMeshData, faceMeshData };
    }

    EdgeMeshData meshEdges(
        std::unordered_map<TopoDS_Face, Handle_Poly_Triangulation>& facePolyMap)
    {
        EdgeMesher mesher(lineDeflection);
        TopTools_IndexedDataMapOfShapeListOfShape mapEF;
        TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, mapEF);
        for (int ie = 1; ie <= mapEF.Extent(); ie++) {
            const TopoDS_Edge& aEdge = TopoDS::Edge(mapEF.FindKey(ie));
            mesher.edges.push_back(aEdge);

            const TopTools_ListOfShape& aFaces = mapEF(ie);
            if (aFaces.Extent() < 1) {
                mesher.generateEdgeMesh(aEdge, nullptr);
            } else {
                const TopoDS_Face& face = TopoDS::Face(aFaces.First());
                auto it = facePolyMap.find(face);
                if (it != facePolyMap.end()) {
                    mesher.generateEdgeMesh(aEdge, it->second);
                } else {
                    mesher.generateEdgeMesh(aEdge, nullptr);
                }
            }
        }

        return EdgeMeshData { NumberArray(val::array(mesher.position)),
            NumberArray(val::array(mesher.group)),
            EdgeArray(val::array(mesher.edges)) };
    }

    FaceMeshData meshFaces(
        std::unordered_map<TopoDS_Face, Handle_Poly_Triangulation>& facePolyMap)
    {
        FaceMesher mesher;
        TopTools_IndexedMapOfShape faceMap;
        TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
        for (TopTools_IndexedMapOfShape::Iterator anIt(faceMap); anIt.More();
             anIt.Next()) {
            auto face = TopoDS::Face(anIt.Value());
            mesher.faces.push_back(face);
            TopLoc_Location location;
            auto handlePoly = BRep_Tool::Triangulation(face, location);
            if (!handlePoly.IsNull()) {
                auto trsf = location.Transformation();
                mesher.generateFaceMesh(face, handlePoly, trsf);
                facePolyMap[face] = handlePoly;
            }
        }

        return FaceMeshData { NumberArray(val::array(mesher.position)),
            NumberArray(val::array(mesher.normal)),
            NumberArray(val::array(mesher.uv)),
            NumberArray(val::array(mesher.index)),
            NumberArray(val::array(mesher.group)),
            FaceArray(val::array(mesher.faces)) };
    }

    ~Mesher() { BRepTools::Clean(shape, true); }
};

EMSCRIPTEN_BINDINGS(Mesher)
{
    class_<Mesher>("Mesher")
        .constructor<TopoDS_Shape, double>()
        .function("mesh", &Mesher::mesh)
        .function("edgesMeshPosition", &Mesher::edgesMeshPosition);

    class_<EdgeMeshData>("EdgeMeshData")
        .property("position", &EdgeMeshData::position)
        .property("group", &EdgeMeshData::group)
        .property("edges", &EdgeMeshData::edges);

    class_<FaceMeshData>("FaceMeshData")
        .property("position", &FaceMeshData::position)
        .property("normal", &FaceMeshData::normal)
        .property("uv", &FaceMeshData::uv)
        .property("index", &FaceMeshData::index)
        .property("group", &FaceMeshData::group)
        .property("faces", &FaceMeshData::faces);

    class_<MeshData>("MeshData")
        .property("edgeMeshData", &MeshData::edgeMeshData)
        .property("faceMeshData", &MeshData::faceMeshData);
}
