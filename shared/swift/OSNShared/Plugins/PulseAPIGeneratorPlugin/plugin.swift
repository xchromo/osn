import Foundation
import PackagePlugin

/// Runs the pinned `swift-openapi-generator` binary against
/// `shared/openapi/pulse.json` at build time. The spec lives outside this
/// package (`shared/openapi/`, a sibling of `shared/swift/`), so the
/// official generator's SPM build plugin — which only auto-discovers a spec
/// in the *generating target's own source directory* — cannot see it. This
/// plugin sidesteps that by passing the spec's path explicitly instead of
/// relying on auto-discovery, and by invoking the exact binary the brief
/// specifies rather than letting SPM fetch/build the generator itself.
///
/// Output goes to the plugin work directory, never the source tree — the
/// generated `Types.swift`/`Client.swift` are build products, not commits.
@main
struct PulseAPIGeneratorPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) async throws -> [Command] {
        let specPath = context.package.directory
            .removingLastComponent() // shared/swift
            .removingLastComponent() // shared
            .appending(["openapi", "pulse.json"])

        let generatorPath = Path("/Users/ac/.work/pulse-scratch/bin/swift-openapi-generator")
        let outputDirectory = context.pluginWorkDirectory.appending("GeneratedSources")

        return [
            .prebuildCommand(
                displayName: "Generate Pulse OpenAPI client from \(specPath.string)",
                executable: generatorPath,
                arguments: [
                    "generate",
                    specPath.string,
                    "--mode", "types",
                    "--mode", "client",
                    "--access-modifier", "public",
                    "--naming-strategy", "idiomatic",
                    "--output-directory", outputDirectory.string,
                ],
                outputFilesDirectory: outputDirectory
            )
        ]
    }
}
