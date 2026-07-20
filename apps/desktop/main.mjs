import { app, BrowserWindow, shell, session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const APP_PORT = 47_831;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const DEV_URL = process.env.PILOT_DESKTOP_DEV_URL;
const RELEASES_URL = "https://github.com/Jayhgth/PilotPrincess3/releases";

let mainWindow = null;

function isAuthNavigation(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === APP_ORIGIN
      || parsed.hostname.endsWith(".supabase.co")
      || parsed.hostname === "accounts.google.com"
      || parsed.hostname.endsWith(".google.com")
      || (parsed.hostname === "github.com" && parsed.pathname.startsWith("/login"));
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The local Astro server may still be loading its route manifest.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Pilot Princess could not start its local application server.");
}

async function startProductionServer() {
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(APP_PORT);
  process.env.PILOT_DESKTOP = "true";
  process.env.CODEX_ALLOW_LOCAL_AUTH = "true";
  const entry = join(app.getAppPath(), "dist", "server", "entry.mjs");
  await import(pathToFileURL(entry).href);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    frame: true,
    movable: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
    backgroundColor: "#111315",
    title: "Pilot Princess",
    autoHideMenuBar: true,
    trafficLightPosition: { x: 18, y: 15 },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAuthNavigation(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  await window.loadURL(DEV_URL ?? APP_ORIGIN);
}

async function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const updaterModule = await import("electron-updater");
    const autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
    if (!autoUpdater) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", () => undefined);
    await autoUpdater.checkForUpdates();
  } catch {
    // Unsigned preview builds can still use the releases page until signing is configured.
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    if (!DEV_URL) await startProductionServer();
    await waitForServer(DEV_URL ?? APP_ORIGIN);
    await createWindow();
    void checkForUpdates();
  }).catch(async (error) => {
    await shell.openExternal(`${RELEASES_URL}?startup_error=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
    app.quit();
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
