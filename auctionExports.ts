import type { AuctionArchive, LogEntry, Player, Room, Team } from './types';

type ExportPayload = {
  roomId: string;
  roomName: string;
  completedAt: number;
  teams: Team[];
  players: Player[];
  logs: LogEntry[];
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'auction-summary';

const toPayload = (source: Room | AuctionArchive): ExportPayload =>
  'status' in source
    ? {
        roomId: source.id,
        roomName: source.name,
        completedAt: Date.now(),
        teams: source.teams,
        players: source.players,
        logs: source.gameState.logs,
      }
    : {
        roomId: source.roomId,
        roomName: source.roomName,
        completedAt: source.completedAt,
        teams: source.teams,
        players: source.players,
        logs: source.logs || [],
      };

const escapeCsv = (value: string | number) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const createAuctionExportFiles = (source: Room | AuctionArchive) => {
  const payload = toPayload(source);
  const filenameBase = `${slugify(payload.roomName)}-${new Date(payload.completedAt).toISOString().slice(0, 10)}`;

  const rosterRows = payload.teams.flatMap((team) => {
    if (team.roster.length === 0) {
      return [
        [
          payload.roomName,
          payload.roomId,
          new Date(payload.completedAt).toISOString(),
          team.name,
          team.ownerName,
          '',
          '',
          '',
          0,
          team.budget,
          team.roster.length,
        ],
      ];
    }

    return team.roster.map((player) => [
      payload.roomName,
      payload.roomId,
      new Date(payload.completedAt).toISOString(),
      team.name,
      team.ownerName,
      player.name,
      player.position,
      player.pot,
      player.soldPrice || 0,
      team.budget,
      team.roster.length,
    ]);
  });

  const csvLines = [
    [
      'room_name',
      'room_id',
      'completed_at',
      'team_name',
      'team_owner',
      'player_name',
      'player_role',
      'player_pot',
      'sold_price_l',
      'team_budget_left_l',
      'team_roster_size',
    ].join(','),
    ...rosterRows.map((row) => row.map(escapeCsv).join(',')),
  ];

  const json = JSON.stringify(payload, null, 2);
  const csv = csvLines.join('\n');

  return {
    filenameBase,
    csv,
    json,
  };
};
