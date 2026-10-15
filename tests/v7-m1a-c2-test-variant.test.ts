// //TR: Bu test M1a c2 TEST kurulum varyantını doğrular (D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15 koşul 4): UASCO_BUILD_VARIANT=test, gerçek UASCO'dan uygulama kimliği (appId), kayıt defteri kaldırma anahtarı (electron-builder'ın appId'den türettiği GUID; kütüphanenin kendi UUID v5'iyle karşılaştırılır), kurulum dizini, userData yolu, çalıştırılabilir/kısayol adı, kurulum dosyası adı ve pencere başlığı bakımından ayrışır; değişken verilmediğinde RELEASE kimliği (statik config nesnesi, electron-builder'a verilen birleşik config ve sahne package.json metni) bayt bayt değişmez. Hiçbir kurulum veya uygulama çalıştırılmaz (yalnız saf fonksiyonlar).
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const b = await import(pathToFileURL(path.join(root, "scripts", "build-installer.mjs")).href) as any;
const staticConfig = JSON.parse(read("installer", "electron-builder.json"));
const OPTS = {electronDist: path.resolve(root, "x-electron-dist"), electronVersion: "0.0.0-test", outputDir: path.resolve(root, "x-out"), resourcesDir: path.resolve(root, "x-res")};

describe("M1a c2 build variant selection", () => {
  it("no variable (or 'release') selects RELEASE; only 'test' selects TEST; anything else is refused", () => {
    expect(b.resolveBuildVariant({})).toBe("release");
    expect(b.resolveBuildVariant({UASCO_BUILD_VARIANT: ""})).toBe("release");
    expect(b.resolveBuildVariant({UASCO_BUILD_VARIANT: "release"})).toBe("release");
    expect(b.resolveBuildVariant({UASCO_BUILD_VARIANT: "test"})).toBe("test");
    for (const bad of ["TEST", "Test", "prod", "test ", "1"]) expect(() => b.resolveBuildVariant({UASCO_BUILD_VARIANT: bad}), bad).toThrow(/BUILD_VARIANT_INVALID/);
  });
});

describe("M1a c2 RELEASE identity is byte-for-byte unchanged", () => {
  it("the static config object, the merged electron-builder config and the staged package.json are exactly the pre-c2 values", () => {
    expect(b.variantStaticConfig(staticConfig, "release")).toBe(staticConfig);
    expect(JSON.stringify(b.builderConfig(b.variantStaticConfig(staticConfig, "release"), OPTS))).toBe(JSON.stringify(b.builderConfig(staticConfig, OPTS)));
    const merged = b.builderConfig(b.variantStaticConfig(staticConfig, "release"), OPTS);
    expect({appId: merged.appId, productName: merged.productName, artifactName: merged.artifactName, exe: merged.win.executableName, shortcut: merged.nsis.shortcutName, uninstall: merged.nsis.uninstallDisplayName})
      .toEqual({appId: "com.uasco.desktop", productName: "UASCO", artifactName: "UASCO-Setup-${version}-win-x64.${ext}", exe: "UASCO", shortcut: "UASCO", uninstall: "UASCO ${version} (unsigned development build)"});
    const rootPkg = {version: "1.2.3"}, deps = {fastify: "5.0.0", ajv: "8.0.0", "ajv-formats": "3.0.0"};
    // the literal the build script wrote before cycle 2
    expect(b.stagePackageJson(rootPkg, deps)).toBe(JSON.stringify({name: "uasco-desktop", productName: "UASCO", version: rootPkg.version, description: "UASCO desktop (unsigned development build)", author: {name: "UASCO"}, private: true, type: "module", main: "apps/desktop/main.mjs", dependencies: deps}, null, 2) + "\n");
    expect(b.stagePackageJson(rootPkg, deps, "release")).toBe(b.stagePackageJson(rootPkg, deps));
    expect(b.installerArtifactName("1.2.3")).toBe("UASCO-Setup-1.2.3-win-x64.exe");
    const src = read("scripts", "build-installer.mjs");
    expect(src).toContain("const config = builderConfig(variantStaticConfig(staticConfig, variant), {electronDist, electronVersion, outputDir: output, resourcesDir: resources});");
    expect(src).toContain("fs.writeFileSync(path.join(stage, \"package.json\"), stagePackageJson(rootPkg, deps, variant));");
    expect(src).toContain("const artifact = path.join(output, installerArtifactName(rootPkg.version, variant));");
  });
});

describe("M1a c2 TEST identity is separate from the real UASCO", () => {
  it("TEST: appId com.uasco.desktop.test, productName/executable/shortcut 'UASCO Test', UASCO-Test-Setup-<version>-win-x64.exe, its own package name", () => {
    const merged = b.builderConfig(b.variantStaticConfig(staticConfig, "test"), OPTS);
    expect({appId: merged.appId, productName: merged.productName, artifactName: merged.artifactName, exe: merged.win.executableName, shortcut: merged.nsis.shortcutName})
      .toEqual({appId: "com.uasco.desktop.test", productName: "UASCO Test", artifactName: "UASCO-Test-Setup-${version}-win-x64.${ext}", exe: "UASCO Test", shortcut: "UASCO Test"});
    expect(merged.nsis.uninstallDisplayName).toBe("UASCO Test ${version} (unsigned TEST build)");
    // everything else (per-user, no elevation, keep user data, include file) is the release behaviour
    for (const k of ["oneClick", "perMachine", "allowElevation", "deleteAppDataOnUninstall", "warningsAsErrors"]) expect(merged.nsis[k], k).toBe(staticConfig.nsis[k]);
    expect(staticConfig.appId).toBe("com.uasco.desktop"); // the source file itself is untouched
    expect(b.installerArtifactName("1.2.3", "test")).toBe("UASCO-Test-Setup-1.2.3-win-x64.exe");
    const pkg = JSON.parse(b.stagePackageJson({version: "1.2.3"}, {}, "test"));
    expect(pkg).toMatchObject({name: "uasco-desktop-test", productName: "UASCO Test", version: "1.2.3", main: "apps/desktop/main.mjs"});
  });
  it("uninstall key = electron-builder's UUID v5 of the appId (checked against the library), and the variants share no appId, uninstall key, install dir or userData path", async () => {
    const {UUID} = await import("builder-util-runtime") as any;
    const rel = b.variantIdentity("release", "1.2.3"), tst = b.variantIdentity("test", "1.2.3");
    for (const id of [rel, tst]) {
      expect(id.uninstallKeyName).toBe(UUID.v5(id.appId, UUID.parse(b.ELECTRON_BUILDER_NS_UUID)));
      expect(id.uninstallKey).toBe(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id.uninstallKeyName}`);
    }
    // the namespace is the one electron-builder itself uses for appGuid
    expect(read("node_modules", "app-builder-lib", "dist", "targets", "win", "nsis", "progId.js")).toContain(b.ELECTRON_BUILDER_NS_UUID);
    expect(rel).toMatchObject({appId: "com.uasco.desktop", productName: "UASCO", executable: "UASCO.exe", userDataDir: "%APPDATA%\\UASCO", defaultInstallDir: "%LOCALAPPDATA%\\Programs\\UASCO", appUserModelId: "com.uasco.desktop"});
    expect(tst).toMatchObject({appId: "com.uasco.desktop.test", productName: "UASCO Test", executable: "UASCO Test.exe", userDataDir: "%APPDATA%\\UASCO Test", defaultInstallDir: "%LOCALAPPDATA%\\Programs\\UASCO Test", windowTitleContains: "UASCO Test", appUserModelId: "com.uasco.desktop.test"});
    const lc = (s: string) => s.toLowerCase();
    expect(tst.appId).not.toBe(rel.appId);
    expect(lc(tst.uninstallKeyName)).not.toBe(lc(rel.uninstallKeyName));
    expect(lc(tst.appRegistryKey)).not.toBe(lc(rel.appRegistryKey));
    expect(lc(tst.defaultInstallDir)).not.toBe(lc(rel.defaultInstallDir));
    expect(lc(tst.userDataDir)).not.toBe(lc(rel.userDataDir));
    expect(tst.artifactName).not.toBe(rel.artifactName);
    expect(tst.packageName).not.toBe(rel.packageName);
  });
  it("the NSIS include names the user-data folder via PRODUCT_FILENAME (UASCO for release, 'UASCO Test' for test) and deletes only that folder on an explicit opt-in", () => {
    const nsh = read("installer", "nsis", "uasco-installer.nsh");
    expect(nsh).not.toContain("%APPDATA%\\UASCO");
    expect(nsh.match(/%APPDATA%\\\$\{PRODUCT_FILENAME\}/g)?.length).toBe(5);
    expect(nsh).toContain('RMDir /r "$APPDATA\\${PRODUCT_FILENAME}"');
    expect(nsh).toContain('!define MUI_WELCOMEPAGE_TITLE "${PRODUCT_NAME} ${VERSION} Kurulumu"');
  });
});
