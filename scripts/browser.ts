import { chromium, type Browser } from "playwright";

// Windows Edge's debugger socket stays on Windows loopback, which this WSL guest
// cannot open, and the vEthernet firewall drops a relay. The harness uses
// Playwright's Chromium with the same software GL flags. Tier 3 screenshots
// still go through the installed Edge on the real GPU.
//
// Software GL, on purpose. Deterministic across machines. Do not change these two flags.
const glArgs = ["--use-gl=angle", "--use-angle=swiftshader"];

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [...glArgs, "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
  });
}
