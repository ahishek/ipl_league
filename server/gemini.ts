import { GoogleGenAI } from '@google/genai';
import type { Player, Team } from '../types';

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

const getAi = () => {
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const hasGemini = Boolean(apiKey);

export const generateTeamLogo = async (teamName: string, colorHex: string): Promise<string> => {
  const ai = getAi();
  if (!ai) return '';

  try {
    const prompt = `Create a premium cricket franchise badge for "${teamName}".
Primary color: ${colorHex}.
Style: sharp vector emblem, black background, bold silhouette, high contrast, premium sports branding, no text in the logo.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
    });

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
  } catch (error) {
    console.error('logo-generation-failed', error);
  }

  return '';
};

export const generateAuctionCommentary = async (
  player: Player,
  team: Team,
  soldPrice: number,
  teamsState: Team[],
): Promise<string> => {
  const ai = getAi();
  if (!ai) return '';

  try {
    const teamStanding = teamsState
      .map((entry) => `${entry.name}: purse ${entry.budget}L, squad ${entry.roster.length}`)
      .join(' | ');

    const prompt = `You are an elite IPL auction commentator.
React to this sale in one sentence, max 24 words, energetic but classy.
Player: ${player.name} (${player.position})
Sold to: ${team.name}
Price: ${soldPrice}L (base ${player.basePrice}L)
Player context: ${JSON.stringify(player.stats || {})}
Room context: ${teamStanding}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || '';
  } catch (error) {
    console.error('auction-commentary-failed', error);
    return '';
  }
};

export const generateUnsoldCommentary = async (player: Player): Promise<string> => {
  const ai = getAi();
  if (!ai) return '';

  try {
    const prompt = `You are an IPL auction commentator.
Player ${player.name} (${player.position}) just went unsold.
Write one witty sentence, max 16 words, no hashtags.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || '';
  } catch (error) {
    console.error('unsold-commentary-failed', error);
    return '';
  }
};

export const getPlayerInsights = async (player: Player): Promise<string> => {
  const ai = getAi();
  if (!ai) return 'Gemini API key is not configured on the server.';

  try {
    const prompt = `You are a professional T20 scout.
Summarize ${player.name} for an auction room in 3 short bullet points.
Use available stats first, then broader T20 context if needed.
Known stats: ${JSON.stringify(player.stats || {})}
Known IPL team: ${player.iplTeam || 'Unknown'}
Keep it under 75 words total.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || 'No insight available.';
  } catch (error) {
    console.error('player-insight-failed', error);
    return 'Could not fetch player insight right now.';
  }
};
