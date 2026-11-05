import type { FunnelPerson, FunnelSource } from '../../services/funnel/funnel.js';

/** [P63-6] Test/dev funnel source: the people it was seeded with. */
export class InMemoryFunnelSource implements FunnelSource {
  private list: FunnelPerson[] = [];
  seed(people: FunnelPerson[]): this { this.list = people.map((p) => ({ ...p })); return this; }
  async people(): Promise<FunnelPerson[]> { return this.list.map((p) => ({ ...p })); }
}
