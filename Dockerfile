FROM node:20 AS build

# 设置工作目录
WORKDIR /app

COPY . .
# v9.16（dsh）：registry 只对本次命令生效（原先用 npm config set 会写进镜像层全局配置）；
# 用 npm ci 严格按 package-lock.json 安装，保证构建可复现。
RUN npm ci --registry=https://registry.npmmirror.com
RUN npm run build

# 将构建好的 React 应用复制到 Nginx 容器的默认站点目录
FROM nginx:alpine
COPY ./public/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /app
