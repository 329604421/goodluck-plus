FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 容器默认 UTC，不设 TZ 会导致 @Cron 在错误时间执行
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider -q http://localhost:3000/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
