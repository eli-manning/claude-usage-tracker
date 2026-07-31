// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "DynamicIslandNative",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "DynamicIslandNative"
        )
    ]
)
