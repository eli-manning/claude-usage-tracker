import Foundation
import Combine

@MainActor
final class UsageService: ObservableObject {
    @Published var claude: ClaudeUsage = .empty
    @Published var antigravity: GeminiUsage?
    @Published var providers: [String: ProviderStatus] = [:]
    @Published var isRefreshing = false

    private var timer: Timer?
    private let scriptPath: String
    private let antigravityScriptPath: String

    init() {
        // scripts/*.js sit next to the executable in dev (swift run resolves
        // relative to the package root's working directory).
        scriptPath = Self.resolveScriptPath("fetch-usage.js")
        antigravityScriptPath = Self.resolveScriptPath("fetch-antigravity-usage.js")
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    private static func resolveScriptPath(_ name: String) -> String {
        let candidates = [
            FileManager.default.currentDirectoryPath + "/scripts/" + name,
            Bundle.main.bundlePath + "/Contents/Resources/scripts/" + name,
        ]
        return candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) ?? candidates[0]
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        async let usage = fetchClaudeUsage()
        async let detected = detectOtherProviders()
        let (usageResult, providerResult) = await (usage, detected)

        applyClaudeUsage(usageResult)
        var newProviders = providerResult

        // Only the CLI itself can tell us whether it's actually signed in
        // and what the real quota is — `which agy` just proves the binary
        // exists, so this runs after detection and only when detection
        // found it installed.
        if newProviders["antigravity"]?.state == .installed {
            if let result = await fetchAntigravityUsage() {
                if let err = result.error {
                    // A transient failure (agy hiccuped, the PTY drive timed
                    // out) shouldn't blank out wedges that were showing real
                    // percentages a moment ago — keep `antigravity` as-is
                    // and just surface the error in provider state. Same
                    // reasoning as `applyClaudeUsage` below.
                    newProviders["antigravity"] = ProviderStatus(state: .error(err))
                } else if result.signedIn == false {
                    antigravity = result
                    newProviders["antigravity"] = ProviderStatus(state: .installed)
                } else {
                    antigravity = result
                    newProviders["antigravity"] = ProviderStatus(state: .loggedIn)
                }
            }
        }
        providers = newProviders
    }

    /// Ports the same caching rule `os-menu/main.js`'s `applyUsageData` uses
    /// for the tray app: a fetch that came back as pure error (offline, CLI
    /// hiccup, timed out) shouldn't blank real percentages that were showing
    /// a moment ago — keep the last good `claude` on screen and just record
    /// the error alongside it. Only a fetch that actually returned data
    /// (session/weekly present) replaces it wholesale.
    private func applyClaudeUsage(_ data: ClaudeUsage?) {
        guard let data else { return }
        let isFailure = data.error != nil && data.session == nil && data.weekly == nil && data.stats == nil
        if isFailure {
            claude.error = data.error
            claude.errorType = data.errorType
            return
        }
        claude = data
    }

    private func fetchAntigravityUsage() async -> GeminiUsage? {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", antigravityScriptPath]

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            process.terminationHandler = { _ in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                continuation.resume(returning: try? JSONDecoder().decode(GeminiUsage.self, from: data))
            }

            do {
                try process.run()
            } catch {
                continuation.resume(returning: nil)
            }
        }
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

    /// Detection comes straight off each `Provider`'s own `loginCommand` via
    /// `which` — no separate lookup table to keep in sync with `Provider.all`
    /// as providers are added.
    private func detectOtherProviders() async -> [String: ProviderStatus] {
        var result: [String: ProviderStatus] = [:]
        for provider in Provider.all where provider.id != "claude" {
            let installed = provider.loginCommand.map(Self.which) ?? false
            result[provider.id] = ProviderStatus(state: installed ? .installed : .notInstalled)
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
