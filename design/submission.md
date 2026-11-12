# Submission notes

## Description (for the Contra form)

Scry treats the timeline as a crystal ball. A seek preview is normally a flat thumbnail that flips as you move; here
a glass orb rises from the playhead and shows that moment of the video bent through a lens. As you move along the
line, the picture inside flows from one frame to the next instead of flipping, and if you hold still it comes into
focus. Let go and the orb opens over the frame: the vision becomes the present.

Everything else stays quiet so the orb is the only spectacle: a hairline timeline with a glass bead, one row of
thin-stroke icons drawn for the skin, smoke-glass menus, and an italic serif reserved for the chapter title under
the orb.

The effect runs in the browser in WebGL2 fragment shaders (optical flow between storyboard tiles, the morph, the
lens) with no model to download. It is decoration over working controls: every control is a Video.js component,
keyboard seeking gets the same orb, and with reduced motion or without WebGL the orb holds a still frame.

## Visual

`design/hero.png`

## Before submitting

- [ ] Deploy (`npm run deploy vercel`, or connect the repository to Vercel or Netlify) and open the public URL
      logged out, on a phone.
- [ ] Replace the placeholder video in `apps/preview/src/frame/player.ts` with your own Mux asset and note its
      playback ID for the bonus point. Footage with long takes shows the interpolation best.
- [ ] Check the frame rate of the orb on a laptop and a phone; the build was verified with software rendering only.
- [ ] Replace the copyright line in `LICENSE` with your name.
- [ ] The challenge page marks submissions as needing an external social post; check the form.
