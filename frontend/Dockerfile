# ==============================================================================
# Stage 1: Build de producción de Angular 19 (@angular/build:application)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ==============================================================================
# Stage 2: Servidor Nginx ligero con Reverse Proxy (/api/) y SPA fallback
# ==============================================================================
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/hiporeal-frontend/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
