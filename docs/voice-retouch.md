# Voice descriptions and retouch

Voice input is available in AI Create and in the retouch / library repair panel.
It uses the existing installed OS speech-recognition module, following the app's
Korean/English language setting. Audio is not persisted by the app. The OS service
may use its network service. This is not a Meta transcription request.
An explicit action after transcript review starts generation; speech ending never
starts a paid request. Permission/service errors keep typed input available.

Retouch: select a canvas subject, open Retouch, then voice/text description,
preview, and Apply. Current scope is colour, lighting and mood. Muse Image receives
the selected asset; the generated result is kept as an immutable intermediate.
The final preview retains the exact original alpha and dimensions. Original and
retouched versions stay in the library. Canvas state changes only on Apply,
which uses existing guarded asset replacement and preserves element pose.
The model may alter details despite instructions; the preview allows rejection.
This is not provider-native masked editing or 3D reconstruction.

Pending panel jobs are stored per source asset and mode on the device. Reopening
the same asset can check the original job. No automatic retry. An uncertain job
requires checking its status before explicitly retrying its failed stage.

The account owner explicitly requested removal of app request caps. Their local
`.env` now sets `MODEL_REQUEST_LIMITS=off`. SAM/image usage counts, durable job
IDs, deduplication, reusable outputs, single active job and experiment logging
remain enabled. `/status` represents disabled caps as null; UI displays Unlimited.
Meta's account, billing and rate limits still apply. New installs remain capped
unless their own configuration explicitly disables limits.

Validation uses simulated image responses and synthetic assets. No live Meta
request was made during this implementation. Physical microphone QA is left to
the user; no phone was operated or recorded.
