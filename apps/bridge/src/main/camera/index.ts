import type { CameraMode, DeviceTestResult } from "../../shared/types";
import { WebcamMacCamera } from "./webcam-mac";
import { DigiCamControlCamera } from "./digicamcontrol-win";
import { GPhoto2Camera } from "./gphoto2-unix";
import { MockCamera } from "./mock";

export type CameraOptions = {
  deviceName?: string;
  digiCamControlPath?: string;
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
}

export function createCamera(mode: CameraMode, options: CameraOptions = {}): CameraDevice {
  switch (mode) {
    case "webcam-mac":
      return new WebcamMacCamera(options);
    case "digicamcontrol":
      return new DigiCamControlCamera(options);
    case "gphoto2":
      return new GPhoto2Camera(options);
    case "mock":
      return new MockCamera(options);
  }
}
