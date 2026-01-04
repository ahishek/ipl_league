
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

## 📡 Architecture: PeerJS & Real-time Sync

This project leverages **PeerJS** to establish a serverless, Peer-to-Peer (P2P) architecture. Here is how we maintain real-time synchronization across devices without a traditional backend database:

### 1. Host Authority Pattern
Instead of a central server, the user who clicks **"Host Room"** becomes the authoritative server for that session.
*   The Host's browser holds the "Source of Truth" (`currentRoom` state).
*   The Host generates a unique Room ID (e.g., `6X9P2Q`).
*   Technically, this ID is used to create a PeerJS ID (e.g., `ipl-auction-v6-6X9P2Q`).

### 2. Connection Handshake
*   **Participants** (Clients) use the Room ID to initiate a WebRTC `DataConnection` to the Host via PeerJS.
*   We utilize **Google's Public STUN servers** (`stun.l.google.com:19302`) to navigate NATs and Firewalls. This ensures users on mobile networks (4G/5G) can successfully connect with users on WiFi.

### 3. The Sync Loop (Redux-over-P2P)
We implement a unidirectional data flow similar to Redux, but over the network:
1.  **Action:** A client performs an action (e.g., `BID 200L`).
2.  **Dispatch:** The client does *not* update their local state immediately. Instead, they send a JSON `Action` object to the Host.
3.  **Process:** The Host receives the action, runs it through a central reducer (handling logic, validation, and timers), and updates the canonical state.
4.  **Broadcast:** The Host broadcasts the entire updated `Room` state object back to **ALL** connected clients via a `SYNC` event.
5.  **Render:** Clients receive the `SYNC` payload and replace their local state, ensuring everyone sees the exact same data.

### 4. Reliability
*   **Heartbeats & Config:** connections are configured with `reliable: true` (SCTP) to ensure packet delivery.
*   **Reconnection:** If a client drops, the state remains safe with the Host. When the client reconnects, they immediately receive the latest `SYNC` snapshot.

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
