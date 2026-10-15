import { describe, expect, it } from 'vitest';
import { encodeEvent, isAssistantErrorCode, parseEventChunk, readEventStream, type AssistantEvent } from '../src/events';

describe('NDJSON events', () => {
  it('splits complete lines and keeps the tail', () => {
    const { events, rest } = parseEventChunk('{"type":"text","text":"a"}\n{"type":"tool","name":"x"}\n{"type":"te');
    expect(events).toEqual([{ type: 'text', text: 'a' }, { type: 'tool', name: 'x' }]);
    expect(rest).toBe('{"type":"te');
  });

  it('skips malformed and unknown lines', () => {
    const { events } = parseEventChunk('not json\n{"type":"nope"}\n\n{"type":"done"}\n');
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('round-trips encoded events', () => {
    const event: AssistantEvent = { type: 'confirm', id: 'c1', name: 'add', input: { a: 'line\nbreak' }, token: 't' };
    expect(parseEventChunk(encodeEvent(event)).events).toEqual([event]);
  });

  it('reads a stream split at arbitrary byte boundaries', async () => {
    const bytes = new TextEncoder().encode(encodeEvent({ type: 'text', text: 'Привет, oʻzbek 👋' }) + '{"type":"done"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
        controller.close();
      },
    });
    const events: AssistantEvent[] = [];
    for await (const event of readEventStream(body)) events.push(event);
    expect(events).toEqual([{ type: 'text', text: 'Привет, oʻzbek 👋' }, { type: 'done' }]);
  });

  it('recognises error codes', () => {
    expect(isAssistantErrorCode('BUSY')).toBe(true);
    expect(isAssistantErrorCode('busy')).toBe(false);
    expect(isAssistantErrorCode(undefined)).toBe(false);
  });
});
