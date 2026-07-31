import Foundation
import Combine

@MainActor
final class UsageService: ObservableObject {
    @Published var claude: ClaudeUsage = .empty
    @Published var providers: [String: ProviderStatus] = [:]
    @Published var isRefreshing = false

    private var timer: Timer?
    private let scriptPath: String
    private let providerBins = ["gemini": "gemini", "codex": "codex", "cursor": "cursor-agent"]

    init() {
        // scripts/fetch-usage.js sits next to the executable in dev (swift run
        // resolves relative to the package root's working directory).
        scriptPath = Self.resolveScriptPath()
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    private static func resolveScriptPath() -> String {
        let candidates = [
            FileManager.default.currentDirectoryPath + "/scripts/fetch-usage.js",
            Bundle.main.bundlePath + "/Contents/Resources/scripts/fetch-usage.js",
        ]
        return candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) ?? candidates[0]
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        async let usage = fetchClaudeUsage()
        async let detected = detectOtherProviders()
        let (usageResult, providerResult) = await (usage, detected)

        if let usageResult {
            claude = usageResult
        }
        providers = providerResult
    }

    private func fetchClaudeUsage() async -> ClaudeUsage? {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", scriptPath]

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            process.terminationHandler = { _ in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .millisecondsSince1970
                if var parsed = try? decoder.decode(ClaudeUsage.self, from: data) {
                    if parsed.session != nil || parsed.weekly != nil {
                        parsed.lastUpdated = Date()
                    }
                    continuation.resume(returning: parsed)
                } else {
                    continuation.resume(returning: nil)
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    private func detectOtherProviders() async -> [String: ProviderStatus] {
        var result: [String: ProviderStatus] = [:]
        for (key, bin) in providerBins {
            result[key] = ProviderStatus(installed: Self.which(bin))
        }
        return result
    }

    private static func which(_ bin: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["which", bin]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }
}
