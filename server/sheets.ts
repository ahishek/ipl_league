import { parse } from 'csv-parse/sync';
import type { Player, PlayerStats, Position, Pot } from '../types';

const SAMPLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1n4wZ_KymT8Njo4wBojJM_B0XO7K5H6j_XIaNxVcypT8/edit?usp=sharing';
const SAMPLE_SHEET_TAB = 'Copy of All Players Data';

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .trim();

const parseNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value || '').replace(/,/g, '').trim().toLowerCase();
  if (!text) return 0;

  let multiplier = 1;
  if (text.includes('cr') || text.includes('crore')) multiplier = 100;
  if (text.includes('lakh') || text.includes('lac')) multiplier = 1;

  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;

  return Math.round(Number.parseFloat(match[0]) * multiplier * 100) / 100;
};

const mapRole = (raw: unknown): Position => {
  const value = String(raw || '').toLowerCase();
  if (value.includes('wk') || value.includes('keep')) return 'Wicket Keeper';
  if (value.includes('ar') || value.includes('all')) return 'All Rounder';
  if (value.includes('bowl')) return 'Bowler';
  return 'Batter';
};

const mapPot = (raw: unknown): Pot => {
  const value = String(raw || '').toUpperCase().trim();
  if (value.startsWith('A')) return 'A';
  if (value.startsWith('B')) return 'B';
  if (value.startsWith('C')) return 'C';
  if (value.startsWith('D')) return 'D';
  return 'Uncategorized';
};

const toPlayer = (row: Record<string, unknown>, index: number, sourceUrl: string): Player => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value;
  }

  const stats: PlayerStats = {
    matches: parseNumber(normalized.matches),
    runs: parseNumber(normalized.runs),
    batAvg: parseNumber(normalized['bat avg'] ?? normalized.average),
    batStrikeRate: parseNumber(normalized['bat sr'] ?? normalized['bat strike rate']),
    wickets: parseNumber(normalized.wickets),
    bowlStrikeRate: parseNumber(normalized['bowl sr'] ?? normalized['bowl strike rate']),
    economy: parseNumber(normalized['economy rate'] ?? normalized.economy),
    bowlAvg: parseNumber(normalized['bowl avg'] ?? normalized['bowling average']),
    historicalAuctionPrice: parseNumber(
      normalized['ipl auction price'] ?? normalized['auction price'] ?? normalized['sold price'],
    ),
  };

  return {
    id: `sheet-${Date.now()}-${index}`,
    name: String(normalized.name || normalized.player || `Player ${index + 1}`).trim(),
    position: mapRole(normalized.role || normalized.type || normalized.position),
    pot: mapPot(normalized.pool || normalized.pot || normalized.category),
    basePrice: parseNumber(normalized['base price'] ?? normalized.price ?? normalized['reserve price']),
    status: 'PENDING',
    imageUrl: String(normalized['image url'] || normalized.image || normalized.photo || '').trim() || undefined,
    iplTeam: String(normalized.team || normalized['ipl team'] || '').trim() || undefined,
    country: String(normalized.country || normalized.nation || '').trim() || undefined,
    stats,
    sourceUrl,
  };
};

export const parseSheetReference = (sheetUrl?: string, sheetName?: string) => {
  const inputUrl = (sheetUrl || SAMPLE_SHEET_URL).trim();
  const match = inputUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error('Invalid Google Sheets URL.');
  }

  return {
    sheetId: match[1],
    sheetName: (sheetName || SAMPLE_SHEET_TAB).trim() || SAMPLE_SHEET_TAB,
    sourceUrl: inputUrl,
  };
};

export const fetchPlayersFromGoogleSheet = async (sheetUrl?: string, sheetName?: string) => {
  const { sheetId, sheetName: tabName, sourceUrl } = parseSheetReference(sheetUrl, sheetName);
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch Google Sheet. Ensure the sheet is public and the tab name is correct.');
  }

  const csv = await response.text();
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, unknown>[];

  const players = records
    .map((row, index) => toPlayer(row, index, sourceUrl))
    .filter((player) => player.name && player.basePrice >= 0);

  const summary = {
    totalPlayers: players.length,
    byRole: players.reduce<Record<string, number>>((acc, player) => {
      acc[player.position] = (acc[player.position] || 0) + 1;
      return acc;
    }, {}),
    byPot: players.reduce<Record<string, number>>((acc, player) => {
      acc[player.pot] = (acc[player.pot] || 0) + 1;
      return acc;
    }, {}),
  };

  return { players, summary, url, sheetName: tabName };
};

export const getSampleSheetDefaults = () => ({
  sheetUrl: SAMPLE_SHEET_URL,
  sheetName: SAMPLE_SHEET_TAB,
});
