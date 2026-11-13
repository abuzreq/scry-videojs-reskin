# Submission notes

## Description (for the Contra form)

Scry turns the video itself into a seeing-stone. It is an ordinary rectangle until you travel through time: drag the
timeline, drag sideways on the picture, or jump with the keys, and the picture curls up into an orb of black glass.
Inside it the video flows from one moment to the next instead of cutting, a fire in the stone brightens the harder
you drive it, and the timeline curls with it onto the orb's rim, carrying the chapters, the times and the knob.
Arrive, and the orb uncurls onto the new frame. Resting the pointer on the timeline only peeks: a small stone shows
that moment and leaves the picture alone. The same stone appears wherever the player waits or rests: smoke and
sparks while buffering, and the opening frame held in it at the end.

The rest of the skin takes its cue from the stone and otherwise stays quiet: warm ink, a hairline timeline in old
gold with a dark, ember-edged bead, thin-stroke icons drawn for the skin, smoke-dark menus, and serif small capitals
for names. A clear-glass variant is one attribute away.

The effect runs in the browser in WebGL2 fragment shaders (optical flow between storyboard frames, the morph, the
wrap, the lens and the fire) with no model to download. It is decoration over working controls: every control is a
Video.js component, the time slider keeps its role, label and keys, and with reduced motion or without WebGL nothing
wraps.

## Visuals

- `design/hero.png` — the picture wrapped into the stone, with the curved timeline.
- `design/hero-driven.png` — the same while time is being driven: the fire is up.
- `design/peek.png` — resting on the timeline: the small stone.

## Before submitting

- [ ] Deploy (`npm run deploy vercel`, or connect the repository to Vercel or Netlify) and open the public URL
      logged out, on a phone.
- [ ] Scrub and jump on a laptop and a phone and watch for stutter; the build was verified with software rendering
      only. If a device struggles, lower `ScryVisionElement.maxPixels`.
- [ ] Replace the placeholder video in `apps/preview/src/frame/player.ts` with your own Mux asset and note its
      playback ID for the bonus point. Footage with long takes shows the interpolation best.
- [ ] Replace the copyright line in `LICENSE` with your name.
- [ ] The challenge page marks submissions as needing an external social post; check the form.
