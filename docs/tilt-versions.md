# Tilt versions

Active version: **기울기버전2 + 얼굴 보호 / Tilt version 2 + facial protection**.
The new portrait exposed facial warping in both frozen versions. Automatic local
face masks and rigid facial depth are now applied; see `face-safety.md`.
The frozen version 2 snapshot remains unchanged and is still restorable.
Later hidden-fill and curved-face-fit experiments are not active.
Restore command: `node scripts/restore-tilt-v1.mjs 2`, then restart API and reload.

## 기울기버전2 / Tilt version 2

Snapshot: `.local/backups/tilt-version-2/manifest.json`, 142 source files with
SHA-256 hashes. This is the continuous-surface, locally repaired version before
hidden completion. Restore by copying its renderer files plus
`server/spatial-layers.mjs` and `src/layered-depth.ts`; leave user data intact.

## Local hidden completion (current experiment)

`server/hidden-fill.mjs` makes a sparse texture from farther-side donors within
4.5% of grid size of strong, opaque internal depth boundaries. Outer cutout alpha
is not expanded. Independent rear geometry covers only that small region.
Foreground triangles are cut only when the completion mask covers all vertices.
There is no complete duplicate source plane. Main texture is immutable.
Completion is cached with the layered frame (`v6-local-fill`); no paid inference.
This is local colour propagation, not a generative reconstruction. Repeated
patterns may smear and unseen facial surfaces are not reliably reconstructed.
Type checking and synthetic donor/mask/mesh tests passed; phone visual QA remains
with the user. Camera, framing and orbit settings are unchanged.

## 기울기버전1 / Tilt version 1

Frozen snapshot: `.local/backups/tilt-version-1/manifest.json` (SHA-256 per source file).
Created before the layered-depth experiment, at the user's explicit request.
Restore renderer with `node scripts/restore-tilt-v1.mjs`, then `npm run reload`.
The script verifies hashes and saves displaced renderer files first. It leaves
photos, project state, assets, keys and unrelated editor changes intact.
The private snapshot contains the entire source tree, excluding dependencies,
build outputs, credentials and private runtime data.

## Layered-depth experiment

Latest correction: removed the full rear image after device feedback showed
duplicate silhouettes. All foreground triangles are connected again. Only a
feathered neighborhood of strong depth jumps uses version 1's bounded-slope
depth conditioning; the bilateral depth elsewhere and camera remain unchanged.
This is local geometry repair, not hidden-region reconstruction. Earlier
cut-triangle / rear-sheet approaches described below are superseded.

Reference: [3D Photography using Context-aware Layered Depth Inpainting](https://github.com/vt-vl-lab/3d-photo-inpainting), CVPR 2020.
Repository license: MIT, with a separate noncommercial EdgeConnect component.
We use the published layered-depth principle; no source code, weights, or
EdgeConnect dependencies from that repository are incorporated.

Current implementation is an independent, partial adaptation:
- Reuse the existing independently textured foreground/background surfaces.
- Denoise foreground depth within surfaces with a bilateral filter.
- Reject triangles across strong depth discontinuities instead of stretching
  their texture across an occlusion. A complete source-textured flat rear sheet
  now covers the cuts within each affected foreground surface. It uses the same
  alpha silhouette, orbit, pivot and texture; no additional texture upload.
- Preserve background edge anchoring, camera, object orbit, crop and texture.

This does NOT implement the paper's learned hidden-region color/depth inpainting.
The rear sheet reprojects existing pixels and can show duplicate contours at
larger angles; it cannot recover genuinely unseen surfaces. It does not reconstruct
unseen face sides or guarantee correct facial anatomy. Device visual comparison
is pending. No new inference/model downloads or paid calls are needed.
