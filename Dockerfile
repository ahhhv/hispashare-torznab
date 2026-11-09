# syntax=docker/dockerfile:1
# Imagen multiarquitectura (linux/arm64 y linux/amd64). Sin dependencias npm.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=9118

WORKDIR /app
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src

# Usuario sin privilegios que ya trae la imagen oficial (uid 1000)
USER node

EXPOSE 9118

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9118)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
