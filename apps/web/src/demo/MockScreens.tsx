// Drawn stand-ins for the screenshots of the changed app in the demo (MOCK, not real screenshots).
import { useState } from "react";

export function MockAddForm({ confirmMode }: { confirmMode: boolean }) {
  const [shown, setShown] = useState(false);
  const [tags, setTags] = useState<string[]>(confirmMode ? [] : ["python", "django"]);
  const suggestions = ["python", "django", "reading-list", "tools"];
  return (
    <div className="mock-shot" aria-label="Mock of the changed linkding add form">
      <div className="mock-bar">linkding · New bookmark <span className="mock-tag">MOCK screen</span></div>
      <label>URL<input readOnly value="https://docs.djangoproject.com/en/5.2/" /></label>
      <label>Title<input readOnly value="Django documentation" /></label>
      <div className="mock-field">
        <span>Tags</span>
        <div className="mock-tags">
          {tags.map((t) => (
            <span key={t} className="chip on">{t} ✕</span>
          ))}
          <button type="button" className="mock-suggest" onClick={() => setShown(true)}>✨ Suggest tags</button>
        </div>
      </div>
      {shown && (
        <div className="mock-suggestions">
          <span className="muted small">From your own tags:</span>
          {suggestions.filter((s) => !tags.includes(s)).map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setTags((t) => [...t, s])}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
