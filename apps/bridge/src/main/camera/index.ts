import type { CameraMode, DeviceTestResult } from "../../shared/types";
import { WebcamMacCamera } from "./webcam-mac";
import { WebcamWinCamera } from "./webcam-win";
import { DigiCamControlCamera } from "./digicamcontrol-win";
import { GPhoto2Camera } from "./gphoto2-unix";
import { MockCamera } from "./mock";

export type CameraOptions = {
  deviceName?: string;
  digiCamControlPath?: string;
  digiCamSessionFolder?: string;
  ffmpegPath?: string;
};

export type CaptureResult = {
  filePath: string;
  mimeType: string;
};

export interface CameraDevice {
  readonly mode: CameraMode;
  init(): Promise<void>;
  capture(): Promise<CaptureResult>;
  testConnection(): Promise<DeviceTestResult>;
  cleanup(): Promise<void>;
  // Optional: open the camera's live view so the kiosk can poll preview JPGs.
  // Best-effort — drivers without a live view simply no-op.
  startLiveView?(): Promise<void>;
  stopLiveView?(): Promise<void>;
  // Optional: hand the newest preview frame straight to the local HTTP server.
  // Drivers that own the device themselves (webcam-win) implement this so
  // /live-preview never has to proxy an external webserver; drivers backed by
  // digiCamControl leave it out and the proxy path stays in charge.
  getPreviewFrame?(): Buffer | null;
}

export function createCamera(mode: CameraMode, options: CameraOptions = {}): CameraDevice {
  switch (mode) {
    case "webcam-mac":
      return new WebcamMacCamera(options);
    case "webcam-win":
      return new WebcamWinCamera(options);
    case "digicamcontrol":
      return new DigiCamControlCamera(options);
    case "gphoto2":
      return new GPhoto2Camera(options);
    case "mock":
      return new MockCamera(options);
  }
}
