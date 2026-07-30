// electron-builder afterSign hook.
//
// CI has no Apple Developer ID cert, so code signing is disabled
// (CSC_IDENTITY_AUTO_DISCOVERY=false) and the .app ships completely
// unsigned. Modern macOS — especially on Apple Silicon — responds to a
// fully unsigned app downloaded via a browser with "'Claude Tray' is
// damaged and can't be opened", a hard block with no "Open Anyway" option
// in System Settings (unlike the ordinary unidentified-developer warning).
//
// Ad-hoc signing (identity "-", no cert needed) doesn't get us Apple
// notarization, so the ordinary Gatekeeper "unidentified developer" prompt
// still shows up on first launch — see the README for that. But it's
// enough to stop the harder "damaged" block, which otherwise leaves users
// with no path forward short of manually running `xattr -cr` themselves.
const { execFileSync } = require("child_process");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
