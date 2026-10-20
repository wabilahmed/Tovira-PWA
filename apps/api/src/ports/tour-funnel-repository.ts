/** [P37] Anonymous tour funnel counts — per (tour version, step, event). No user id, no personal data. */
export type TourFunnelEvent = 'reached' | 'completed' | 'import_tapped';
export interface TourFunnelRow { version: number; step: number | null; event: TourFunnelEvent; count: number }
export interface TourFunnelRepository {
  /** +1 for (version, step, event); step null for whole-tour events. */
  bump(version: number, step: number | null, event: TourFunnelEvent): Promise<void>;
  list(): Promise<TourFunnelRow[]>;
}
