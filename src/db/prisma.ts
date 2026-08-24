import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Create a .env file (see .env.example) before starting the bot.');
}

export const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });