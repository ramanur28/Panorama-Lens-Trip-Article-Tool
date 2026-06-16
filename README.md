# ArticleForge AI

A powerful, full-stack application that leverages the **Gemini API** to generate comprehensive, SEO-optimized, 2000+ word articles with customizable tone, style, expert quotations, and more. It can also securely update existing articles or rewrite targeted sections.

## 🚀 Features
- **Intelligent Long-Form Generation**: Automatically creates a structured outline, then incrementally writes introductions, sections, and conclusions to guarantee length and depth.
- **Section Updater (Rewriter)**: Feed it an existing article and have the AI seamlessly rewrite or add a specific section (e.g., adding a "Hidden Gem" section to a travel guide).
- **SEO Metadata**: Automatically generates a highly optimized Meta Title, Description, URL Slug, Tags, and Excerpt.
- **Expert Quotations**: Easily weave expert quotes and references dynamically into the output.
- **Local Network Support**: Run it on your PC and access it via your phone or tablet on the same Wi-Fi network.
- **Dark/Light Themes**: A beautifully crafted, responsive UI that supports native theme toggling.
- **Persistent Settings**: Remembers your Gemini API Key, Target Audience, Brand, and Custom Prompts directly in your browser.

---

## 🛠 Prerequisites

Make sure you have the following installed on your machine:
1. **Node.js** (v18 or newer recommended)
2. **npm** (comes with Node.js)
3. **A Gemini API Key** (Get one for free at [Google AI Studio](https://aistudio.google.com/apikey))

---

## 💻 How to Run (Development Mode)

This mode runs the application using Vite's fast hot-module reloading and concurrently boots up the Express backend.

1. **Install Dependencies**
   Open your terminal in the project folder and run:
   ```bash
   npm install
   ```

2. **Start the Development Server**
   ```bash
   npm run dev
   ```

3. **Access the App**
   - **On your current device**: Open your browser and go to `http://localhost:3000`.
   - **From another device (e.g., your phone)**: Find your computer's local IP address (e.g., `192.168.1.15`) and visit `http://<YOUR-IP>:3000`. Ensure both devices are connected to the same Wi-Fi network.

*(Note: The first time you open the app, click the Settings button or wait a few seconds for the prompt to enter your Gemini API Key).*

---

## 📦 How to Build (Production)

If you want to bundle the frontend into static files (HTML, CSS, JS) that are highly optimized and minified, you can build the project.

1. **Run the Build Command**
   ```bash
   npm run build
   ```
   This will compile the Vite frontend into a `dist/` directory.

2. **Test the Production Build**
   After building, you can serve both the Express backend and the bundled frontend simultaneously by simply starting the server:
   ```bash
   npm start
   ```
   The backend will now serve your static UI out of the `dist/` folder at `http://localhost:3001` (or whichever port is assigned).

---

## 🌐 How to Publish / Deploy

Because this application contains both a Frontend (Vite) and a Backend API (Express), it is best deployed as a single Node.js service. The backend server acts as a proxy to safely communicate with the Gemini API without exposing your network requests.

### Deploying to Render, Heroku, or DigitalOcean App Platform

1. Commit your project to a GitHub repository.
2. Connect the repository to your hosting provider (e.g., Render Web Service).
3. **Build Command**: Set the build command to:
   ```bash
   npm install && npm run build
   ```
4. **Start Command**: Set the start command to:
   ```bash
   npm start
   ```
5. **Environment Variables**:
   You do not strictly need to add the `PORT` environment variable as platforms usually inject this automatically, and `server.js` listens to `process.env.PORT`.

Once deployed, the Node backend will serve your freshly built `dist/` folder to visitors while keeping your Express API routes (`/api/generate`) securely running on the same domain.
