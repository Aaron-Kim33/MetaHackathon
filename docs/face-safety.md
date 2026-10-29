# Facial geometry protection

The new raised-hand portrait was compared in tilt version 1 and 2 at horizontal
motion -1, 0, +1, strength 0.7, same crop, orbit, texture and projection. Both
versions showed nonrigid facial distortion. Private comparison artifacts:
`.local/new-face-safety-compare/`.

The active correction uses locally installed UltraFace to locate all detected
faces in each immutable source. Detection is cached by source hash and model
version. Source masks follow each sticker's scale/rotation through the existing
scene raster, so geometry changes reuse detection rather than making API calls.
The mask includes a head margin, excludes transparent cutout regions and is
separate from the colour texture. Each connected protected region receives one
median depth. Feathering is contained within a soft head mask; its lower edge
ends at 12% of detected face height below the chin. No correction propagates
outside the mask. This replaced outward feathering that could pull the neck and
upper torso toward the head plane. The surface stays connected.

This deliberately gives up facial relief to preserve internal facial proportions.
Body/background relief, camera, framing, UVs and original colours stay intact.
It is not an anatomical 3D reconstruction. Perspective foreshortening remains.
Small, profile, occluded or undetected faces may not be protected; detector
failure is logged. This is not a guarantee for every possible photo.
No Meta/cloud call is used. A new source can require one local CPU detection;
the model is already installed, and no model downloads occur at runtime.

## Verify the running server

`scripts/dev.mjs` hosts the API in its own process. Restarting only a parent dev
process or checking the port owner for `server/index.mjs` misses this case.
Verify the actual 4180 owner command, stop that recognised project dev process,
then start the new server. Reloading Metro alone does not update the API.
The followup tilted-body portrait initially had no faceMask because the old API
was still serving. After replacing the actual owner, authenticated `/spatial`
returned 158 protected grid points. Before/after artifacts and report are in
`.local/face-safety-followup/`; no Meta requests were made.
