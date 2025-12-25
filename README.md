# Creative Canvas

Creative Canvas is an AI-powered drawing application that allows users to doodle, analyze their drawings with Gemini, and generate high-quality images and videos using Google's Vertex AI (Gemini and Veo models).

## Features

*   **Interactive Drawing Board**: A feature-rich canvas for freehand drawing.
*   **AI Understanding**: analyze your drawing's intent and style using **Gemini**.
*   **Image Generation**: Turn your sketches into polished artwork using **Gemini 3 Pro / 2.5 Flash**.
*   **Video Generation**: Animate your creations using **Veo 3.1**.
*   **Multi-Style Support**: Choose from various artistic styles or let the AI decide.
*   **Creation Gallery**: Save and view your past creations.
*   **Model Selection**: Switch between different AI models for image and video generation.

## Prerequisites

*   **Node.js**: v18 or higher.
*   **Google Cloud Project**:
    *   Vertex AI API enabled.
    *   Firestore enabled (Native mode).
    *   Cloud Storage bucket created.
    *   Identity-Aware Proxy (IAP) configured (strongly recommended for user authentication).

## Installation

1.  Clone the repository and navigate to the `backend` directory:
    ```bash
    cd backend
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

## Configuration

Set the following environment variables. You can export them in your shell or use a `.env` file (if you add `dotenv` support, otherwise set them in your run command).

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GOOGLE_CLOUD_PROJECT` | Your Google Cloud Project ID | `hxhdemo` |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI Region (e.g., `us-central1`) | `global` |
| `PORT` | Server port | `3000` |

**Note on Authentication:**
The backend expects Google IAP headers (`x-goog-authenticated-user-id`, `x-goog-authenticated-user-email`) for endpoints like `/api/generate` and `/api/save-creation`. If running locally without IAP, you may need to modify `server.js` or use a proxy to inject these headers for testing.

## Running on Server

1.  Navigate to the `backend` directory:
    ```bash
    cd backend
    ```

2.  Start the server:
    ```bash
    npm start
    ```
    Or directly with node:
    ```bash
    node server.js
    ```

3.  The application will be served at `http://localhost:3000` (serving the `frontend` directory).

## Project Structure

*   **/backend**: Node.js Express server, handles API calls to Vertex AI, Firestore, and Storage.
*   **/frontend**: Static HTML/CSS/JS frontend files.
