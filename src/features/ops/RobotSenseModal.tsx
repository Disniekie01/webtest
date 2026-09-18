import { LidarMapView } from "./LidarMapView";
import { RobotCameraView } from "./RobotCameraView";
import type { LiveRobot } from "./useLiveTelemetry";
import "./RobotSenseModal.css";

export type SenseMode = "lidar" | "camera";

type Props = {
  robot: LiveRobot;
  mode: SenseMode;
  onMode: (m: SenseMode) => void;
  onClose: () => void;
};

/** Full-size LiDAR map / camera feed overlay for a selected robot. */
export function RobotSenseModal({ robot, mode, onMode, onClose }: Props) {
  return (
    <div className="robot-sense" role="dialog" aria-label={`${robot.name} sensors`}>
      <div className="robot-sense__panel">
        <header className="robot-sense__head">
          <div>
            <h2>{robot.name}</h2>
            <p className="mono muted">
              {mode === "lidar" ? `LiDAR · ${robot.lidarHz} Hz · ${robot.rangeM.toFixed(0)} m` : "Ego camera feed"}
              {" · "}
              {robot.district}
            </p>
          </div>
          <div className="robot-sense__tabs">
            <button
              type="button"
              className={mode === "lidar" ? "on" : ""}
              onClick={() => onMode("lidar")}
            >
              LiDAR map
            </button>
            <button
              type="button"
              className={mode === "camera" ? "on" : ""}
              onClick={() => onMode("camera")}
            >
              Camera
            </button>
            <button type="button" className="robot-sense__close" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="robot-sense__stage">
          {mode === "lidar" ? <LidarMapView robot={robot} /> : <RobotCameraView robot={robot} />}
        </div>

        <footer className="robot-sense__meta mono">
          <span>policy {robot.policy}</span>
          <span>cpu {robot.cpu.toFixed(0)}%</span>
          <span>link {robot.linkPct.toFixed(0)}%</span>
          <span>bat {Math.round(robot.battery * 100)}%</span>
        </footer>
      </div>
      <button type="button" className="robot-sense__backdrop" aria-label="Close" onClick={onClose} />
    </div>
  );
}
