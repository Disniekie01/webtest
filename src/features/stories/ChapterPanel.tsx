import type { Chapter } from "../../data/ascTypes";
import { useAscStore } from "../../state/ascStore";
import "./ChapterPanel.css";

export function ChapterPanel({ chapter }: { chapter: Chapter }) {
  const setMode = useAscStore((s) => s.setMode);
  const openCitizen = useAscStore((s) => s.openCitizen);

  return (
    <section className="chapter-panel" aria-label={chapter.title}>
      <div className="chapter-panel__inner">
        <header>
          <p className="mono muted eyebrow">Narrative</p>
          <h2>{chapter.title}</h2>
        </header>
        <div className="chapter-panel__body">
          <div className="chapter-panel__narration">
            <p>{chapter.narration}</p>
            <div className="chapter-panel__actions">
              {chapter.citizenId && (
                <button type="button" onClick={() => openCitizen(chapter.citizenId!)}>
                  Open {chapter.title} profile
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setMode("ops")}>
                Return to ops
              </button>
            </div>
          </div>
          <div className="chapter-panel__video">
            {chapter.videoUrl ? (
              <video src={chapter.videoUrl} controls playsInline />
            ) : (
              <div className="video-placeholder">
                <span className="mono">Video slot</span>
                <p>Drop story footage in public/videos/ and set videoUrl on this chapter.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
