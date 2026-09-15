# Iris Speak — native iOS / iPadOS app

SwiftUI port of irisspeak.org (the `aac_next` on-device version): the IrisSpeak-135M card model, reranker and
MiniLM similarity run on the device through ONNX Runtime; sessions, profile and card history stay local.

- `irisspeak/irisspeak/Engine/` — tokenizers, ONNX wrapper, prediction + reranker, local API, storage
- `irisspeak/irisspeak/UI/` — screens and components (OpenDyslexic, Fitzgerald-Key card colours)
- `irisspeak/irisspeak/Audio/` — speech synthesis and recognition
- `irisspeak/irisspeak/Debug/SelfTest.swift` — launch with `IRIS_SELFTEST=1` for a scripted run with screenshots
- `scripts/fetch_models.sh` — copies the two large model files (not in git) into `Resources/Model/`

Open `irisspeak/irisspeak.xcodeproj`, pick a team under Signing, run on an iPad (iOS 17+).

## Deploying to the iPad

`scripts/deploy_ipad.sh` builds a Debug build, installs it and launches it on the default iPad
("iPad", iPad A16, UDID 8F63DE05-E758-5950-B3F5-BFAE233197A8). It works over USB or over Wi-Fi when the
iPad is on the same network (Xcode keeps the pairing after the first USB connection). Pass another UDID to
target a different device; `xcrun devicectl list devices` shows what is reachable.
