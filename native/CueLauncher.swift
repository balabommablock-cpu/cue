import AppKit
import Carbon
import IOKit.hidsystem

// Read only modifier flags and a key-press counter. No typed characters,
// key event stream, microphone or screen capture is collected by this helper.
final class Launcher: NSObject {
    var hold = SingleModifierHold()
    var pollTimer: Timer?
    var launching = false
    var statusItem: NSStatusItem?
    func recordPhase(_ phase: String) {
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cue Community Launcher")
        let state: [String: Any] = ["phase": phase, "at": ISO8601DateFormatter().string(from: Date()), "shortcut": "hold right Option", "holdSeconds": 0.45]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted]) { try? data.write(to: folder.appendingPathComponent("launcher-state.json"), options: .atomic) }
    }
    func showMenu() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Cue"
        item.button?.toolTip = "Hold right Option for half a second to open Cue and listen"
        let menu = NSMenu()
        let open = NSMenuItem(title: "Open Cue & Start Listening   Hold right ⌥", action: #selector(openFromMenu), keyEquivalent: "")
        open.target = self; menu.addItem(open)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Disable shortcut until next login", action: #selector(quitLauncher), keyEquivalent: "")
        quit.target = self; menu.addItem(quit)
        item.menu = menu; statusItem = item
    }
    @objc func openFromMenu() { openCue() }
    @objc func quitLauncher() { NSApplication.shared.terminate(nil) }
    func sampleShortcut() {
        let flags = CGEventSource.flagsState(.hidSystemState)
        let rightDown = flags.rawValue & UInt64(NX_DEVICERALTKEYMASK) != 0
        let leftDown = flags.rawValue & UInt64(NX_DEVICELALTKEYMASK) != 0
        let others = leftDown || !flags.intersection([.maskCommand, .maskControl, .maskShift, .maskSecondaryFn]).isEmpty
        let count = CGEventSource.counterForEventType(.hidSystemState, eventType: .keyDown)
        if hold.update(down: rightDown, otherModifiers: others, keyCount: count, at: ProcessInfo.processInfo.systemUptime) { recordPhase("hold-accepted"); openCue() }
    }
    func openCue() {
        guard !launching else { return }
        launching = true
        recordPhase("opening-cue")
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = true
        configuration.arguments = ["--start-listening"]
        guard let cueURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "io.github.cue.community") else {
            launching = false
            recordPhase("community-app-not-found")
            return
        }
        NSWorkspace.shared.openApplication(at: cueURL, configuration: configuration) { _, error in
            DispatchQueue.main.async {
                self.launching = false
                self.recordPhase(error == nil ? "cue-opened" : "launch-failed")
                if let error = error { NSLog("Cue launcher: %@", error.localizedDescription) }
            }
        }
    }
    func start() {
        let timer = Timer(timeInterval: 0.02, repeats: true) { [weak self] _ in self?.sampleShortcut() }
        timer.tolerance = 0.005
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
        recordPhase("ready")
    }

}
@main enum CueLauncherMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let launcher = Launcher()
        launcher.start()
        launcher.showMenu()
        app.run()
    }
}
