cmake_minimum_required (VERSION 3.30)

project (chili-wasm VERSION 0.4.0)
set (CMAKE_CXX_STANDARD 17)
set (TARGET chili-wasm)

get_filename_component(SOURCE_ROOT_DIR ${CMAKE_SOURCE_DIR} DIRECTORY)
set(CMAKE_INSTALL_PREFIX "${SOURCE_ROOT_DIR}/packages/chili-wasm/lib")

set (OcctSourceFolders)
set (OcctIncludeDirs)
set (OcctModules 
    Adaptor2d
    Adaptor3d
    AdvApp2Var
    AdvApprox
    AIS
    APIHeaderSection
    AppBlend
    AppCont
    AppDef
    AppParCurves
    Approx
    ApproxInt
    Aspect
    BinDrivers
    BinLDrivers
    BinMDataStd
    BinMDataXtd
    BinMDF
    BinMDocStd
    BinMDocXtd
    BinMNaming
    BinMFunction
    BinMXCAFDoc
    BinObjMgt
    BinTools
    BinXCAFDrivers
    Bisector
    Bnd
    BndLib
    BOPAlgo
    BOPDS
    BOPTools
    BRep
    BRepAdaptor
    BRepAlgo
    BRepAlgoAPI
    BRepApprox
    BRepBndLib
    BRepBuilderAPI
    BRepCheck
    BRepClass
    BRepClass3d
    BRepExtrema
    BRepFill
    BRepGProp
    BRepIntCurveSurface
    BRepLib
    BRepLProp
    BRepMAT2d
    BRepMesh
    BRepMeshData
    BRepPrim
    BRepPrimAPI
    BRepSweep
    BRepToIGES
    BRepToIGESBRep
    BRepTools
    BRepTopAdaptor
    BSplCLib
    BSplSLib
    BVH
    CDF
    CDM
    Contap
    Convert
    CPnts
    CSLib
    DE
    DsgPrs
    ElCLib
    ElSLib
    Extrema
    FEmTool
    FlexLexer
    Font
    FSD
    GC
    GccAna
    GccEnt
    GccInt
    gce
    GCE2d
    GCPnts
    Geom
    Geom2d
    Geom2dAdaptor
    Geom2dAPI
    Geom2dConvert
    Geom2dEvaluator
    Geom2dGcc
    Geom2dHatch
    Geom2dInt
    Geom2dLProp
    Geom2dToIGES
    GeomAbs
    GeomAdaptor
    GeomAPI
    GeomConvert
    GeomEvaluator
    GeomFill
    GeomInt
    GeomLib
    GeomLProp
    GeomPlate
    GeomProjLib
    GeomToIGES
    GeomTools
    GeomToStep
    gp
    GProp
    Graphic3d
    Hatch
    HatchGen
    HeaderSection
    Hermit
    HLRAlgo
    HLRBRep
    HLRTopoBRep
    IFGraph
    IFSelect
    IGESAppli
    IGESBasic
    IGESCAFControl
    IGESControl
    IGESConvGeom
    IGESData
    IGESDefs
    IGESDimen
    IGESDraw
    IGESFile
    IGESGeom
    IGESGraph
    IGESSelect
    IGESSolid
    IGESToBRep
    Image
    IMeshData
    IMeshTools
    IntAna
    IntAna2d
    IntCurve
    IntCurvesFace
    IntCurveSurface
    Interface
    Intf
    IntImp
    IntImpParGen
    IntPatch
    IntPolyh
    IntRes2d
    Intrv
    IntStart
    IntSurf
    IntTools
    IntWalk
    Law
    LDOM
    LDOMParser
    LibCtl
    LocalAnalysis
    LProp
    LProp3d
    MAT
    MAT2d
    math
    Media
    Message
    MoniTool
    NCollection
    OSD
    PCDM
    Plate
    PLib
    Plugin
    Poly
    Precision
    ProjLib
    Prs3d
    PrsDim
    PrsMgr
    Quantity
    Resource
    RWHeaderSection
    RWStepAP203
    RWStepAP214
    RWStepAP242
    RWStepBasic
    RWStepDimTol
    RWStepElement
    RWStepFEA
    RWStepGeom
    RWStepKinematics
    RWStepRepr
    RWStepShape
    RWStepVisual
    Select3D
    SelectBasics
    SelectMgr
    ShapeAlgo
    ShapeAnalysis
    ShapeBuild
    ShapeConstruct
    ShapeCustom
    ShapeExtend
    ShapeFix
    ShapeProcess
    ShapeUpgrade
    Standard
    StdFail
    StdPrs
    StdSelect
    StepAP203
    StepAP214
    StepAP242
    StepBasic
    STEPCAFControl
    STEPConstruct
    STEPControl
    StepData
    StepDimTol
    STEPEdit
    StepElement
    StepFEA
    StepFile
    StepGeom
    StepKinematics
    StepRepr
    StepSelect
    STEPSelections
    StepShape
    StepToGeom
    StepToTopoDS
    StepVisual
    Storage
    Sweep
    TColGeom
    TColGeom2d
    TColgp
    TCollection
    TColStd
    TDataStd
    TDataXtd
    TDF
    TDocStd
    TFunction
    TNaming
    TopAbs
    TopBas
    TopClass
    TopCnx
    TopExp
    TopLoc
    TopoDS
    TopoDSToStep
    TopOpeBRepBuild
    TopOpeBRepDS
    TopOpeBRepTool
    TopTools
    TopTrans
    TPrsStd
    Transfer
    TransferBRep
    TShort
    Units
    UnitsAPI
    UnitsMethods
    UTL
    V3d
    WNT
    XCAFDimTolObjects
    XCAFDoc
    XCAFNoteObjects
    XCAFPrs
    XCAFView
    XSAlgo
    XSControl
)

foreach(module ${OcctModules})
    list (APPEND OcctSourceFolders build/occt/src/${module}/*.c*)
    list (APPEND OcctIncludeDirs build/occt/src/${module})
endforeach()

file (GLOB OcctSourceFiles ${OcctSourceFolders})

set (ChiliWasmSourcesFolder src)
file (GLOB
    ChiliWasmSourceFiles CONFIGURE_DEPENDS
    ${ChiliWasmSourcesFolder}/*.hpp
    ${ChiliWasmSourcesFolder}/*.cpp
)
source_group ("Sources" FILES ${ChiliWasmSourceFiles})
source_group ("OCCT" FILES ${OcctSourceFiles})

if (${EMSCRIPTEN})
    add_executable (${TARGET} ${ChiliWasmSourceFiles} ${OcctSourceFiles})

    target_compile_options (${TARGET} PUBLIC -O3)
    target_compile_options (${TARGET} PUBLIC -flto)
    target_compile_options (${TARGET} PUBLIC -DOCCT_NO_PLUGINS)

    target_link_options (${TARGET} PUBLIC -flto)
    target_link_options (${TARGET} PUBLIC -O3)
    target_link_options (${TARGET} PUBLIC -sMODULARIZE=1)
    target_link_options (${TARGET} PUBLIC -sEXPORT_ES6=1)
    target_link_options (${TARGET} PUBLIC -sEXPORT_NAME='ChiliWasm')
    target_link_options (${TARGET} PUBLIC -sALLOW_MEMORY_GROWTH=1)
    target_link_options (${TARGET} PUBLIC -sENVIRONMENT="web")
    target_link_options (${TARGET} PUBLIC --bind)
    target_link_options (${TARGET} PUBLIC --emit-tsd "${TARGET}.d.ts")

    target_include_directories (${TARGET} PUBLIC ${OcctIncludeDirs})

    install(TARGETS ${TARGET} DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.wasm DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.d.ts DESTINATION ${CMAKE_INSTALL_PREFIX})
endif ()