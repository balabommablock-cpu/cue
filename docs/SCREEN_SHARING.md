# What screen sharing can see

Cue has no universal invisibility mode. A different participant's recorder, whole-screen share, remote desktop, process inspection or proctoring software has its own view of the computer.

## Share View

The macOS helper captures a selected display with ScreenCaptureKit while excluding the Cue process and the helper itself. It displays that filtered picture in a separate, intentionally capturable window. Share that specific window in your call.

The helper refuses to capture if it cannot identify both excluded applications. Permission denial, a lost display, a stopped stream or unusable frames stop the presentation rather than silently falling back to an unfiltered display. The last frame is cleared on failure.

Electron's capture-protection request is an additional best-effort OS hint. Modern macOS capture clients may ignore it. It must not be treated as certification.

## Verification

The earlier preview passed a local Chrome receiving-picture test for Share View with an entire-screen positive control. This does not certify Community on every meeting client. Google Meet, Zoom and Teams receiving-device tests are still required for each supported OS/client combination.

| Situation | Expected boundary |
| --- | --- |
| Share a browser tab or unrelated app window | Cue is a separate window; verify the actual receiver |
| Share the Cue Share View window | Receiver gets the helper's filtered picture; verify before use |
| Share the whole display independently | Cue may be visible |
| Record the desktop through another API | No invisibility promise |
| Inspect installed apps or running processes | Cue is an ordinary discoverable application |
| Restricted/proctored assessment | This project does not bypass its controls |

## Reproduce a capture check

1. Open Cue and type recognisable, nonprivate sample text. Open Share View.
2. In a receiving browser or another participant's call, select the Share View window.
3. Keep Cue visibly over the source display. Freeze or inspect the receiving picture.
4. Move Cue, switch the source content, and repeat. Test permission denial, display disconnect and sleep/lock.
5. As a positive control, test an independent whole-display share. Do not assume it matches the filtered Share View result.

`/capture-check` is a local browser test page. It does not upload captures. Screenshots used for public bug reports must contain only synthetic content.
