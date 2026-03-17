import type { VimOptions } from "./types";

/** Filetype presets (ftplugin-like). When :set filetype=X is used, these options are applied. */
export const FILETYPE_PRESETS: Record<string, Partial<VimOptions>> = {
  python: { shiftwidth: 4, tabstop: 8, softtabstop: 4, expandtab: true },
  typescript: { shiftwidth: 2, tabstop: 2, softtabstop: 2, expandtab: true },
  ts: { shiftwidth: 2, tabstop: 2, softtabstop: 2, expandtab: true },
  swift: { shiftwidth: 4, tabstop: 4, softtabstop: 4, expandtab: true },
  csharp: { shiftwidth: 4, tabstop: 4, softtabstop: 4, expandtab: true },
  cs: { shiftwidth: 4, tabstop: 4, softtabstop: 4, expandtab: true },
  c: { shiftwidth: 4, tabstop: 8, softtabstop: 4, expandtab: true },
  json: { shiftwidth: 2, tabstop: 2, softtabstop: 2, expandtab: true },
};

export function applyFiletypePreset(
  opts: VimOptions,
  filetype: string
): void {
  const preset = FILETYPE_PRESETS[filetype.toLowerCase()];
  if (preset) {
    Object.assign(opts, preset);
  }
}
