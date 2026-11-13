# Submission notes

Scry was made for the [Video.js Skins Design Challenge](https://contra.com/community/topic/videojsskinschallenge/guidelines)
on Contra (November 2026). This file holds the text and images for the entry.

## Description

Scry turns the video itself into a seeing-stone. The player opens as the stone, with the play control at its
centre and embers rising through it; press play and it unfolds into the picture. From then on it is an ordinary
rectangle until you move through time: drag the
timeline, drag sideways on the picture, or skip with the keys, and the picture rolls up into an orb of black glass.
Inside it the video plays from one moment to the next instead of cutting, a fire in the stone brightens the harder
you drive it, and the timeline bends onto the orb's rim, carrying the chapters, the times and the knob. Arrive, and
the orb opens onto the new frame. Resting the pointer on the timeline only peeks: a small stone shows that moment
and leaves the picture alone. The same stone appears wherever the player waits or rests: smoke and sparks while
buffering, and the opening frame held in it at the end.

The rest of the skin is cut from the same material. Icons are incised, with mitred corners and small diamonds
where a pen would dot. Names are set in Roman capitals. Menus, tooltips and the time plate are small dark tablets
with a hairline of gold; volume is a flame that stands taller and burns hotter; four engraved corner marks frame
the picture while the controls are up. Numbers stay plain so times read at a glance.

The effect runs in the browser in WebGL2 fragment shaders (optical flow between storyboard frames, the blend, the
wrap, the lens and the fire) with no model to download. It is decoration over working controls: every control is a
Video.js component, the time slider keeps its role, label and keys, and with reduced motion or without WebGL
nothing wraps.

## Images

- `design/hero.png`: the picture wrapped into the stone, with the curved timeline.
- `design/hero-driven.png`: the same while time is being driven, with the fire up.
- `design/peek.png`: resting on the timeline, with the small stone.

## Links

- Source: https://github.com/abuzreq/scry-videojs-reskin
- Author: https://abuzreq.com/
