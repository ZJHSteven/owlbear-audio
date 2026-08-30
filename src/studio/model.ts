import type { RuntimePlan, RuntimePlayCue } from "../runtime/protocol";

export interface StudioAsset {
  id: string;
  name: string;
  url: string;
  mime: string;
  durationSeconds?: number;
  source: "owlbear" | "demo";
  addedAt: number;
}

export interface StudioCue {
  id: string;
  name: string;
  assetId: string;
  busId: "MUSIC" | "AMBIENCE" | "SFX" | "VOICE";
  gainDb: number;
  loop: boolean;
  fadeSeconds: number;
}

export interface StudioDraft {
  id: string;
  name: string;
  assets: StudioAsset[];
  cues: StudioCue[];
}

const STORAGE_KEY = "owlbear-audio/studio-draft/v1";

export function createEmptyDraft(): StudioDraft {
  return {
    id: crypto.randomUUID(),
    name: "Tonight's Show",
    assets: [],
    cues: [],
  };
}

export function loadStudioDraft(): StudioDraft {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyDraft();
    const parsed = JSON.parse(raw) as Partial<StudioDraft>;
    if (!parsed.id || !Array.isArray(parsed.assets) || !Array.isArray(parsed.cues)) {
      return createEmptyDraft();
    }
    return {
      id: parsed.id,
      name: parsed.name || "Tonight's Show",
      assets: parsed.assets as StudioAsset[],
      cues: parsed.cues as StudioCue[],
    };
  } catch {
    return createEmptyDraft();
  }
}

export function saveStudioDraft(draft: StudioDraft): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function toRuntimePlan(draft: StudioDraft): RuntimePlan {
  const assets = new Map(draft.assets.map((asset) => [asset.id, asset]));
  const cues: RuntimePlayCue[] = draft.cues.flatMap((cue) => {
    const asset = assets.get(cue.assetId);
    if (!asset) return [];
    return [
      {
        id: cue.id,
        name: cue.name,
        type: "PLAY",
        url: asset.url,
        busId: cue.busId,
        gainDb: cue.gainDb,
        loop: cue.loop,
        fadeSeconds: cue.fadeSeconds,
      },
    ];
  });

  return {
    id: draft.id,
    name: draft.name,
    cues,
  };
}
