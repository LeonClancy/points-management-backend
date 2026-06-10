import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';

export const swaggerPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Points Management Backend',
        version: '0.1.0'
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  });
});
