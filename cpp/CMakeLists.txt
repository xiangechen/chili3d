cmake_minimum_required (VERSION 3.30)

project (chili-wasm)
set (CMAKE_CXX_STANDARD 17)
set (TARGET chili-wasm)
set (CMAKE_CONFIGURATION_TYPES Debug;Release)

get_filename_component(SOURCE_ROOT_DIR ${CMAKE_SOURCE_DIR} DIRECTORY)
set(CMAKE_INSTALL_PREFIX "${SOURCE_ROOT_DIR}/packages/chili-wasm/lib")

set (OcctModules
    # FoundationClasses
    TKernel TKMath
    # ModelingData 
    TKG2d TKG3d TKGeomBase TKBRep
    # ModelingAlgorithms
    TKGeomAlgo TKTopAlgo TKPrim TKBO TKBool TKHLR TKFillet TKOffset TKFeat TKMesh TKShHealing
    # Visualization
    TKService TKV3d
    # ApplicationFramework
    TKCDF TKLCAF TKCAF TKStdL TKStd TKVCAF TKBin TKBinL TKBinXCAF
    # DataExchange
    TKDE TKXSBase TKXCAF TKDESTEP TKDEIGES
)

set (OcctSourceFolders)
set (OcctIncludeDirs)

foreach(module ${OcctModules})
    file (STRINGS build/occt/src/${module}/PACKAGES OcctPackage)
    foreach(package ${OcctPackage})
        if (NOT package STREQUAL "")
            list (APPEND OcctSourceFolders build/occt/src/${package}/*.c*)
            list (APPEND OcctIncludeDirs build/occt/src/${package})
        endif()
    endforeach()
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

    target_compile_options (${TARGET} PUBLIC
        $<$<CONFIG:Release>:-O3>
        $<$<CONFIG:Release>:-flto>
        $<IF:$<CONFIG:Release>,-sDISABLE_EXCEPTION_CATCHING=1,-sDISABLE_EXCEPTION_CATCHING=0>
        -DOCCT_NO_PLUGINS
    )

    target_link_options (${TARGET} PUBLIC
        $<IF:$<CONFIG:Release>,-O3,-O0>
        $<$<CONFIG:Release>:-flto>
        $<IF:$<CONFIG:Release>,-sDISABLE_EXCEPTION_CATCHING=1,-sDISABLE_EXCEPTION_CATCHING=0>
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sALLOW_MEMORY_GROWTH=1
        -sENVIRONMENT="web"
        --bind
        --emit-tsd "${TARGET}.d.ts"
    )

    target_include_directories (${TARGET} PUBLIC ${OcctIncludeDirs})

    install(TARGETS ${TARGET} DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.wasm DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.d.ts DESTINATION ${CMAKE_INSTALL_PREFIX})
endif ()