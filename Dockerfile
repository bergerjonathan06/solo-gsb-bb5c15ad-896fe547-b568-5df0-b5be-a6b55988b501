# ---- 构建阶段：安装全部依赖并执行 Vite 构建（依赖安装包含在镜像构建中）----
FROM node:20-alpine AS build
WORKDIR /app

# 优先利用层缓存：先拷贝依赖清单
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并构建（含 TypeScript 类型检查）
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---- 运行阶段：仅携带构建产物与零依赖静态服务器 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/main.mjs"]
