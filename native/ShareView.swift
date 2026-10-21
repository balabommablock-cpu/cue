import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreMedia

func report(_ state: String, _ message: String = "", extra: [String: Any] = [:]) {
    var value = extra
    value["state"] = state
    value["message"] = message
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line); fflush(stdout)
    }
}

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

final class VideoView: NSView {
    let video = AVSampleBufferDisplayLayer()
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        video.videoGravity = .resizeAspect
        layer?.addSublayer(video)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func layout() { super.layout(); video.frame = bounds }
    func clear() { video.flushAndRemoveImage() }
}

@available(macOS 13.0, *)
final class ShareViewApp: NSObject, NSApplicationDelegate, NSWindowDelegate, SCStreamDelegate, SCStreamOutput, @unchecked Sendable {
    var window: NSWindow!
    var video: VideoView!
    var label: NSTextField!
    var capture: SCStream?
    var parentTimer: Timer?
    var startupTimer: Timer?
    var receivedFrame = false
    var stopped = false
    let parentPID: pid_t
    let displayID: CGDirectDisplayID
    let queue = DispatchQueue(label: "com.boredfolio.cue.share.frames")
    var framePending = false
    let frameLock = NSLock()

    init(parentPID: pid_t, displayID: CGDirectDisplayID) {
        self.parentPID = parentPID
        self.displayID = displayID
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 960, height: 600), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Cue Share View — share this window"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = NSSize(width: 480, height: 300)
        // This window is intentionally capturable. Only its source stream is filtered.
        window.sharingType = .readOnly
        video = VideoView(frame: window.contentView!.bounds)
        video.autoresizingMask = [.width, .height]
        window.contentView = video
        label = NSTextField(wrappingLabelWithString: "Preparing your presentation…")
        label.textColor = .white
        label.font = .systemFont(ofSize: 20, weight: .medium)
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        video.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: video.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: video.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: video.widthAnchor, multiplier: 0.85)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: false)
        parentTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            if kill(self.parentPID, 0) != 0 { self.finish() }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(displayChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        Task { await startCapture() }
    }

    @MainActor func startCapture() async {
        guard CGPreflightScreenCaptureAccess() else {
            report("permission_required", "Allow Cue Share View in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Share View.")
            label.stringValue = "Screen recording permission is needed.\nReturn to Cue after allowing Cue Share View in System Settings."
            // Start is an explicit user action; the OS remains responsible for consent.
            _ = CGRequestScreenCaptureAccess()
            return
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard !stopped else { return }
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                fail("The selected display is unavailable. Close this window and choose a display again."); return
            }
            let exclusions = content.applications.filter { $0.processID == parentPID || $0.processID == getpid() || $0.bundleIdentifier == "com.boredfolio.cue" || $0.bundleIdentifier == "com.boredfolio.cue.shareview" }
            // Refuse to capture if we cannot identify both private UI and this preview.
            guard exclusions.contains(where: { $0.processID == parentPID }), exclusions.contains(where: { $0.processID == getpid() }) else {
                fail("Cue's private windows could not be identified. No screen content was captured. Close Share View and retry."); return
            }
            let filter = SCContentFilter(display: display, excludingApplications: exclusions, exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            let scale = min(1.0, 2560.0 / Double(display.width))
            configuration.width = Int(Double(display.width) * scale)
            configuration.height = Int(Double(display.height) * scale)
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            configuration.queueDepth = 3
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
            configuration.showsCursor = true
            configuration.capturesAudio = false
            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            capture = stream
            report("starting", "Waiting for the first filtered frame.", extra: ["displayID": displayID, "excludedApplicationCount": exclusions.count])
            try await stream.startCapture()
            guard !stopped else { try? await stream.stopCapture(); return }
            guard !receivedFrame else { return }
            startupTimer = Timer.scheduledTimer(withTimeInterval: 12, repeats: false) { [weak self] _ in
                guard let self, !self.receivedFrame else { return }
                self.fail("No screen frames arrived. Close Share View and check recording permission.")
            }
        } catch {
            fail("Screen capture could not start: \(error.localizedDescription)")
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: rawStatus) else { return }
        if status == .blank || status == .suspended || status == .stopped {
            DispatchQueue.main.async { [weak self] in self?.fail("The source is no longer providing a usable picture. Close Share View and restart it.") }; return
        }
        guard status == .complete else { return }
        frameLock.lock()
        if framePending { frameLock.unlock(); return }
        framePending = true
        frameLock.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.frameLock.lock(); self.framePending = false; self.frameLock.unlock() }
            guard !self.stopped else { return }
            if self.video.video.status == .failed { self.fail("The presentation renderer stopped. Close Share View and restart it."); return }
            if self.video.video.isReadyForMoreMediaData {
                if let attachment = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true), CFArrayGetCount(attachment) > 0 {
                    let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachment, 0), to: CFMutableDictionary.self)
                    CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
                }
                self.video.video.enqueue(sampleBuffer)
                if !self.receivedFrame {
                    self.receivedFrame = true
                    self.startupTimer?.invalidate()
                    self.label.isHidden = true
                    report("live", "Choose “Cue Share View — share this window” in your meeting's Window picker. Verify the recipient view.")
                }
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in self?.fail("Screen capture stopped. Close Share View and restart it.") }
    }
    @objc func displayChanged() { fail("Display configuration changed. Close Share View and choose your display again.") }
    func fail(_ message: String) {
        guard !stopped else { return }
        stopped = true
        startupTimer?.invalidate()
        video?.clear()
        label?.isHidden = false
        label?.stringValue = "Presentation stopped.\nReturn to Cue to restart it."
        if let capture { Task { try? await capture.stopCapture() } }
        report("error", message)
    }
    func finish() {
        stopped = true
        startupTimer?.invalidate()
        parentTimer?.invalidate()
        video?.clear()
        report("stopped", "Share View closed.")
        NSApp.terminate(nil)
    }
    func windowWillClose(_ notification: Notification) { finish() }
    func applicationWillTerminate(_ notification: Notification) {
        video?.clear()
        NotificationCenter.default.removeObserver(self)
    }
}

if CommandLine.arguments.contains("--check") {
    report("diagnostic", extra: ["screenPermission": CGPreflightScreenCaptureAccess(), "osVersion": ProcessInfo.processInfo.operatingSystemVersionString])
    exit(0)
}
guard let parentValue = argument("--parent-pid"), let parent = Int32(parentValue), parent > 1,
      let displayValue = argument("--display-id"), let display = UInt32(displayValue) else {
    report("error", "Open Share View from Cue."); exit(2)
}
if #available(macOS 13.0, *) {
    let app = NSApplication.shared
    let delegate = ShareViewApp(parentPID: parent, displayID: display)
    app.delegate = delegate
    app.run()
} else {
    report("error", "Share View requires macOS 13 or newer."); exit(2)
}
