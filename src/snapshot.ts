import type { EditOptions, ProjectView } from './client';
export type Snapshot = { view: ProjectView | null; draft?: EditOptions | null; history: EditOptions[]; activeStickerId?: string | null; pendingJob: string | null };
export function lastEdit(input: Snapshot): Snapshot {
  const { view, draft, history, pendingJob } = input;
  const activeStickerId = input.activeStickerId === 'primary' ? 'primary' : view?.stickers?.some(item => item.id === input.activeStickerId) ? input.activeStickerId : null;
  return { view, draft, history, activeStickerId, pendingJob };
}
