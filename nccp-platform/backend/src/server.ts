import { loadConfig } from './config/env.js'
import { createPool } from './db/pool.js'
import { buildApp } from './app.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = createPool(config)
  const app = await buildApp({ config, db })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    const force = setTimeout(() => { app.log.error('forced exit after timeout'); process.exit(1) }, 15_000)
    force.unref()
    try {
      await app.close()   // stop accepting, drain in-flight requests
      await db.end()      // release DB connections
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => { app.log.error({ reason }, 'unhandledRejection') })

  await app.listen({ port: config.port, host: config.host })
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
