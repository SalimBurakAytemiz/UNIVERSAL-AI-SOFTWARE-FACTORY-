<!-- //TR: Bu dosya açık P0/P1/P2 bulgusu kalmadıktan sonraki current bounded milestone'u gösterir; final release veya CLEAN iddiası değildir. -->
# Current Milestone
## V6 Final Reseal, Packaging and Target-Machine Phase0
- release paketleme paketi: SHA256SUMS üreticisi, deterministik ZIP, fresh-extract doğrulaması (bağımsız Codex review)
- final trust-root reseal -> SHA256SUMS -> Founder harici anahtarla imza -> final ZIP -> fresh-extract doğrulaması
- fresh extract üzerinde `scripts/install.ps1` ile target-machine Phase0 acceptance ve autostart
