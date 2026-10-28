import type { EditOptions, ProjectView } from './client';
export function cutoutTarget(view: ProjectView, options: EditOptions, selected: string | null) {
  if (selected && selected !== 'primary' && view.stickers?.some(item => item.id === selected)) return { kind: 'sticker' as const, id: selected };
  if (selected === 'primary' && !options.hidePrimary) return { kind: 'primary' as const };
  if (view.pendingPhoto) return { kind: 'import' as const, id: view.pendingPhoto.id };
  if (!options.hidePrimary) return { kind: 'primary' as const };
  const last = view.stickers?.at(-1);
  return last ? { kind: 'sticker' as const, id: last.id } : null;
}
