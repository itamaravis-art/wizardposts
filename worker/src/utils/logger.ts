// Pino logger. No DB sink — the worker reports state through the cloud API.

import pino, { type Logger } from 'pino';
import pretty from 'pino-pretty';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || 'info';

const stream = isProduction
  ? process.stdout
  : pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
    });

export const logger: Logger = pino({ level }, stream as NodeJS.WritableStream);

export type LogLevel = 'info' | 'warn' | 'error';
