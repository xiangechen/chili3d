cmake_minimum_required (VERSION 3.30)

project (chili-wasm)
set (CMAKE_CXX_STANDARD 17)
set (TARGET chili-wasm)
set (CMAKE_CONFIGURATION_TYPES Debug;Release)
set (CMAKE_NINJA_FORCE_RESPONSE_FILE 1 CACHE INTERNAL "")

get_filename_component(SOURCE_ROOT_DIR ${CMAKE_SOURCE_DIR} DIRECTORY)
set(CMAKE_INSTALL_PREFIX "${SOURCE_ROOT_DIR}/packages/wasm/lib")

set (OcctToolkits
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
    TKDE TKXSBase TKXCAF TKDESTEP TKDEIGES TKDESTL
)

include(build/occt/src/MODULES.cmake)

set (OcctSourceFolders)
set (OcctIncludeDirs)
foreach(module ${OCCT_LIST_OF_MODULES})
    include(build/occt/src/${module}/TOOLKITS.cmake)
    foreach(toolkit ${OcctToolkits})
        list(FIND OCCT_${module}_LIST_OF_TOOLKITS ${toolkit} _idx)
        if(_idx GREATER_EQUAL 0)
            include(build/occt/src/${module}/${toolkit}/PACKAGES.cmake)
            foreach(package ${OCCT_${toolkit}_LIST_OF_PACKAGES})
                if (NOT package STREQUAL "")
                    list (APPEND OcctSourceFolders build/occt/src/${module}/${toolkit}/${package}/*.c*)
                    list (APPEND OcctIncludeDirs build/occt/src/${module}/${toolkit}/${package})
                endif()
            endforeach()
        endif()
    endforeach()
endforeach()

include(build/occt/adm/cmake/version.cmake)
configure_file("build/occt/adm/templates/Standard_Version.hxx.in" "include/Standard_Version.hxx" @ONLY)
list (APPEND OcctIncludeDirs ${CMAKE_CURRENT_BINARY_DIR}/include)

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

    add_library(occt STATIC ${OcctSourceFiles})
    target_include_directories (occt PUBLIC ${OcctIncludeDirs})
    target_compile_options (occt PUBLIC
        $<$<CONFIG:Release>:-Os>
        $<$<CONFIG:Release>:-flto>
        $<IF:$<CONFIG:Release>,-sDISABLE_EXCEPTION_CATCHING=1,-sDISABLE_EXCEPTION_CATCHING=0>
        -DOCCT_NO_PLUGINS
    )

    add_executable (${TARGET} ${ChiliWasmSourceFiles})
    target_include_directories (${TARGET} PUBLIC ${OcctIncludeDirs})
    target_compile_options (${TARGET} PUBLIC
        $<$<CONFIG:Release>:-Os>
        $<$<CONFIG:Release>:-flto>
        $<IF:$<CONFIG:Release>,-sDISABLE_EXCEPTION_CATCHING=1,-sDISABLE_EXCEPTION_CATCHING=0>
    )
    target_link_libraries(${TARGET} PUBLIC occt)
    target_link_options (${TARGET} PUBLIC
        $<IF:$<CONFIG:Release>,-Os,-O0>
        $<IF:$<CONFIG:Release>,-flto,-fno-lto>
        $<IF:$<CONFIG:Release>,-sDISABLE_EXCEPTION_CATCHING=1,-sDISABLE_EXCEPTION_CATCHING=0>
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sSTACK_SIZE=8MB
        -sINITIAL_HEAP=64MB
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=4GB
        -sENVIRONMENT="web"
        --bind
        --emit-tsd "${TARGET}.d.ts"
    )

    install(TARGETS ${TARGET} DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.wasm DESTINATION ${CMAKE_INSTALL_PREFIX})
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${TARGET}.d.ts DESTINATION ${CMAKE_INSTALL_PREFIX})

endif ()