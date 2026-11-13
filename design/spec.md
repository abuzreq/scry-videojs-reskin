# Scry — design spec

A seeing-stone skin for Video.js v10. Travel through the video and the picture itself becomes the stone.

## Material

The skin is cut from one material: a dark seeing-stone, lit from inside.

| | |
|---|---|
| Orb | Black glass. The picture surfaces in the middle and sinks into dark toward the rim. A fire low inside breathes, and brightens along the rim the harder time is driven. |
| Stage | Near black, lit like firelight. |
| Waiting | Smoke, with sparks rising through it. |
| Ink | Warm white `#f6eedf`; old gold `#e3c078` for what is played. |
| Bead and knob | A dark stone with an ember edge. |
| Names (title, chapters, menu labels) | Cinzel, Roman capitals, letterspaced; the chapter title under the orb in gold. |
| Icons | Cut, not drawn: mitred joins, square ends, small diamonds where a pen would dot; play and pause solid, like inlay. |
| Menus, tooltips, plates | Dark tablets, small radius, a hairline of gold; the row in use takes a gold wash and a gold edge. |
| Volume | A flame: deep red at the foot, gold at the top, with an ember for a thumb. |
| Frame | Four engraved corner marks that come and go with the controls. |
| Between the times | A cut diamond. |
| Captions | A book serif in warm white on a dark plate. |
| Play control at rest | The stone asleep: black, a little fire low inside. |

Numbers stay in plain tabular sans, so times read at a glance. The played line honours `--media-accent-color`.

`stone="glass"` on `<scry-vision>` swaps the material for clear crystal with cool white controls and a rounder
icon set. It is kept as an option; the seeing-stone is the design.

## Idea

The video is a rectangle until time is travelled. Scrub or jump, and the picture curls up into a glass orb in the
middle of the player: a seeing-stone in which the video flows from one moment to the next. The timeline curls with it,
onto the orb's lower rim. Arrive, and the orb uncurls onto the new frame.

Professional and quiet everywhere else, so the orb is the only spectacle.

## Layout and control order

- **Top row:** title (start), AirPlay and Cast (end, only when available).
- **Centre:** the play control, a still orb. With a mouse it is shown at rest (before playback, paused, ended)
  and on keyboard focus; on touch it is shown whenever controls are.
- **Timeline:** full width above the bottom row.
- **Bottom row:** play, mute (volume slider in a popover), time · captions, settings, picture-in-picture, fullscreen.
- Source order matches visual order. Hotkeys, gestures, status announcer and error dialog are the starter's.

Narrow players (container width under 28rem): time becomes one tappable readout, picture-in-picture goes, the orb is
smaller and its caption is the time alone. Under 21rem the captions button goes too; captions stay in the settings menu.

## Timeline: the horizon

- A hairline, 2px at rest and 4px while hovered, focused or dragged. Hit area 28px (40px on touch).
- Track warm white at 30%, buffered at 32%, played in old gold with a faint glow.
- Chapters are notches: small gaps in the line.
- The playhead is a dark bead with an ember edge, 14px, growing a little on interaction.

## The orb

**When it appears**

- Before the first play the player waits as the stone: the poster's moment held in an orb around the play control,
  embers rising through it, the stage dark. Resting on the timeline looks ahead inside it. Play opens it, briskly,
  onto the first frame. If the stone cannot be drawn within five seconds the ordinary poster is shown instead.
- Dragging the timeline, dragging sideways on the picture, or anything that seeks by more than a couple of seconds
  (keys, double-tap, a replay) wraps the picture into the orb. Jumps do it briskly: about 180ms in, 240ms out.
- A click on the timeline is a jump, not a scrub: one complete brisk wrap to the new moment, or a plain cut when the
  step is under about 2.5 seconds. Pressing only starts a scrub once the pointer moves or the press is held.
- Resting the pointer on the timeline only peeks: a small orb rises at the pointer showing that moment, with the
  time, the offset from now and the chapter title beneath it, and the picture is left alone.
- Buffering: a small orb in the centre, holding the stalled frame, with smoke turning inside it.
- Ended: an orb in the centre holding the opening frame, with the replay control in it; the last frame dims behind.

**How it is drawn** (WebGL2, one pass)

- One shape, a superellipse, travels from the frame's rectangle to the sphere's circle; the picture eases from flat to
  a wide lens that keeps most of the frame in view. The stage around it darkens, lit faintly by the orb.
- Glass: the picture sinks into black toward the rim, with an ember edge light and a fire low inside.
- The wrap starts from the exact frame on screen and ends on the exact new frame, so neither end jumps.
- Between storyboard tiles the picture is a motion-compensated blend within a shot and a liquid dissolve across a cut.
  Resting on a moment fetches its exact frame (Mux) and the picture sharpens.
- Dragging on the picture is relative to now: a full-width drag covers a third of the video, at least 45 seconds.
  Playback pauses while a hand is scrubbing and resumes after.

**The curved bar**

- The timeline bends from the straight bar onto the orb's lower rim, 140° wide, just outside the glass: chapters as
  gaps, buffered and played lengths, the bead as the knob.
- Current time at its start, duration at its end, the target time and offset on a plate by the knob, the chapter
  title in gold capitals beneath.
- Pressing on the arc scrubs by angle. The library's time slider stays in the document as the real control; the arc
  mirrors it, including the focus ring on the knob.

**Fallbacks**

- Reduced motion, no WebGL2 or a lost context: nothing wraps. Seeks cut, the bar stays straight, hovering shows the
  still storyboard thumbnail in a plain circle, buffering shows the spinner.
- No storyboard: the orb still wraps, holding the frame it started from under fog until the new one arrives.

## Depth tier (opt-in)

With `depth="auto"`, a small depth model looks at each storyboard tile in the background. Where a tile's depth is
known the orb's picture has parallax: a slow orbit of the eye, a lean into the direction of travel, a push forward as
the orb opens, and across cuts the far of the new picture settles before its foreground. Off by default.

## Icons

One set, drawn for the skin on a 20 grid with a 1.5 stroke. Joins are mitred and ends are square, as if cut with a
chisel; small diamonds stand where a pen would dot. Play and pause are solid. States that would otherwise be colour
alone add a filled part (captions on, picture-in-picture active, AirPlay and Cast connected); captions on also gets
a mark under the button.

## Type

- Names (the title, chapter titles, menu labels): Cinzel 500, capitals, letterspaced. One weight, Latin, bundled
  with the skin under the SIL Open Font License. Other scripts fall back to the system serif.
- Everything read as a value (times, speeds, qualities): the system sans through `--media-font-family`, 13px, with
  tabular numerals.
- Captions: the system book serif.

## Colour and surfaces

- Ink: warm white `#f6eedf`. Secondary ink: the same at 72%.
- Gold `#e3c078` for the played line, the row in use and hairlines; ember for edges and the fire.
- Tablets for menus, popovers, tooltips, indicators and the dialog: near-black, slightly translucent, small radius,
  a hairline of gold.
- Scrim under the controls: a tall soft gradient at the bottom, a short one at the top.
- Ink over the picture always carries a tight dark edge and a soft halo, so it reads over white frames.

## Motion

- Controls: the starter's quick fade.
- Buttons: instant press feedback (scale 0.92), no other motion.
- Orb picture: critically damped spring toward the target, about a third of a second, never overshoots.
- Wrapping: 340ms while scrubbing, 180ms for a jump. Unwrapping: 400ms and 240ms, once the new frame is on screen.
- All durations go through the skin's motion tokens. Under reduced motion the tokens collapse and the WebGL orb is
  replaced by the still thumbnail with an instant seek.

## Accessibility

- Every control is a Video.js component or a native button, so roles, labels, keys and translations are the library's.
- The time slider is the library's: arrow keys, Page Up/Down, Home/End, `aria-valuetext`.
- Focus: a 2px light outline with a dark ring behind it, on every focusable part.
- Touch targets 44px (40px on narrow players).
- Forced colours, increased contrast and reduced transparency: glass and gradients drop to solid surfaces with borders.
- The orb canvas is `aria-hidden` and takes no pointer events.

Derived details (hover shades, gaps, exact shadows) are decided in the stylesheet and not listed here.
