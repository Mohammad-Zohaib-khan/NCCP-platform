/**
 * Fastify encapsulates every registered plugin: hooks, decorators and error handlers set inside a plain plugin
 * are invisible to its siblings. Marking a plugin with the 'skip-override' symbol (exactly what the
 * fastify-plugin package does) shares it with the whole app. Use for cross-cutting plugins only.
 */
export function shared<T extends (...args: never[]) => unknown>(plugin: T): T {
  (plugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true
  return plugin
}
