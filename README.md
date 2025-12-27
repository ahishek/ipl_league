
# 🏏 IPL Mock Auctioneer

A real-time, multiplayer cricket auction simulation platform powered by React, PeerJS, and Google Gemini AI.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-19-blue)
![Gemini AI](https://img.shields.io/badge/AI-Powered-purple)

## 🌟 Overview

IPL Mock Auctioneer allows groups of friends or cricket enthusiasts to conduct their own fantasy player auctions. Unlike static tools, this application creates a live, synchronized room where a host controls the flow of players, and team owners place bids in real-time.

The experience is enhanced by **Google Gemini AI**, which acts as a virtual branding agency (generating team logos), a scout (providing player stats), and a color commentator (reacting to sold/unsold players with the personality of legends like Ravi Shastri or Richie Benaud).

## ✨ Key Features

### 🏢 Auction Hall (Lobby & Game)
*   **Real-time Synchronization:** Built on PeerJS (WebRTC) for low-latency state syncing between host and participants without a dedicated backend.
*   **Host Controls:** The host manages the timer, introduces players, and finalizes sales.
*   **Bidding System:** Live budget tracking, roster limits (max 15 players), and incremental bidding logic.
*   **Dynamic States:** Handles "Sold", "Unsold", and "Pause" states seamlessly.

### 🤖 AI Integration (Google Gemini)
*   **Live Commentary:** Generates witty, context-aware commentary based on the player's price and the buying team's status.
*   **Scout Insights:** Provides key T20 stats and analysis for the player currently on the block.
*   **Brand Generation:** Auto-generates professional vector-style logos for user-created teams based on their name and color.

### 👥 Team & Player Management
*   **Roster Management:** Visualizes squad composition (Batters, Bowlers, ARs, WKs) and remaining purse.
*   **CSV Import:** Hosts can import custom player lists via Google Sheets or CSV.
*   **Archives:** Persists auction history to LocalStorage, allowing users to review past auction results and full squads.

### 🎨 UI/UX
*   **Glassmorphism Design:** A modern, dark-themed UI with blurs and gradients.
*   **Responsive:** Works on desktop and tablets.
*   **Audio/Visual Cues:** Animations for bids and sales.

## 🛠️ Tech Stack

*   **Frontend:** React 19, TypeScript
*   **Styling:** Tailwind CSS, Lucide React (Icons)
*   **Networking:** PeerJS (P2P Data Connections)
*   **AI:** Google GenAI SDK (`@google/genai`)
*   **Build Tool:** Vite

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   A Google Cloud Project with the **Gemini API** enabled.

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/ipl-mock-auctioneer.git
    cd ipl-mock-auctioneer
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory and add your Google Gemini API Key:
    ```env
    VITE_GEMINI_API_KEY=your_actual_api_key_here
    ```

4.  **Run Locally**
    ```bash
    npm run dev
    ```

## 📖 How to Use

1.  **Login:** Enter your name to create a user profile.
2.  **Dashboard:**
    *   **Host:** Click "Host Room", enter a session name, and share the **Invite Code**.
    *   **Join:** Enter an Invite Code to join an existing lobby.
3.  **Lobby:**
    *   Create your Franchise (Team Name + Color).
    *   Use the "Generate Logos" button to let AI create your badge.
    *   Wait for the Host to start the game.
4.  **The Auction:**
    *   **Host:** Controls the flow (Next Player, Sold, Unsold).
    *   **Bidders:** Click bid buttons to place offers. Watch your budget!
5.  **Archives:** After the auction ends, view the full summary and squads in the Archive tab.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License

Distributed under the MIT License.
