import type { ModelClient, ModelCompletionResponse } from '../../ports/model.js';

/**
 * Local stand-in for the AI model: returns canned, schema-shaped JSON so the
 * whole capture→extract→store flow runs offline with no API key or spend.
 */
export class StubModelClient implements ModelClient {
  constructor(
    private readonly cannedText: string = JSON.stringify({
      summary: '',
      promises: [],
      people: [],
      personal_facts: [],
      key_dates: [],
      concerns: [],
      next_steps: [],
      meeting: null,
    }),
  ) {}

  async complete(): Promise<ModelCompletionResponse> {
    return { text: this.cannedText, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
