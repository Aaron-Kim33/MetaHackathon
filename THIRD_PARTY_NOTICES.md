The Android subject cutout feature uses Google's MagicTouch v2 interactive image segmentation model, served with MediaPipe Tasks Vision 1.1.1 using an explicit CPU delegate.

- Official documentation: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Model: https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task
- Google model card and license statement: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf
- License: Apache License 2.0; copyright Google / The MediaPipe Authors. The license text is included in the APK's `licenses/Apache-2.0.txt` asset.
- Model SHA256: `38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03`.

Run `npm run setup:cutout` before building Android, or use `npm run build:android`, which performs this step automatically. Model binaries are downloaded from the official versioned URL and verified rather than committed with project source. Other npm/Gradle dependencies retain their own licenses.
