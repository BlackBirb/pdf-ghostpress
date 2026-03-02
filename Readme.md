# PDF Ghostpress

Self-hosted PDF compression service built to run in a docker container.
Uses Ghostscript to compress PDF files and exposes an API and webhook calles for interacting with it. Support for direct interactions with S3.
This service is **not intended to be user-facing**, but being called by backend services.

### Why?
Instead of embedding Ghostscript directly, you can put compression behind a service. Allowing for dedicated servers for compressiong and better horizontal scaling.

This is ideal for microservices architectures, serverless apps, or backend processing workers.

Also it's cool?

## Features

### Multiple Integration Modes
- **Inline** - sync request/response.
- **Webhook** - async processing with sccess / error callbacks to a webhook.
- **S3** - compress files stored in S3 and write results back into buckets via pre-signed urls. 

### JWT Authentication
Secure API access using 3rd party signed JSON Web Tokens.

### Docker-First
Runs in a containerized environment for ease of deployment and scaling.

# API
Keep in mind the service keeps track of running tasks and will not allow more than `WORKERS` number of tasks at once (defaults to 10). This should be adjusted based on server resources. Any requests that happen when queue is full will be *DROPPED* with 503.

## 📝 Inline
**POST** `/process/inline`

Compress a PDF and return it directly in the response. The body should be either binary `application/pdf` or `multipart/form-data` with `file` field.

#### Optional querystring:
- **quality** - One of `screen | ebook | printer | prepress | default` presets used in ghostscript.

#### Response headers:
- **Trace** - Unique ID for this request (Not much point of it for inline, but added for consistency)

#### Responses:
- **200 OK** - compressed PDF binary.
- **4xx/5xx** - error object.

## 🔁 Webhook
**POST** `/process/webhook`

Compress a PDF and get back to your service via webhook on success / error. The body should be either binary `application/pdf` or `multipart/form-data` with `file` field.

#### Optional querystring:
- **quality** - One of `screen | ebook | printer | prepress | default` presets used in ghostscript.

#### Request headers:
- **ghostscript-reply-to** - Url for success webhook.
- **ghostscript-report-to** - Url for error webhook.
- **trace** - (Optional) Unique ID for the task. Will be generated if not provided.

#### Response headers:
- **Trace** - Provided or generated unique ID for the task.

#### Response: `application/json`
```
{ 
  trace: "123"
}
```

#### Webhook response headers:
- **Trace** - Provided or generated unique ID for the task.

## ☁️ S3
**POST** `/process/s3`

Tell the service to compress a PDF either sent as body or stored in S3 and write result directly into S3 via presigned url.

`multipart/form-data` body with either `source` field which contains pre-signed URL to a file in S3 storage or `file` field with raw file to compress. `file` field has priority if both are provided. 

Requires `destination` field with pre-signed URL to upload the file into S3. Keep in mind the URL has to have long enough expiry time.

Uses webhooks to get back and report to your app. There's no inline request/response support for S3.

#### Optional querystring:
- **quality** - One of `screen | ebook | printer | prepress | default` presets used in ghostscript.

#### Request headers:
- **ghostscript-reply-to** - Url for success webhook.
- **ghostscript-report-to** - Url for error webhook.
- **trace** - (Optional) Unique ID for the task. Will be generated if not provided.


#### Response headers:
- **Trace** - Provided or generated unique ID for the task.

#### Response: `application/json`
```
{ 
  trace: "123"
}
```

## 🔐 JWT Authentication (Optional)
PDF Ghostpress supports JWT (JSON Web Token) authentication.

To enable JWT authentication, set env variable `JWT_ENABLE ` to `true` and create a `public.key` file inside `/srv/certs` volume. `private.key` is not required for JWT to work, but if provided, the container will **create and log a signed token** on startup.

> Important: JWT authentication is *optional*.
> 
> If no valid public RSA key is found, authentication will be DISABLED.

Enabling JWT Authentication will enable it for ALL endpoints excluding `/health`.

The service doesn't care about any token contents. As long as it's signed and valid it'll accept it.

### Sending Authenticated Requests
Include the token as a Bearer token:
```
Authorization: Bearer <signed_jwt_token>
```

### Example: Generating a Token (Node.js)
```ts
import { createSigner } from "fast-jwt"

const signer = createSigner({
  key: privateKey,
  iss: "internal-service"
  expiresIn: 60 * 60 * 1000 // 1 hour
})

const token = await signer({ 
  'quack': 'Quack!' // this doesn't matter
})

console.log(token)
```

## 📦 Docker deployment

More info on using the container is on the [docker hub](https://hub.docker.com/r/blackbirdapp/pdf-ghostpress)

## Contributing
I'll appreciate any issues and contributions.

### AGPL-3.0 Licensed
Due to inclusion of Ghostscript (AGPL), distribution must comply with AGPL terms.
