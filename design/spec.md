# Scry — design spec

A crystal-ball skin for Video.js v10. The timeline preview is a glass orb: look into it to see where the video is
going, let go and the orb opens into that moment.

## Idea

A seek preview is normally a flat thumbnail that flips as the pointer moves. Here it is an orb that rises from the
playhead. Inside it the storyboard picture for that moment is bent by the lens, and as the pointer moves the picture
flows between frames instead of flipping. On release the orb opens over the frame and gives way to the video.

Professional and quiet everywhere else, so the orb is the only spectacle.

## Layout and control order

- **Top row:** title (start), AirPlay and Cast (end, only when available).
- **Centre:** the play control, a still glass orb. With a mouse it is shown at rest (before playback, paused, ended)
  and on keyboard focus; on touch it is shown whenever controls are.
- **Timeline:** full width above the bottom row.
- **Bottom row:** play, mute (volume slider in a popover), time · captions, settings, picture-in-picture, fullscreen.
- Source order matches visual order. Hotkeys, gestures, status announcer and error dialog are the starter's.

Narrow players (container width under 28rem): time becomes one tappable readout, picture-in-picture goes, the orb is
smaller and its caption is the time alone. Under 21rem the captions button goes too; captions stay in the settings menu.

## Timeline: the horizon

- A hairline, 2px at rest and 4px while hovered, focused or dragged. Hit area 28px (40px on touch).
- Track white at 30%, buffered white at 32%, played solid accent with a faint glow.
- Chapters are notches: small gaps in the line.
- The playhead is a glass bead, 14px, growing a little on interaction.

## The orb

- Diameter `clamp(6.5rem, 30cqi, 14rem)`; `clamp(4.5rem, 26cqi, 7rem)` on narrow players.
- Rises from the bead (scale from 0.35, origin at the line) and follows the pointer, clamped to the player.
- Caption under it, real text: chapter title in italic serif, then the time and the offset from now (`+1:24`, `−0:30`).
- Drawn in WebGL2 when a storyboard is available: fisheye lens, darker toward the rim, grazing edge light, a window
  reflection, slight dispersion at the rim, a soft shadow on the picture behind.
- Between tiles the picture is a motion-compensated blend where the two tiles are the same shot, and a liquid dissolve
  across a cut (the outgoing picture defocuses and pushes in, the incoming one arrives from behind, bright regions
  first).
- On release it opens: the radius grows past the farthest corner, the lens relaxes to flat, the picture settles onto
  the frame, and it fades once the player shows the new frame.
- Fallback (no WebGL2, context lost, or reduced motion): the still storyboard thumbnail inside a CSS glass circle.
  No storyboard at all: caption only.

## Depth tier (opt-in)

With `depth="auto"`, a small depth model looks at each storyboard tile in the background. Where a tile's depth is
known the orb's picture has parallax: a slow orbit of the eye, a lean into the direction of travel, a push forward as
the orb opens, and across cuts the far of the new picture settles before its foreground. Off by default.

## Icons

One set, drawn for the skin: 20 grid, 1.5 stroke, round caps and joins, outlines only. States that would otherwise be
colour alone add a filled part (captions on, picture-in-picture active, AirPlay and Cast connected); captions on also
gets a dot under the button.

## Type

System sans stack through `--media-font-family`, 13px, tabular numerals for every time. One accent face: the system
serif, italic, for the chapter title under the orb. No web fonts.

## Colour and surfaces

- Ink: white. Secondary ink: white at 72%.
- Accent: `--media-accent-color`, white by default. Used for the played line only.
- Smoke glass for menus, popovers, tooltips, indicators and the dialog: `rgb(14 16 20 / 0.74)`, 20px blur, hairline
  inner highlight. Radii 14px (popups), 9px (menu items), full (buttons, tooltips' shortcut chips, volume popover).
- Scrim under the controls: a tall soft gradient at the bottom, a short one at the top.
- Ink over the picture always carries a tight dark edge and a soft halo, so it reads over white frames.

## Motion

- Controls: the starter's quick fade.
- Buttons: instant press feedback (scale 0.92), no other motion.
- Orb picture: critically damped spring toward the pointer, about a third of a second, never overshoots.
- Orb opening: 560ms; handover to the video 300ms once the frame is ready.
- All durations go through the skin's motion tokens. Under reduced motion the tokens collapse and the WebGL orb is
  replaced by the still thumbnail with an instant seek.

## Accessibility

- Every control is a Video.js component or a native button, so roles, labels, keys and translations are the library's.
- The time slider is the library's: arrow keys, Page Up/Down, Home/End, `aria-valuetext`.
- Focus: 2px white outline with a dark ring behind it, on every focusable part.
- Touch targets 44px (40px on narrow players).
- Forced colours, increased contrast and reduced transparency: glass and gradients drop to solid surfaces with borders.
- The orb canvas is `aria-hidden` and takes no pointer events.

Derived details (hover shades, gaps, exact shadows) are decided in the stylesheet and not listed here.
