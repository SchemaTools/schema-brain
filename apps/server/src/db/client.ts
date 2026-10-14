// Подключение к базе: Prisma с драйвером pg (как в Schema Teams).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Транзакция Prisma — тот же набор моделей, что у клиента. */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
