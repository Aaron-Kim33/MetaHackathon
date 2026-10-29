The Android subject cutout feature uses Google's MagicTouch v2 interactive image segmentation model, served with MediaPipe Tasks Vision 1.1.1 using an explicit CPU delegate.

- Official documentation: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Model: https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task
- Google model card and license statement: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf
- License: Apache License 2.0; copyright Google / The MediaPipe Authors. The license text is included in the APK's `licenses/Apache-2.0.txt` asset.
- Model SHA256: `38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03`.

Run `npm run setup:cutout` before building Android, or use `npm run build:android`, which performs this step automatically. Model binaries are downloaded from the official versioned URL and verified rather than committed with project source. Other npm/Gradle dependencies retain their own licenses.

Local 3D face protection uses UltraFace RFB-320, from the official ONNX Model Zoo (MIT): https://github.com/onnx/models/tree/main/validated/vision/body_analysis/ultraface . Upstream implementation: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB . Model SHA256: `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017`. Downloaded model binaries and original-photo detection caches stay in ignored `.local/`. This auxiliary model locates faces only and is distinct from the editor's Meta generation/segmentation models.
