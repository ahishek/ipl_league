import { GoogleGenAI } from "@google/genai";
import { Player, Team } from '../types';

/**
 * Generates a team logo using Gemini 2.5 Flash Image.
 * Compliant with Google GenAI SDK guidelines.
 */
export const generateTeamLogo = async (teamName: string, colorHex: string): Promise<string> => {
  // Create a new instance right before use to ensure the most up-to-date API key is used
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const prompt = `A professional, iconic sports franchise logo for a team named "${teamName}". 
    The logo should feature a powerful and modern mascot or symbol (e.g., a predator, a warrior, or a dynamic abstract shape) that represents the team's name. 
    Use a professional color palette emphasizing the color ${colorHex}. 
    Style: Minimalist vector, flat design, sharp clean lines, high contrast, suitable for professional sports leagues like IPL, NBA, or MLS. 
    Centered on a solid black background. No text inside the logo, focus purely on the icon/mascot.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
    });

    if (!response.candidates?.[0]?.content?.parts) return "";

    // Iterate through all parts to find the image part as per guidelines
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return "";
  } catch (error) {
    console.error("Error generating team logo:", error);
    return "";
  }
};

/**
 * Generates dramatic auction commentary for a sold player using Gemini 3 Flash.
 */
export const generateAuctionCommentary = async (
  player: Player,
  team: Team,
  soldPrice: number,
  teamsState: Team[]
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const isSteal = soldPrice <= player.basePrice * 1.2;
    const isExpensive = soldPrice >= player.basePrice * 4;
    const isMadness = soldPrice >= player.basePrice * 8;

    const prompt = `
      You are a legendary cricket auction commentator. You must react to a successful sale with high drama, wit, and personality.
      Channel these icons:
      - Richie Benaud (Dry, sophisticated, "Marvelous effort!")
      - Ravi Shastri (Booming energy, "Like a tracer bullet!", "Big Boy!", "Absolute scenes!")
      - Harsha Bhogle (Poetic, strategic, storytelling)
      - Kerry O'Keeffe (Eccentric humor, witty jabs, quirky metaphors)
      
      Event Details:
      - Player: ${player.name} (${player.position})
      - Sold To Team: ${team.name} (Owner: ${team.ownerName})
      - Hammer Price: ${soldPrice} Lakhs (Base: ${player.basePrice})
      - Market Context: ${isSteal ? 'A absolute bargain/steal.' : isMadness ? 'Financial madness/massive overpay.' : isExpensive ? 'A huge investment.' : 'Fair market value.'}
      - Team Purse Status: ${team.budget} Lakhs remaining.

      Your Persona Instructions:
      1. Choose ONE of the personas above (or a blend).
      2. If it was a 'Steal', praise ${team.ownerName}'s strategic genius and timing.
      3. If it was 'Madness', take a witty, sharp jab at ${team.ownerName} for breaking the bank and potentially ruining their remaining auction.
      4. Add high-octane sports drama ("The room is in shock!", "A masterstroke that leaves the competition reeling!").
      5. Keep it to ONE punchy, creative sentence (max 25 words).
      
      Example: "Shastri: Absolute scenes! ${team.ownerName} has gone for the jugular and emptied the vault for this big boy!"
      Example: "O'Keeffe: ${team.ownerName} just got him for peanuts! The other owners must be hibernating in the back room!"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    // Access the .text property directly (not a method call) as per SDK rules
    return response.text?.trim() || "Sold! A massive addition to the roster!";
  } catch (error) {
    console.error("Error generating commentary:", error);
    return "The hammer falls! A significant acquisition for the franchise.";
  }
};

/**
 * Generates commentary for an unsold player using Gemini 3 Flash.
 */
export const generateUnsoldCommentary = async (player: Player): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
    try {
      const prompt = `
        You are a cricket commentator. A player just went UNSOLD. Channel Ravi Shastri or Kerry O'Keeffe or Harsha Bhogle.
        Player: ${player.name} (${player.position})
        
        Task:
        Provide a 1-sentence funny, witty or slightly tragic observation (max 15 words).
        - If the player is a star, act shocked.
        - If they are unknown, be dry.
        - Use "Marvelous" or a quirky Kerry O'Keeffe metaphor like "Nobody wants the last biscuit on the plate!"
      `;
  
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
  
      return response.text?.trim() || "Silence in the auditorium. The hammer falls on a lonely note.";
    } catch (error) {
      console.error("Error generating unsold commentary:", error);
      return "No takers. The auction moves on.";
    }
  };

/**
 * Provides analytical insights for a player using Gemini 3 Flash.
 */
export const getPlayerInsights = async (player: Player): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const prompt = `
      Analyze ${player.name} (${player.position}) for a T20 auction.
      Return the response as 2-3 short bullet points (using a dash '-').
      1. Recent T20 Form in 2025 and 2024.
      2. One "Key Stat" or Strength.
      Keep it punchy, analytical, and professional. Max 40 words total.
    `;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Access response.text directly (property access)
    return response.text?.trim() || "Data unavailable.";
  } catch (error) {
    console.error("Error fetching insights:", error);
    return "Could not fetch insights.";
  }
};