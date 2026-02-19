import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { readFile } from "fs/promises"
import path from "path"
import { config } from "./config.js"
import jwt from "@fastify/jwt"
import { createSigner } from "fast-jwt"

export const initJWT = async (app: FastifyInstance) => {
  const publicKey = readFile(path.resolve(config.certs, 'public.key'))
  const privateKey = readFile(path.resolve(config.certs, 'private.key')).catch(() => null)

  app.log.info("Enabling JWT authorization")
  await app.register(jwt, {
    secret: {
      public: await publicKey
    },
    sign: { algorithm: 'RS256' },
    verify: { algorithms: ['RS256'] }
  })

  const key = await privateKey
  if(!key) return
  const signer = createSigner({
    key
  })
  app.log.info({ token: await signer({ 'iss': "root" }) }, "JWT ROOT TOKEN")
}

export const addJWTRoutes = async (router: FastifyInstance) => {
  router.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
      if(!request.user)
        reply.code(403).send("Invalid token")
    } catch (err) {
      reply.send(err)
    }
  })
}