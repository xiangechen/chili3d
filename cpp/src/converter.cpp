// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include "math.hpp"
#include "shared.hpp"
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "utils.hpp"
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <IGESControl_Writer.hxx>
#include <Quantity_Color.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Reader.hxx>
#include <StlAPI_Writer.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <algorithm>
#include <unordered_map>
#include <vector>

#define TINYPLY_IMPLEMENTATION
#include "3rdparty/tinyply/tinyply.h"

using namespace emscripten;

namespace {

template <typename... Args>
std::string format(const char* fmt, Args... args)
{

    int size = snprintf(nullptr, 0, fmt, args...) + 1;
    if (size <= 0) {
        return {};
    }

    std::unique_ptr<char[]> buf(new char[size]);
    snprintf(buf.get(), size, fmt, args...);

    return std::string(buf.get());
}

struct Facet {
    Vector3f normal;

    Vector3f vertA;
    Vector3f vertB;
    Vector3f vertC;
};

void removeVec3ArrDuplicates(std::vector<Vector3f>& verts)
{
    std::sort(verts.begin(), verts.end());
    auto last = std::unique(verts.begin(), verts.end());
    verts.erase(last, verts.end());
}

std::unordered_map<Vector3f, size_t, Vector3fHash> buildVec3ArrIndexMap(const std::vector<Vector3f>& dd)
{
    std::unordered_map<Vector3f, size_t, Vector3fHash> map;
    for (size_t i = 0; i < dd.size(); ++i) {
        map[dd[i]] = i;
    }
    return map;
}

class BinaryBuffer : public std::streambuf {
public:
    explicit BinaryBuffer(std::vector<uint8_t>& vec)
        : _vec(vec)
    {
    }

protected:
    virtual int_type overflow(int_type ch) override
    {
        if (ch != traits_type::eof()) {
            _vec.push_back(static_cast<uint8_t>(ch));
        }
        return ch;
    }

    virtual std::streamsize xsputn(const char* s, std::streamsize count) override
    {
        _vec.insert(_vec.end(), s, s + count);
        return count;
    }

private:
    std::vector<uint8_t>& _vec;
};

}

void shapeToTriangle(const TopoDS_Shape& shape, std::vector<Vector3f>& vertexList,
    std::vector<unsigned int>& vertexIndex)
{

    auto lineDeflection = boundingBoxRatio(shape, 0.05);
    BRepMesh_IncrementalMesh mesh(shape, lineDeflection, true, 0.2, true);

    unsigned int index = 0;

    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const auto face = TopoDS::Face(ex.Current());
        TopLoc_Location location;

        const auto triangulation = BRep_Tool::Triangulation(face, location);

        if (!triangulation.IsNull()) {
            const auto nodesSize = triangulation->NbNodes();
            for (int j = 1; j <= nodesSize; j++) {
                const auto pt = triangulation->Node(j).Transformed(location.Transformation());
                vertexList.emplace_back(pt.X(), pt.Y(), pt.Z());
            }

            Standard_Integer v1 = 0;
            Standard_Integer v2 = 0;
            Standard_Integer v3 = 0;

            // occt index start with 1
            for (int j = 1; j <= triangulation->NbTriangles(); j++) {
                if (face.Orientation() == TopAbs_REVERSED) {
                    triangulation->Triangle(j).Get(v1, v3, v2);
                } else {
                    triangulation->Triangle(j).Get(v1, v2, v3);
                }
                vertexIndex.push_back(index + v1 - 1);
                vertexIndex.push_back(index + v2 - 1);
                vertexIndex.push_back(index + v3 - 1);
            }
            index = index + nodesSize;
        }
    }
}

class VectorBuffer : public std::streambuf {
public:
    VectorBuffer(const std::vector<uint8_t>& v)
    {
        setg((char*)v.data(), (char*)v.data(), (char*)(v.data() + v.size()));
    }
};

EMSCRIPTEN_DECLARE_VAL_TYPE(ShapeNodeArray)

struct ShapeNode {
    std::optional<TopoDS_Shape> shape;
    std::optional<std::string> color;
    std::vector<ShapeNode> children;
    std::string name;

    ShapeNodeArray getChildren() const
    {
        return ShapeNodeArray(val::array(children));
    }
};

std::string getLabelNameNoRef(const TDF_Label& label)
{
    Handle(TDataStd_Name) nameAttribute = new TDataStd_Name();
    if (!label.FindAttribute(nameAttribute->GetID(), nameAttribute)) {
        return std::string();
    }

    Standard_Integer utf8NameLength = nameAttribute->Get().LengthOfCString();
    char* nameBuf = new char[utf8NameLength + 1];
    nameAttribute->Get().ToUTF8CString(nameBuf);
    std::string name(nameBuf, utf8NameLength);
    delete[] nameBuf;
    return name;
}

std::string getLabelName(const TDF_Label& label,
    const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    if (XCAFDoc_ShapeTool::IsReference(label)) {
        TDF_Label referredShapeLabel;
        shapeTool->GetReferredShape(label, referredShapeLabel);
        return getLabelName(referredShapeLabel, shapeTool);
    }
    return getLabelNameNoRef(label);
}

std::string getShapeName(const TopoDS_Shape& shape,
    const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    TDF_Label shapeLabel;
    if (!shapeTool->Search(shape, shapeLabel)) {
        return std::string();
    }
    return getLabelName(shapeLabel, shapeTool);
}

bool getLabelColorNoRef(const TDF_Label& label,
    const Handle(XCAFDoc_ColorTool) & colorTool,
    std::string& color)
{
    static const std::vector<XCAFDoc_ColorType> colorTypes = {
        XCAFDoc_ColorSurf, XCAFDoc_ColorCurv, XCAFDoc_ColorGen
    };

    Quantity_Color qColor;
    for (XCAFDoc_ColorType colorType : colorTypes) {
        if (colorTool->GetColor(label, colorType, qColor)) {
            color = std::string(Quantity_Color::ColorToHex(qColor).ToCString());
            return true;
        }
    }

    return false;
}

bool getLabelColor(const TDF_Label& label,
    const Handle(XCAFDoc_ShapeTool) & shapeTool,
    const Handle(XCAFDoc_ColorTool) & colorTool,
    std::string& color)
{
    if (getLabelColorNoRef(label, colorTool, color)) {
        return true;
    }

    if (XCAFDoc_ShapeTool::IsReference(label)) {
        TDF_Label referredShape;
        shapeTool->GetReferredShape(label, referredShape);
        return getLabelColor(referredShape, shapeTool, colorTool, color);
    }

    return false;
}

bool getShapeColor(const TopoDS_Shape& shape,
    const Handle(XCAFDoc_ShapeTool) & shapeTool,
    const Handle(XCAFDoc_ColorTool) & colorTool,
    std::string& color)
{
    TDF_Label shapeLabel;
    if (!shapeTool->Search(shape, shapeLabel)) {
        return false;
    }
    return getLabelColor(shapeLabel, shapeTool, colorTool, color);
}

bool isFreeShape(const TDF_Label& label,
    const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    TopoDS_Shape tmpShape;
    return shapeTool->GetShape(label, tmpShape) && shapeTool->IsFree(label);
}

bool isMeshNode(const TDF_Label& label,
    const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    // if there are no children, it is a mesh node
    if (!label.HasChild()) {
        return true;
    }

    // if it has a subshape child, treat it as mesh node
    for (TDF_ChildIterator it(label); it.More(); it.Next()) {
        if (shapeTool->IsSubShape(it.Value())) {
            return true;
        }
    }

    // if it doesn't have a freeshape child, treat it as a mesh node
    for (TDF_ChildIterator it(label); it.More(); it.Next()) {
        if (isFreeShape(it.Value(), shapeTool)) {
            return false;
        }
    }

    return false;
}

ShapeNode initLabelNode(const TDF_Label label,
    const Handle(XCAFDoc_ShapeTool) shapeTool,
    const Handle(XCAFDoc_ColorTool) colorTool)
{
    std::string color;
    getLabelColor(label, shapeTool, colorTool, color);

    ShapeNode node = {
        .shape = std::nullopt,
        .color = color,
        .children = {},
        .name = getLabelName(label, shapeTool),
    };

    return node;
}

ShapeNode initShapeNode(const TopoDS_Shape& shape,
    const Handle(XCAFDoc_ShapeTool) & shapeTool,
    const Handle(XCAFDoc_ColorTool) & colorTool)
{
    std::string color;
    getShapeColor(shape, shapeTool, colorTool, color);
    ShapeNode childShapeNode = { .shape = shape,
        .color = color,
        .children = {},
        .name = getShapeName(shape, shapeTool) };
    return childShapeNode;
}

ShapeNode initGroupNode(const TopoDS_Shape& shape,
    const Handle_XCAFDoc_ShapeTool& shapeTool)
{
    ShapeNode groupNode = { .shape = std::nullopt,
        .color = std::nullopt,
        .children = {},
        .name = getShapeName(shape, shapeTool) };

    return groupNode;
}

ShapeNode parseShape(TopoDS_Shape& shape,
    const Handle_XCAFDoc_ShapeTool& shapeTool,
    const Handle_XCAFDoc_ColorTool& colorTool)
{
    if (shape.ShapeType() == TopAbs_COMPOUND || shape.ShapeType() == TopAbs_COMPSOLID) {
        auto node = initGroupNode(shape, shapeTool);
        TopoDS_Iterator iterator(shape);
        while (iterator.More()) {
            auto subShape = iterator.Value();
            node.children.push_back(parseShape(subShape, shapeTool, colorTool));
            iterator.Next();
        }
        return node;
    }
    return initShapeNode(shape, shapeTool, colorTool);
}

ShapeNode parseLabelToNode(const TDF_Label& label,
    const Handle(XCAFDoc_ShapeTool) & shapeTool,
    const Handle(XCAFDoc_ColorTool) & colorTool)
{
    if (isMeshNode(label, shapeTool)) {
        auto shape = shapeTool->GetShape(label);
        return parseShape(shape, shapeTool, colorTool);
    }

    auto node = initLabelNode(label, shapeTool, colorTool);
    for (TDF_ChildIterator it(label); it.More(); it.Next()) {
        auto childLabel = it.Value();
        if (isFreeShape(childLabel, shapeTool)) {
            auto childNode = parseLabelToNode(childLabel, shapeTool, colorTool);
            node.children.push_back(childNode);
        }
    }
    return node;
}

ShapeNode parseRootLabelToNode(const Handle(XCAFDoc_ShapeTool) & shapeTool,
    const Handle(XCAFDoc_ColorTool) & colorTool)
{
    auto label = shapeTool->Label();

    ShapeNode node = initLabelNode(label, shapeTool, colorTool);
    for (TDF_ChildIterator it(label); it.More(); it.Next()) {
        auto childLabel = it.Value();
        if (isFreeShape(childLabel, shapeTool)) {
            auto childNode = parseLabelToNode(childLabel, shapeTool, colorTool);
            node.children.push_back(childNode);
        }
    }

    return node;
}

static ShapeNode parseNodeFromDocument(Handle(TDocStd_Document) document)
{
    TDF_Label mainLabel = document->Main();
    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(mainLabel);
    Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(mainLabel);

    return parseRootLabelToNode(shapeTool, colorTool);
}

class Converter {
private:
    static TopoDS_Shape sewShapes(const std::vector<TopoDS_Shape>& shapes)
    {
        BRepBuilderAPI_Sewing sewing;
        for (const auto& shape : shapes) {
            sewing.Add(shape);
        }
        sewing.Perform();
        return sewing.SewedShape();
    }

    static void writeBufferToFile(const std::string& fileName,
        const Uint8Array& buffer)
    {
        std::vector<uint8_t> input = convertJSArrayToNumberVector<uint8_t>(buffer);
        std::ofstream dummyFile;
        dummyFile.open(fileName, std::ios::binary);
        dummyFile.write((char*)input.data(), input.size());
        dummyFile.close();
    }

public:
    static std::string convertToBrep(const TopoDS_Shape& input)
    {
        std::ostringstream oss;
        BRepTools::Write(input, oss);
        return oss.str();
    }

    static TopoDS_Shape convertFromBrep(const std::string& input)
    {
        std::istringstream iss(input);
        TopoDS_Shape output;
        BRep_Builder builder;
        BRepTools::Read(output, iss, builder);
        return output;
    }

    static std::optional<ShapeNode> convertFromStep(const Uint8Array& buffer)
    {
        std::vector<uint8_t> input = convertJSArrayToNumberVector<uint8_t>(buffer);
        VectorBuffer vectorBuffer(input);
        std::istream iss(&vectorBuffer);

        STEPCAFControl_Reader cafReader;
        cafReader.SetColorMode(true);
        cafReader.SetNameMode(true);
        IFSelect_ReturnStatus readStatus = cafReader.ReadStream("stp", iss);

        if (readStatus != IFSelect_RetDone) {
            return std::nullopt;
        }

        Handle(TDocStd_Document) document = new TDocStd_Document("bincaf");
        if (!cafReader.Transfer(document)) {
            return std::nullopt;
        }

        return parseNodeFromDocument(document);
    }

    static std::optional<ShapeNode> convertFromIges(const Uint8Array& buffer)
    {
        std::string dummyFileName = "temp.igs";
        writeBufferToFile(dummyFileName, buffer);

        IGESCAFControl_Reader igesCafReader;
        igesCafReader.SetColorMode(true);
        igesCafReader.SetNameMode(true);
        if (igesCafReader.ReadFile(dummyFileName.c_str()) != IFSelect_RetDone) {
            std::remove(dummyFileName.c_str());
            return std::nullopt;
        }

        Handle(TDocStd_Document) document = new TDocStd_Document("bincaf");
        if (!igesCafReader.Transfer(document)) {
            std::remove(dummyFileName.c_str());
            return std::nullopt;
        }
        std::remove(dummyFileName.c_str());
        return parseNodeFromDocument(document);
    }

    static std::string convertToStep(const ShapeArray& input)
    {
        auto shapes = vecFromJSArray<TopoDS_Shape>(input);
        std::ostringstream oss;
        STEPControl_Writer stepWriter;
        for (const auto& shape : shapes) {
            stepWriter.Transfer(shape, STEPControl_AsIs);
        }
        stepWriter.WriteStream(oss);
        return oss.str();
    }

    static std::string convertToIges(const ShapeArray& input)
    {
        auto shapes = vecFromJSArray<TopoDS_Shape>(input);
        std::ostringstream oss;
        IGESControl_Writer igesWriter;
        for (const auto& shape : shapes) {
            igesWriter.AddShape(shape);
        }
        igesWriter.ComputeModel();
        igesWriter.Write(oss);
        return oss.str();
    }

    static std::optional<ShapeNode> convertFromStl(const Uint8Array& buffer)
    {
        std::string dummyFileName = "temp.stl";
        writeBufferToFile(dummyFileName, buffer);

        StlAPI_Reader stlReader;
        TopoDS_Shape shape;
        if (!stlReader.Read(shape, dummyFileName.c_str())) {
            return std::nullopt;
        }

        ShapeNode node = { .shape = shape,
            .color = std::nullopt,
            .children = {},
            .name = "STL Shape" };

        return node;
    }

    static std::string convertToStl(const TopoDS_Shape& shapeToExport)
    {
        std::string dummyFileName = "temp_export.stl";
        auto lineDeflection = boundingBoxRatio(shapeToExport, 0.05);
        BRepMesh_IncrementalMesh mesh(shapeToExport, lineDeflection, true, 0.2,
            true);
        StlAPI_Writer stlWriter;
        if (!stlWriter.Write(shapeToExport, dummyFileName.c_str())) {
            BRepTools::Clean(shapeToExport, true);
            return std::string();
        }
        BRepTools::Clean(shapeToExport, true);

        std::ifstream in(dummyFileName);
        std::istreambuf_iterator<char> beg(in), end;
        std::string str(beg, end);
        in.close();

        return str;
    }

    static NumberArray convertToStlBinary(const TopoDS_Shape& shapeToExport)
    {

        if (shapeToExport.IsNull()) {
            std::vector<uint8_t> dummy;
            return NumberArray(val::array(dummy));
        }

        std::vector<Vector3f> vertexList;
        std::vector<unsigned int> vertexIndex;

        shapeToTriangle(shapeToExport, vertexList, vertexIndex);

        constexpr int headerByteLength = 80;
        char header[headerByteLength] = "chili 3d stl";
        std::vector<uint8_t> binData(header, header + headerByteLength);
        const unsigned int allFaceCnt = vertexIndex.size() / 3;
        {
            const auto* bytes = reinterpret_cast<const uint8_t*>(&allFaceCnt);
            binData.insert(binData.end(), bytes, bytes + sizeof(unsigned int));
        }

        Facet facet;
        for (unsigned int i = 0; i < allFaceCnt; ++i) {
            facet.vertA = vertexList.at(vertexIndex[i * 3 + 0]);
            facet.vertB = vertexList.at(vertexIndex[i * 3 + 1]);
            facet.vertC = vertexList.at(vertexIndex[i * 3 + 2]);

            const auto AB = facet.vertB - facet.vertA;
            const auto AC = facet.vertC - facet.vertA;

            facet.normal = Vector3f::crossProduct(AB, AC);
            facet.normal.normalize();
            {
                const auto* bytes = reinterpret_cast<const uint8_t*>(&facet);
                binData.insert(binData.end(), bytes, bytes + sizeof(facet));
            }
            // padding
            binData.push_back(0);
            binData.push_back(0);
        }
        return NumberArray(val::array(binData));
    }

    static std::string shapeToObjStr(const TopoDS_Shape& shape, int index, unsigned int& vertsCnt,
        unsigned int& normsCnt)
    {
        if (shape.IsNull()) {
            return {};
        }

        std::vector<Vector3f> vertexList;
        std::vector<unsigned int> vertexIndex;
        std::vector<Vector3f> normalList;

        shapeToTriangle(shape, vertexList, vertexIndex);

        const unsigned int allFaceCnt = vertexIndex.size() / 3;
        normalList.reserve(allFaceCnt);

        for (unsigned int i = 0; i < allFaceCnt; ++i) {
            const auto vertA = vertexList.at(vertexIndex[i * 3 + 0]);
            const auto vertB = vertexList.at(vertexIndex[i * 3 + 1]);
            const auto vertC = vertexList.at(vertexIndex[i * 3 + 2]);

            const auto AB = vertB - vertA;
            const auto AC = vertC - vertA;

            auto normal = Vector3f::crossProduct(AB, AC);
            normal.normalize();
            normalList.push_back(normal);
        }

        std::vector<Vector3f> uniqueVertexList = vertexList;
        std::vector<Vector3f> uniqueNormalList = normalList;
        // make unique
        removeVec3ArrDuplicates(uniqueVertexList);
        removeVec3ArrDuplicates(uniqueNormalList);

        // speed up for index of
        auto vertMap = buildVec3ArrIndexMap(uniqueVertexList);
        auto normMap = buildVec3ArrIndexMap(uniqueNormalList);

        std::string content = format("o geometry_%d\n", index);
        {
            // unique vertex
            for (const auto& vertex : uniqueVertexList) {
                content += format("v %f %f %f \n", vertex.x(), vertex.y(), vertex.z());
            }

            // unique normal
            for (const auto& normal : uniqueNormalList) {
                content += format("vn %f %f %f \n", normal.x(), normal.y(), normal.z());
            }

            for (unsigned int i = 0; i < allFaceCnt; ++i) {
                const auto vertA = vertexList.at(vertexIndex[i * 3 + 0]);
                const auto vertB = vertexList.at(vertexIndex[i * 3 + 1]);
                const auto vertC = vertexList.at(vertexIndex[i * 3 + 2]);
                const auto normal = normalList.at(i);

                const auto idxA = vertMap.at(vertA) + 1 + vertsCnt;
                const auto idxB = vertMap.at(vertB) + 1 + vertsCnt;
                const auto idxC = vertMap.at(vertC) + 1 + vertsCnt;
                const auto idxN = normMap.at(normal) + 1 + normsCnt;

                content += format("f %d//%d  %d//%d  %d//%d\n", idxA, idxN, idxB, idxN, idxC, idxN);
            }
            vertsCnt += uniqueVertexList.size();
            normsCnt += uniqueNormalList.size();
        }
        return content;
    }

    static std::string convertToObj(const ShapeArray& input)
    {
        auto shapes = vecFromJSArray<TopoDS_Shape>(input);
        if (shapes.empty()) {
            return {};
        }

        unsigned int vertsCnt = 0;
        unsigned int normsCnt = 0;

        std::string allContent = "# export by chili3d\n";
        for (int i = 0; i < shapes.size(); ++i) {
            allContent += shapeToObjStr(shapes[i], i, vertsCnt, normsCnt);
        }
        return allContent;
    }

    static std::string convertToPly(const TopoDS_Shape& shapeToExport)
    {
        if (shapeToExport.IsNull()) {
            return {};
        }

        std::vector<Vector3f> vertexList;
        std::vector<unsigned int> vertexIndex;
        shapeToTriangle(shapeToExport, vertexList, vertexIndex);

        tinyply::PlyFile plyFile;
        plyFile.add_properties_to_element(
            "vertex", { "x", "y", "z" }, tinyply::Type::FLOAT32, vertexList.size(),
            reinterpret_cast<uint8_t*>(vertexList.data()), tinyply::Type::INVALID, 0);

        plyFile.add_properties_to_element("face", { "vertex_indices" },
            tinyply::Type::UINT32, vertexIndex.size() / 3, reinterpret_cast<uint8_t*>(vertexIndex.data()), tinyply::Type::UINT8, 3);
        plyFile.get_comments().push_back("generated by chili3d");

        std::ostringstream oss;
        plyFile.write(oss, false);

        return oss.str();
    }

    static NumberArray convertToPlyBinary(const TopoDS_Shape& shapeToExport)
    {
        if (shapeToExport.IsNull()) {
            std::vector<uint8_t> dummy;
            return NumberArray(val::array(dummy));
        }

        std::vector<Vector3f> vertexList;
        std::vector<unsigned int> vertexIndex;
        shapeToTriangle(shapeToExport, vertexList, vertexIndex);

        tinyply::PlyFile plyFile;
        plyFile.add_properties_to_element(
            "vertex", { "x", "y", "z" }, tinyply::Type::FLOAT32, vertexList.size(),
            reinterpret_cast<uint8_t*>(vertexList.data()), tinyply::Type::INVALID, 0);

        plyFile.add_properties_to_element("face", { "vertex_indices" },
            tinyply::Type::UINT32, vertexIndex.size() / 3, reinterpret_cast<uint8_t*>(vertexIndex.data()), tinyply::Type::UINT8, 3);
        plyFile.get_comments().push_back("generated by chili3d");

        std::vector<uint8_t> binData;
        BinaryBuffer binBuffer(binData);
        std::ostream os(&binBuffer);
        plyFile.write(os, true);

        return NumberArray(val::array(binData));
    }
};

EMSCRIPTEN_BINDINGS(Converter)
{
    register_optional<ShapeNode>();

    register_type<ShapeNodeArray>("Array<ShapeNode>");

    class_<ShapeNode>("ShapeNode")
        .property("shape", &ShapeNode::shape, return_value_policy::reference())
        .property("color", &ShapeNode::color)
        .property("name", &ShapeNode::name)
        .function("getChildren", &ShapeNode::getChildren);

    class_<Converter>("Converter")
        .class_function("convertToBrep", &Converter::convertToBrep)
        .class_function("convertFromBrep", &Converter::convertFromBrep)
        .class_function("convertFromStep", &Converter::convertFromStep)
        .class_function("convertFromIges", &Converter::convertFromIges)
        .class_function("convertToStep", &Converter::convertToStep)
        .class_function("convertToIges", &Converter::convertToIges)
        .class_function("convertFromStl", &Converter::convertFromStl)
        .class_function("convertToStl", &Converter::convertToStl)
        .class_function("convertToStlBinary", &Converter::convertToStlBinary)
        .class_function("convertToObj", &Converter::convertToObj)
        .class_function("convertToPly", &Converter::convertToPly)
        .class_function("convertToPlyBinary", &Converter::convertToPlyBinary);
}