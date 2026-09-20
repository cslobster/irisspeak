---
paths:
  - "ios/**"
---
# iOS app — loaded when a task touches `ios/**` (moved out of CLAUDE.md 2026-09-20)

## iOS (`ios/`)
SwiftUI port with the same screens (`UI/Screens/*`), engine (`Engine/`: BPE + WordPiece tokenizers,
ONNX/Core ML card model, `Realiser.swift`, `LocalApi.swift`, `RemoteApi.swift` → same backend), TTS +
speech recognition, and an experimental gaze controller (`Gaze/`). Model files are fetched by
`scripts/fetch_models.sh` into `Resources/Model/` (git-ignored). `scripts/deploy_ipad.sh` builds and
installs on the paired iPad. `IRIS_SELFTEST=1` runs a scripted self-test with screenshots.

