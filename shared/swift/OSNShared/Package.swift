// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "OSNShared",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "OSNKit", targets: ["OSNKit"]),
        .library(name: "OSNAuth", targets: ["OSNAuth"]),
        .library(name: "OSNUI", targets: ["OSNUI"]),
        .library(name: "OSNTesting", targets: ["OSNTesting"]),
    ],
    targets: [
        .target(name: "OSNKit"),
        .target(name: "OSNAuth", dependencies: ["OSNKit"]),
        .target(name: "OSNUI"),
        .target(name: "OSNTesting", dependencies: ["OSNKit"]),
        .testTarget(name: "OSNKitTests", dependencies: ["OSNKit"]),
    ]
)
