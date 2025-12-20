
import { GoogleGenAI } from "@google/genai";
import { Player, Team } from '../types';

let aiClient: GoogleGenAI | null = null;

const getClient = () => {
  if (!aiClient && process.env.API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return aiClient;
};

export const generateAuctionCommentary = async (
  player: Player,
  team: Team,
  soldPrice: number,
  teamsState: Team[]
): Promise<string> => {
  const client = getClient();
  if (!client) return "Gemini API Key not found. Commentary unavailable.";

  try {
    const prompt = `
      You are a hilarious, sarcastic, and high-energy cricket auction commentator (like a mix of Danny Morrison and a stand-up comic).
      
      Event:
      Player: ${player.name} (${player.position})
      Sold To: ${team.name} for ${soldPrice} Lakhs.
      Base Price was: ${player.basePrice}.
      
      Task:
      Write a ONE sentence reaction (max 15 words).
      - Be funny, sarcastic, or use cricket slang.
      - If the price is high, mock the team's spending.
      - If low, call it a robbery.
      - Make it sound like a tweet.
    `;

    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Cha-ching! Money flows like water!";
  } catch (error) {
    console.error("Error generating commentary:", error);
    return "Sold! The hammer has spoken!";
  }
};

export const generateUnsoldCommentary = async (player: Player): Promise<string> => {
    const client = getClient();
    if (!client) return "";
  
    try {
      const prompt = `
        You are a savage cricket commentator.
        Player ${player.name} just went UNSOLD.
        
        Task:
        Give a savage, funny, or sad 1-sentence roast (max 15 words) about nobody wanting them. 
        Maybe mention they should stick to Instagram reels or test cricket.
      `;
  
      const response = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
  
      return response.text || "Cricket? Maybe try Ludo instead.";
    } catch (error) {
      return "Crickets... literally. No bids.";
    }
  };

export const getPlayerInsights = async (player: Player): Promise<string> => {
  const client = getClient();
  if (!client) return "AI insights unavailable.";

  try {
    const prompt = `
      Provide a concise summary (max 30 words) of the recent T20 form and key achievements for cricket player: ${player.name} (${player.country}).
      Focus on recent IPL performance or T20 Internationals. Be data-driven but brief.
    `;
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Data unavailable.";
  } catch (error) {
    console.error("Error fetching insights:", error);
    return "Could not fetch insights.";
  }
};
