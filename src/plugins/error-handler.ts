import fp from 'fastify-plugin';
import { AppError } from '../shared/errors.js';

type FastifyValidationError = Error & {
  code?: string;
  statusCode?: number;
  validation?: unknown;
  validationContext?: string;
};

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    if (isFastifyValidationError(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: {
            validation: error.validation,
            validationContext: error.validationContext
          }
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error'
      }
    });
  });
});

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as FastifyValidationError;

  return candidate.code === 'FST_ERR_VALIDATION' || candidate.validation !== undefined;
}
