FROM node:20-alpine

WORKDIR /sportanet

COPY backend /sportanet/backend
COPY ["Base de Datos", "/sportanet/Base de Datos"]

WORKDIR /sportanet/backend
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["sh", "-lc", "node scripts/migrate.js --yes && node app.js"]
