import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import multipart from '@fastify/multipart'
import { cleanup, ensureDir, workerPool } from "./utils/index.js"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "./gs.js"
import { pipeline } from "stream/promises"
import { config, getSourceFileName, headers } from "./config.js"
import { mediaWebhookRequest, stringWebhookRequest } from "./webhook.js"
import inlineRoutes from "./routes/inline.js"
import webhookRoutes from "./routes/webhook.js"
import s3Routes from "./routes/s3.js"
import jwt from "@fastify/jwt"
import { readFile } from "fs/promises"
import path from "path"
import { createSigner } from 'fast-jwt'

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

if(process.env.JWT_ENABLE) {
  const publicKey = readFile(path.resolve(config.certs, 'public.key'))
  const privateKey = readFile(path.resolve(config.certs, 'private.key'))

  const syncSigner = createSigner({ key: await privateKey })
  app.log.info({ rootToken: syncSigner({ root: true }) }, "Enabling JWT authorization")
  await app.register(jwt, {
    secret: {
      public: await publicKey
    },
    sign: { algorithm: 'RS256' },
    verify: { algorithms: ['RS256'] }
  })
}

// Init
app.register((app) => {
  ensureDir(config.uploads)
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
  if(process.env.JWT_ENABLE)
    router.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify()
        if(!request.user)
          reply.code(403).send("Invalid token")
      } catch (err) {
        reply.send(err)
      }
    })

  router.register(inlineRoutes)
  router.register(webhookRoutes)
  router.register(s3Routes)
})

app.listen({
  host: '0.0.0.0',
  port: parseInt(process.env.PORT!) || 3416
})
