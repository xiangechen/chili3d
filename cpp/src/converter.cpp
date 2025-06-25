// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

#include <emscripten/bind.h>
#include <emscripten/val.h>

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
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "shared.hpp"
#include "utils.hpp"

using namespace emscripten;

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
        .class_function("convertFromStl", &Converter::convertFromStl);
}