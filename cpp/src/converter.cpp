#include "shared.hpp"
#include <BRep_Builder.hxx>
#include <BRepTools.hxx>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <IGESCAFControl_Reader.hxx>
#include <Quantity_Color.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDocStd_Document.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <STEPControl_Writer.hxx>
#include <IGESControl_Writer.hxx>

using namespace emscripten;

class VectorBuffer : public std::streambuf
{
public:
    VectorBuffer(const std::vector<uint8_t> &v)
    {
        setg((char *)v.data(), (char *)v.data(), (char *)(v.data() + v.size()));
    }
};

EMSCRIPTEN_DECLARE_VAL_TYPE(ShapeNodeArray)

struct ShapeNode
{
    std::optional<TopoDS_Shape> shape;
    std::string color;
    std::vector<ShapeNode> children;
    std::string name;

    ShapeNodeArray getChildren() const
    {
        return ShapeNodeArray(val::array(children));
    }
};

static std::string getLabelNameNoRef(const TDF_Label &label)
{
    Handle(TDataStd_Name) nameAttribute = new TDataStd_Name();
    if (!label.FindAttribute(nameAttribute->GetID(), nameAttribute))
    {
        return std::string();
    }

    Standard_Integer utf8NameLength = nameAttribute->Get().LengthOfCString();
    char *nameBuf = new char[utf8NameLength + 1];
    nameAttribute->Get().ToUTF8CString(nameBuf);
    std::string name(nameBuf, utf8NameLength);
    delete[] nameBuf;
    return name;
}

static std::string getLabelName(const TDF_Label &label, const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    if (XCAFDoc_ShapeTool::IsReference(label))
    {
        TDF_Label referredShapeLabel;
        shapeTool->GetReferredShape(label, referredShapeLabel);
        return getLabelName(referredShapeLabel, shapeTool);
    }
    return getLabelNameNoRef(label);
}

static std::string getShapeName(const TopoDS_Shape &shape, const Handle(XCAFDoc_ShapeTool) & shapeTool)
{
    TDF_Label shapeLabel;
    if (!shapeTool->Search(shape, shapeLabel))
    {
        return std::string();
    }
    return getLabelName(shapeLabel, shapeTool);
}

static bool getLabelColorNoRef(const TDF_Label &label, const Handle(XCAFDoc_ColorTool) & colorTool, std::string &color)
{
    static const std::vector<XCAFDoc_ColorType> colorTypes = {
        XCAFDoc_ColorSurf,
        XCAFDoc_ColorCurv,
        XCAFDoc_ColorGen};

    Quantity_Color qColor;
    for (XCAFDoc_ColorType colorType : colorTypes)
    {
        if (colorTool->GetColor(label, colorType, qColor))
        {
            color = std::string(Quantity_Color::ColorToHex(qColor).ToCString());
            return true;
        }
    }

    return false;
}

static bool getLabelColor(const TDF_Label &label, const Handle(XCAFDoc_ShapeTool) & shapeTool, const Handle(XCAFDoc_ColorTool) & colorTool, std::string &color)
{
    if (getLabelColorNoRef(label, colorTool, color))
    {
        return true;
    }

    if (XCAFDoc_ShapeTool::IsReference(label))
    {
        TDF_Label referredShape;
        shapeTool->GetReferredShape(label, referredShape);
        return getLabelColor(referredShape, shapeTool, colorTool, color);
    }

    return false;
}

static bool getShapeColor(const TopoDS_Shape &shape, const Handle(XCAFDoc_ShapeTool) & shapeTool, const Handle(XCAFDoc_ColorTool) & colorTool, std::string &color)
{
    TDF_Label shapeLabel;
    if (!shapeTool->Search(shape, shapeLabel))
    {
        return false;
    }
    return getLabelColor(shapeLabel, shapeTool, colorTool, color);
}

static ShapeNode initNode(const TDF_Label label, const Handle(XCAFDoc_ShapeTool) shapeTool, const Handle(XCAFDoc_ColorTool) colorTool)
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

static void addChildNodes(ShapeNode &parent, const TDF_Label &parentLabel, const Handle(XCAFDoc_ShapeTool) & shapeTool, const Handle(XCAFDoc_ColorTool) & colorTool)
{
    for (TDF_ChildIterator it(parentLabel); it.More(); it.Next())
    {
        TDF_Label childLabel = it.Value();
        TopoDS_Shape tmpShape;
        if (shapeTool->GetShape(childLabel, tmpShape) && shapeTool->IsFree(childLabel))
        {
            ShapeNode childNode = initNode(childLabel, shapeTool, colorTool);
            childNode.shape = tmpShape;
            parent.children.push_back(childNode);

            addChildNodes(childNode, childLabel, shapeTool, colorTool);
        }
    }
}

static ShapeNode getNodesFromDocument(Handle(TDocStd_Document) document)
{
    TDF_Label mainLabel = document->Main();
    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(mainLabel);
    Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(mainLabel);

    TDF_Label shapeLabel = shapeTool->Label();
    ShapeNode rootNode = initNode(shapeLabel, shapeTool, colorTool);
    TopoDS_Shape tmpShape;
    if (shapeTool->GetShape(shapeLabel, tmpShape) && shapeTool->IsFree(shapeLabel))
    {
        rootNode.shape = tmpShape;
    }
    addChildNodes(rootNode, shapeLabel, shapeTool, colorTool);

    return rootNode;
}

class Converter
{
public:
    static std::string convertToBrep(const TopoDS_Shape &input)
    {
        std::ostringstream oss;
        BRepTools::Write(input, oss);
        return oss.str();
    }

    static TopoDS_Shape convertFromBrep(const std::string &input)
    {
        std::istringstream iss(input);
        TopoDS_Shape output;
        BRep_Builder builder;
        BRepTools::Read(output, iss, builder);
        return output;
    }

    static std::optional<ShapeNode> convertFromStep(const Uint8Array &buffer)
    {
        std::vector<uint8_t> input = convertJSArrayToNumberVector<uint8_t>(buffer);
        VectorBuffer vectorBuffer(input);
        std::istream iss(&vectorBuffer);

        STEPCAFControl_Reader cafReader;
        cafReader.SetColorMode(true);
        cafReader.SetNameMode(true);
        IFSelect_ReturnStatus readStatus = cafReader.ReadStream("stp", iss);

        if (readStatus != IFSelect_RetDone)
        {
            return std::nullopt;
        }

        Handle(TDocStd_Document) document = new TDocStd_Document("bincaf");
        if (!cafReader.Transfer(document))
        {
            return std::nullopt;
        }

        return getNodesFromDocument(document);
    }

    static std::optional<ShapeNode> convertFromIges(const Uint8Array &buffer)
    {
        std::vector<uint8_t> input = convertJSArrayToNumberVector<uint8_t>(buffer);
        std::string dummyFileName = "temp.igs";
        std::ofstream dummyFile;
        dummyFile.open(dummyFileName, std::ios::binary);
        dummyFile.write((char *)input.data(), input.size());
        dummyFile.close();

        IGESCAFControl_Reader igesCafReader;
        igesCafReader.SetColorMode(true);
        igesCafReader.SetNameMode(true);
        IFSelect_ReturnStatus readStatus = igesCafReader.ReadFile(dummyFileName.c_str());

        if (readStatus != IFSelect_RetDone)
        {
            return std::nullopt;
        }

        Handle(TDocStd_Document) document = new TDocStd_Document("bincaf");
        if (!igesCafReader.Transfer(document))
        {
            return std::nullopt;
        }

        return getNodesFromDocument(document);
    }

    static std::string convertToStep(const ShapeArray &input)
    {
        auto shapes = vecFromJSArray<TopoDS_Shape>(input);
        std::ostringstream oss;
        STEPControl_Writer stepWriter;
        for (const auto &shape : shapes)
        {
            stepWriter.Transfer(shape, STEPControl_AsIs);
        }
        stepWriter.WriteStream(oss);
        return oss.str();
    }

    static std::string convertToIges(const ShapeArray &input)
    {
        auto shapes = vecFromJSArray<TopoDS_Shape>(input);
        std::ostringstream oss;
        IGESControl_Writer igesWriter;
        for (const auto &shape : shapes)
        {
            igesWriter.AddShape(shape);
        }
        igesWriter.ComputeModel();
        igesWriter.Write(oss);
        return oss.str();
    }

};

EMSCRIPTEN_BINDINGS(Converter)
{
    register_optional<ShapeNode>();

    register_type<ShapeNodeArray>("Array<ShapeNode>");

    class_<ShapeNode>("ShapeNode")
        .property("shape", &ShapeNode::shape)
        .property("color", &ShapeNode::color)
        .property("name", &ShapeNode::name)
        .function("getChildren", &ShapeNode::getChildren)
    ;

    class_<Converter>("Converter")
        .class_function("convertToBrep", &Converter::convertToBrep)
        .class_function("convertFromBrep", &Converter::convertFromBrep)
        .class_function("convertFromStep", &Converter::convertFromStep)
        .class_function("convertFromIges", &Converter::convertFromIges)
        .class_function("convertToStep", &Converter::convertToStep)
        .class_function("convertToIges", &Converter::convertToIges)

    ;
}