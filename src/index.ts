import Fastify from "fastify"
import multipart from '@fastify/multipart'
import { cleanup, ensureDir, workerPool } from "./utils/index.js"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "./gs.js"
import { pipeline } from "stream/promises"
import { config, getSourceFileName, headers } from "./config.js"
import { mediaWebhookRequest, stringWebhookRequest } from "./webhook.js"
import inlineRoutes from "./routes/inline.js"
import webhookRoutes from "./routes/webhook.js"
import s3Routes from "./routes/s3.js"

const app = Fastify({
  logger: true,
  trustProxy: true
})

await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: 256 * 1024 * 1024,
  }
})

// Init
app.register((app) => {
  ensureDir(config.uploads)
})

app.addContentTypeParser(
  'application/pdf',
  (req, payload, done) => done(null, payload)
)

app.register(inlineRoutes)
app.register(webhookRoutes)
app.register(s3Routes)

app.get('/health', async (request, reply) => {
  return { status: 'ok' }
})

app.listen({
  host: '0.0.0.0',
  port: parseInt(process.env.PORT!) || 3416
})
