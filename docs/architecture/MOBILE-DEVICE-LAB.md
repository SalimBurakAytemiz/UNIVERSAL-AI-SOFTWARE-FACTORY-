<!-- //TR: Bu dosya local fiziksel Android/iOS, emulator/simulator ve BrowserStack benzeri cloud device farm'larda mobil uygulama testini first-class execution fabric olarak tanımlar. -->
# Mobile Device Lab

Android local path:
`ADB discovery -> Device Registry -> Lease -> Appium/UiAutomator2 -> install -> test -> logcat/video/perf/network -> evidence`

iOS path:
`macOS worker -> Xcode/XCUITest/Appium -> physical/simulator -> capture -> evidence`

Cloud adapter slots:
BrowserStack, Sauce Labs, LambdaTest, Firebase Test Lab, AWS Device Farm, Kobiton, Perfecto.

Scheduler preference:
owned local -> owned remote -> approved free/trial cloud -> explicit-budget paid cloud.

Capabilities include:
install/uninstall, upgrade/downgrade, permissions, rotation, background/foreground, offline/network changes,
deep links, notifications, crash/ANR, CPU/RAM/battery, screenshot/video, WebView and accessibility.
