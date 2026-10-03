import type { AiPauseRepository } from '../../ports/ai-pause-repository.js';

/** In-memory runtime kill switch (tests). */
export class InMemoryAiPauseRepository implements AiPauseRepository {
  private paused = false;
  async getPaused(): Promise<boolean> {
    return this.paused;
  }
  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
  }
}
