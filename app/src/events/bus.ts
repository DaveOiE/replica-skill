// Events tell the rest of the system something happened (after the transaction commits). Filters let a plugin change
// a value on its way through. Handlers are isolated: one that throws never breaks the sale that triggered it.
export interface EventMap {
  'settings.changed': { key: string; before: unknown; after: unknown; actorUserId: string | null };
  'sale.created': { orderId: string; number: string; totalCents: number };
  'audit.written': { action: string };
  [name: string]: unknown;
}
type Handler<T> = (payload: T) => void | Promise<void>;
type Filter<T> = (value: T, ctx?: unknown) => T | Promise<T>;

export function createBus(onError: (name: string, err: unknown) => void = () => {}) {
  const handlers = new Map<string, Handler<any>[]>();
  const filters = new Map<string, { fn: Filter<any>; priority: number }[]>();
  return {
    on<K extends keyof EventMap & string>(name: K, h: Handler<EventMap[K]>): () => void {
      const list = handlers.get(name) ?? []; list.push(h); handlers.set(name, list);
      return () => handlers.set(name, (handlers.get(name) ?? []).filter((x) => x !== h));
    },
    async emit<K extends keyof EventMap & string>(name: K, payload: EventMap[K]): Promise<void> {
      for (const h of [...(handlers.get(name) ?? [])]) {
        try { await h(payload); } catch (e) { onError(name, e); }
      }
    },
    /** Lower priority runs first; equal priorities run in the order added. */
    addFilter<T>(name: string, fn: Filter<T>, priority = 10): () => void {
      const list = filters.get(name) ?? []; list.push({ fn, priority }); filters.set(name, list);
      return () => filters.set(name, (filters.get(name) ?? []).filter((x) => x.fn !== fn));
    },
    async applyFilters<T>(name: string, value: T, ctx?: unknown): Promise<T> {
      let v = value;
      const list = [...(filters.get(name) ?? [])].sort((a, b) => a.priority - b.priority);
      for (const f of list) {
        try { v = await f.fn(v, ctx); } catch (e) { onError(name, e); }
      }
      return v;
    },
  };
}
export type Bus = ReturnType<typeof createBus>;
