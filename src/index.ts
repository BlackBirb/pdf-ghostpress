import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import multipart from '@fastify/multipart'
import { ensureDir } from "./utils/index.js"
import { config } from "./config.js"
import inlineRoutes from "./routes/inline.js"
import webhookRoutes from "./routes/webhook.js"
import s3Routes from "./routes/s3.js"
import { addJWTRoutes, initJWT } from "./jwt.js"

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

if(config.useJWT) {
  await initJWT(app)
}

// Init
await app.register((app) => {
  ensureDir(config.uploads)
  ensureDir(config.certs)
})

app.addContentTypeParser(
  'application/pdf',
  (req, payload, done) => done(null, payload)
)

app.get('/health', async (request, reply) => {
  reply.header("Cache-Control", "no-store")
  return { status: 'ok' }
})


app.register((router) => {
  if(config.useJWT)
    addJWTRoutes(router)

  router.register(inlineRoutes)
  router.register(webhookRoutes)
  router.register(s3Routes)
})

app.listen({
  host: '0.0.0.0',
  port: parseInt(process.env.PORT!) || 3416
})
