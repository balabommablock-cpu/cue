import Foundation

// A brief tap is not an invocation. Repeats cannot restart the hold or fire
// twice. The clock is supplied so these rules can be tested without UI input.
struct ShortcutHold {
    let delay: TimeInterval
    private var pressedAt: TimeInterval?
    private var fired = false

    init(delay: TimeInterval = 0.6) { self.delay = delay }

    mutating func press(at now: TimeInterval) -> Bool {
        guard pressedAt == nil else { return false }
        pressedAt = now; fired = false
        return true
    }
    mutating func release() { pressedAt = nil; fired = false }
    mutating func shouldFire(at now: TimeInterval, keysDown: Bool) -> Bool {
        guard keysDown else { release(); return false }
        guard let start = pressedAt, !fired, now - start >= delay else { return false }
        fired = true
        return true
    }
}

// Read modifier state and the number of ordinary key presses, never their
// contents. Option used in another shortcut is blocked until it is released.
struct SingleModifierHold {
    private var hold = ShortcutHold(delay: 0.45)
    private var wasDown = false
    private var blocked = false
    private var initialKeyCount: UInt32 = 0

    mutating func update(down: Bool, otherModifiers: Bool, keyCount: UInt32, at now: TimeInterval) -> Bool {
        if !down { reset(); return false }
        if !wasDown {
            wasDown = true; initialKeyCount = keyCount; blocked = false
            _ = hold.press(at: now)
        }
        if otherModifiers || keyCount != initialKeyCount { blocked = true; hold.release() }
        return !blocked && hold.shouldFire(at: now, keysDown: true)
    }
    mutating func reset() { wasDown = false; blocked = false; hold.release() }
}
