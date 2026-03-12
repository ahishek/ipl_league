import type { Player } from '../types';
import { getServerOrigin } from './serverOrigin';

export const generateTeamLogo = async (teamName: string, colorHex: string): Promise<string> => {
  const response = await fetch(`${getServerOrigin()}/api/ai/logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName, colorHex }),
  });
  if (!response.ok) return '';
  const data = (await response.json()) as { logo?: string };
  return data.logo || '';
};

export const generateAuctionCommentary = async (): Promise<string> => '';

export const generateUnsoldCommentary = async (): Promise<string> => '';

export const getPlayerInsights = async (player: Player): Promise<string> => {
  const response = await fetch(`${getServerOrigin()}/api/ai/player-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player }),
  });
  if (!response.ok) return 'Could not fetch insights.';
  const data = (await response.json()) as { insight?: string };
  return data.insight || 'No insight available.';
};
