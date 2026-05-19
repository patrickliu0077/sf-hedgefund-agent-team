import pino from 'pino'
import { createApp } from './api.js'
import { loadConfig } from './config.js'
import { HedgeFundOrchestrator } from './orchestrator.js'
import { JsonlStore } from './store.js'

const config = loadConfig()
const logger = pino({ level: config.logLevel })
const store = new JsonlStore(config.dataDir)
await store.init()

const orchestrator = new HedgeFundOrchestrator(config, store)
const app = createApp({ config, orchestrator, store, logger })

app.listen(config.port, () => {
  logger.info({
    port: config.port,
    mode: config.defaultLoop.mode,
    strategy: config.defaultLoop.strategy,
    liveEnabled: config.enableLiveTrading,
  }, 'sf hedgefund agent team listening')
})
