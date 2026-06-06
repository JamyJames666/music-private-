import {Setting} from '@prisma/client';
import {prisma} from './db.js';
import {createGuildSettings} from '../events/guild-create.js';

export type GuildSettings = Setting & {adminOnlyCommands: boolean; songRequestsOpen: boolean};

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const config = await prisma.setting.findUnique({where: {guildId}}) ?? await createGuildSettings(guildId);

  // Read these columns via raw SQL — the Prisma-generated client may predate
  // the migrations that added them (version mismatch between CLI and runtime).
  const raw = await prisma.$queryRaw<Array<{adminOnlyCommands: number; songRequestsOpen: number}>>`
    SELECT "adminOnlyCommands", "songRequestsOpen" FROM "Setting" WHERE "guildId" = ${guildId} LIMIT 1
  `;

  return {
    ...config,
    adminOnlyCommands: (raw[0]?.adminOnlyCommands ?? 0) === 1,
    songRequestsOpen: (raw[0]?.songRequestsOpen ?? 1) === 1,
  };
}
