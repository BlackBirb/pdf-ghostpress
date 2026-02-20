import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { readFile } from "fs/promises"
import path from "path"
import { config } from "./config.js"
import jwt from "@fastify/jwt"
import { createSigner } from "fast-jwt"

export const initJWT = async (app: FastifyInstance) => {
  const publicKeyPromise = readFile(path.resolve(config.certs, 'public.key')).catch(() => null)
  const privateKeyPromise = readFile(path.resolve(config.certs, 'private.key')).catch(() => null)

  app.log.info("Enabling JWT authorization")
  const publicKey = await publicKeyPromise
  if(!publicKey)
    return app.log.error("JWT Public token failed to load")

  await app.register(jwt, {
    secret: {
      public: publicKey
    },
    sign: { algorithm: 'RS256' },
    verify: { algorithms: ['RS256'] }
  })

  const privateKey = await privateKeyPromise
  if(!privateKey) 
    return
  
  const signer = createSigner({
    key: privateKey
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