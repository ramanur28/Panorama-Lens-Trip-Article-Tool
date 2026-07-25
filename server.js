import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Define settings path
const SETTINGS_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'admin_settings.json');
const QUEUE_FILE = path.join(SETTINGS_DIR, 'articles.json');
const MANAGER_FILE = path.join(SETTINGS_DIR, 'article_manager.json');

// Session token for admin
let adminSessionToken = null;

// Sync state
let isSyncing = false;
let lastSyncTime = 0;

// Helper to generate content from either Gemini or OpenAI
async function generateContent({ model, prompt, apiKey, openaiApiKey, image }) {
  const isOpenAI = model.startsWith('gpt-');
  
  if (isOpenAI) {
    const key = openaiApiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OpenAI API Key is required for this model.');
    }
    
    let content;
    if (image) {
      content = [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`
          }
        }
      ];
    } else {
      content = prompt;
    }
    
    const messages = [
      { role: 'user', content }
    ];
    
    const reqBody = {
      model,
      messages
    };
    
    // Omit temperature for reasoning (o1/o3), gpt-5, or luna models to avoid API errors
    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.includes('luna') || model.startsWith('gpt-5');
    if (!isReasoningModel) {
      reqBody.temperature = 0.7;
    }
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(reqBody)
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API returned HTTP ${res.status}`);
    }
    
    const data = await res.json();
    return {
      text: data.choices[0].message.content,
      usageMetadata: {
        promptTokenCount: data.usage?.prompt_tokens || 0,
        candidatesTokenCount: data.usage?.completion_tokens || 0,
        totalTokenCount: data.usage?.total_tokens || 0
      }
    };
  } else {
    // Gemini API
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('Gemini API Key is required.');
    }
    const ai = new GoogleGenAI({ apiKey: key });
    
    let contents;
    if (image) {
      contents = [
        {
          inlineData: {
            data: image.data,
            mimeType: image.mimeType
          }
        },
        prompt
      ];
    } else {
      contents = prompt;
    }
    
    const response = await ai.models.generateContent({
      model,
      contents,
      config: { temperature: 0.7 }
    });
    
    return {
      text: response.text,
      usageMetadata: {
        promptTokenCount: response.usageMetadata?.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata?.totalTokenCount || 0
      }
    };
  }
}

// Helper to read admin settings
function getAdminSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
      if (!settings.ctaLink) {
        settings.ctaLink = 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21';
      }
      return settings;
    }
  } catch (e) {
    console.error('Failed to read admin settings:', e);
  }
  return {
    tone: 'Professional',
    customPrompt: '',
    targetAudience: '',
    brand: '',
    wordCountMode: 'total',
    wordCountDivisor: 10,
    targetWordCount: 3000,
    targetLanguage: 'English',
    ctaLink: 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21'
  };
}

// Helper to save admin settings
function saveAdminSettings(settings) {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save admin settings:', e);
    return false;
  }
}

// Helper to read queue items
function getQueueItems() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to read queue items:', e);
  }
  return [];
}

// Helper to save queue items
function saveQueueItems(items) {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save queue items:', e);
    return false;
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Middleware to strip subpath prefix for reverse proxy / https://ramadhani.cloud/Panorama-Lens-Trip-Article-Tool/
app.use((req, res, next) => {
  if (req.url.startsWith('/Panorama-Lens-Trip-Article-Tool')) {
    req.url = req.url.replace('/Panorama-Lens-Trip-Article-Tool', '') || '/';
  }
  next();
});

// Serve built frontend files in production with no-cache for index.html
app.use(express.static('dist', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/uploads', express.static(path.join(SETTINGS_DIR, 'uploads')));

// Image Upload Endpoint (handles both /api/upload and /api/upload-image)
app.post(['/api/upload', '/api/upload-image'], (req, res) => {
  const imageBase64 = req.body.imageBase64 || req.body.base64;
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image data provided' });
  }
  
  // Parse base64
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid base64 image data' });
  }
  
  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split('/')[1] || 'png';
  
  const uploadsDir = path.join(SETTINGS_DIR, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  
  try {
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    res.json({ url: `uploads/${fileName}` });
  } catch (err) {
    console.error('Failed to save uploaded image:', err);
    res.status(500).json({ error: 'Failed to save image on server' });
  }
});

// ── Admin Endpoints ───────────────────────────────────────────────
app.get(['/api/settings', '/api/admin/settings'], (req, res) => {
  res.json(getAdminSettings());
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password === correctPassword) {
    adminSessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
    return res.json({ token: adminSessionToken });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/admin/logout', (req, res) => {
  adminSessionToken = null;
  res.json({ success: true });
});

app.get('/api/admin/check-session', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token && token === adminSessionToken) {
    return res.json({ loggedIn: true });
  }
  res.json({ loggedIn: false });
});

app.post('/api/admin/test-wp-connection', async (req, res) => {
  const { wpUrl, wpUsername, wpAppPassword } = req.body;
  const result = await verifyWordPressConfig(wpUrl, wpUsername, wpAppPassword);
  return res.json(result);
});

app.post('/api/articles/sync-wp', async (req, res) => {
  try {
    const adminSettings = getAdminSettings();
    const wpUsername = adminSettings.wpUsername || process.env.WP_USERNAME;
    const wpAppPassword = adminSettings.wpAppPassword || process.env.WP_APPLICATION_PASSWORD;
    const wpUrl = adminSettings.wpUrl || process.env.WP_URL || 'https://panoramalenstrip.com';

    const connCheck = await verifyWordPressConfig(wpUrl, wpUsername, wpAppPassword);
    const result = await syncWordPressArticles();

    return res.json({
      success: true,
      updatedCount: result.updatedCount,
      addedCount: result.addedCount,
      total: result.total,
      wpAuth: connCheck.authenticated,
      wpError: connCheck.error || null,
      message: `WordPress sync complete! Updated ${result.updatedCount} items, added ${result.addedCount} new items.`
    });
  } catch (err) {
    console.error('WordPress Sync Endpoint Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token || token !== adminSessionToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { 
    tone, customPrompt, targetAudience, brand, targetWordCount, 
    wordCountMode, wordCountDivisor, targetLanguage, ctaLink,
    wpUrl, wpUsername, wpAppPassword, testConnection 
  } = req.body;

  const currentSettings = getAdminSettings();
  const mode = wordCountMode || currentSettings.wordCountMode || 'total';
  const divisor = Math.min(50, Math.max(2, parseInt(wordCountDivisor) || currentSettings.wordCountDivisor || 10));
  let wordCount = parseInt(targetWordCount) || currentSettings.targetWordCount || 3000;

  const updated = {
    ...currentSettings,
    tone: tone || currentSettings.tone || 'Professional',
    customPrompt: customPrompt !== undefined ? customPrompt : (currentSettings.customPrompt || ''),
    targetAudience: targetAudience !== undefined ? targetAudience : (currentSettings.targetAudience || ''),
    brand: brand !== undefined ? brand : (currentSettings.brand || ''),
    wordCountMode: mode,
    wordCountDivisor: divisor,
    targetWordCount: wordCount,
    targetLanguage: targetLanguage || currentSettings.targetLanguage || 'English',
    ctaLink: ctaLink !== undefined ? ctaLink : (currentSettings.ctaLink || ''),
    wpUrl: wpUrl !== undefined ? wpUrl : (currentSettings.wpUrl || ''),
    wpUsername: wpUsername !== undefined ? wpUsername : (currentSettings.wpUsername || ''),
    wpAppPassword: wpAppPassword !== undefined ? wpAppPassword : (currentSettings.wpAppPassword || '')
  };
  
  let connTestResult = null;
  if (testConnection || updated.wpUrl || updated.wpUsername) {
    connTestResult = await verifyWordPressConfig(updated.wpUrl, updated.wpUsername, updated.wpAppPassword);
  }

  if (saveAdminSettings(updated)) {
    res.json({ success: true, settings: updated, wpVerification: connTestResult });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Helper to deduplicate article manager items
function deduplicateManagerItems(items) {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set();
  const seenWpIds = new Set();
  const seenLinks = new Set();
  const seenTitleKp = new Set();

  const result = [];
  for (const item of items) {
    if (!item) continue;

    if (item.id && seenIds.has(item.id)) continue;
    if (item.wpPostId && seenWpIds.has(String(item.wpPostId))) continue;

    const cleanLink = item.link ? item.link.trim().toLowerCase().replace(/\/$/, '') : '';
    if (cleanLink && seenLinks.has(cleanLink)) continue;

    const titleNorm = (item.title || '').trim().toLowerCase();
    const kpNorm = (item.keyphrase || '').trim().toLowerCase();
    const tkKey = `${titleNorm}|||${kpNorm}`;
    if (titleNorm && seenTitleKp.has(tkKey)) continue;

    if (item.id) seenIds.add(item.id);
    if (item.wpPostId) seenWpIds.add(String(item.wpPostId));
    if (cleanLink) seenLinks.add(cleanLink);
    if (titleNorm) seenTitleKp.add(tkKey);

    result.push(item);
  }
  return result;
}

// Helper to read article manager items
function getManagerItems() {
  try {
    if (fs.existsSync(MANAGER_FILE)) {
      const data = fs.readFileSync(MANAGER_FILE, 'utf8');
      const rawItems = JSON.parse(data);
      const items = deduplicateManagerItems(rawItems);
      let changed = (items.length !== rawItems.length);
      items.forEach(item => {
        if (item.article && item.article.includes('## ##')) {
          item.article = item.article.replace(/##\s*##\s*/g, '## ');
          changed = true;
        }
      });
      if (changed) {
        fs.writeFileSync(MANAGER_FILE, JSON.stringify(items, null, 2), 'utf8');
      }
      return items;
    }
  } catch (e) {
    console.error('Failed to read manager items:', e);
  }
  return [];
}

// Helper to save article manager items
function saveManagerItems(items) {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    const cleanItems = deduplicateManagerItems(items);
    fs.writeFileSync(MANAGER_FILE, JSON.stringify(cleanItems, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save manager items:', e);
    return false;
  }
}

// CSV Line Parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Title normalizer for matching
function normalizeTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Link normalizer for matching
function normalizeLink(url) {
  if (!url) return '';
  return url.toLowerCase().replace(/https?:\/\/(www\.)?/, '').replace(/\/$/, '').trim();
}

// Verification helper to check WordPress REST API connectivity & auth
async function verifyWordPressConfig(url, username, password) {
  const adminSettings = getAdminSettings();
  const rawUrl = url !== undefined ? url : (adminSettings.wpUrl || process.env.WP_URL || 'https://panoramalenstrip.com');
  const wpBaseUrl = (rawUrl || 'https://panoramalenstrip.com').replace(/\/$/, '');
  const cleanUser = (username !== undefined ? username : (adminSettings.wpUsername || process.env.WP_USERNAME || '')).trim();
  const rawPass = password !== undefined ? password : (adminSettings.wpAppPassword || process.env.WP_APPLICATION_PASSWORD || '');
  const cleanPass = (rawPass || '').replace(/\s+/g, '');

  if (!wpBaseUrl) {
    return { success: false, error: 'WordPress Site URL is required.' };
  }

  const headers = { 'User-Agent': 'Panorama-Lens-Trip-Article-Tool/1.0' };
  let isAuthenticated = false;

  if (cleanUser && cleanPass) {
    const credentials = Buffer.from(`${cleanUser}:${cleanPass}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    isAuthenticated = true;
  }

  try {
    if (isAuthenticated) {
      const meRes = await fetch(`${wpBaseUrl}/wp-json/wp/v2/users/me`, { headers });
      if (meRes.ok) {
        const userData = await meRes.json();
        return {
          success: true,
          authenticated: true,
          user: userData.name || userData.slug || cleanUser,
          message: `Successfully connected & authenticated with WordPress as "${userData.name || cleanUser}"!`
        };
      } else if (meRes.status === 401 || meRes.status === 403) {
        return {
          success: false,
          authenticated: false,
          error: `WordPress Authentication Failed (HTTP ${meRes.status}). Please check your WP Username and Application Password.`
        };
      }
    }

    // Fallback public check
    const testRes = await fetch(`${wpBaseUrl}/wp-json/wp/v2/posts?per_page=1`, { headers });
    if (testRes.ok) {
      if (isAuthenticated) {
        return {
          success: false,
          authenticated: false,
          error: `Connected to site ${wpBaseUrl}, but WordPress Authentication failed. Please verify your Application Password.`
        };
      }
      return {
        success: true,
        authenticated: false,
        message: `Connected to WordPress REST API at ${wpBaseUrl} (Public access only).`
      };
    } else {
      return {
        success: false,
        error: `Could not connect to WordPress REST API at ${wpBaseUrl} (HTTP ${testRes.status}).`
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Network error connecting to ${wpBaseUrl}: ${err.message}`
    };
  }
}

// Fetch all posts from WordPress REST API
async function fetchAllWordPressPosts() {
  let posts = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;
  
  const adminSettings = getAdminSettings();
  const wpBaseUrl = (adminSettings.wpUrl || process.env.WP_URL || process.env.WORDPRESS_URL || 'https://panoramalenstrip.com').replace(/\/$/, '');
  const wpUsername = (adminSettings.wpUsername || process.env.WP_USERNAME || process.env.WORDPRESS_USERNAME || '').trim();
  const rawPass = adminSettings.wpAppPassword || process.env.WP_APPLICATION_PASSWORD || process.env.WORDPRESS_APPLICATION_PASSWORD || '';
  const wpAppPassword = rawPass.replace(/\s+/g, '');
  
  const headers = { 'User-Agent': 'Panorama-Lens-Trip-Article-Tool/1.0' };
  let statusParam = 'publish';
  
  if (wpUsername && wpAppPassword) {
    const credentials = Buffer.from(`${wpUsername}:${wpAppPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    // Fetch draft and scheduled (future) posts as well when authenticated
    statusParam = 'publish,future,draft';
  } else {
    console.log('WordPress credentials not provided. Fetching public published posts only.');
  }
  
  while (hasMore && page <= 10) {
    try {
      const url = `${wpBaseUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&status=${statusParam}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          if (statusParam !== 'publish') {
            console.warn('WordPress authentication failed during posts fetch. Falling back to public published posts only.');
            statusParam = 'publish';
            delete headers['Authorization'];
            continue; // Retry page with public access
          }
        }
        hasMore = false;
        break;
      }
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        posts = posts.concat(data);
        if (data.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    } catch (e) {
      console.error('Error fetching WP posts page:', page, e);
      hasMore = false;
    }
  }
  return posts;
}

function decodeWpHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

// Sync function (fetches published, future/scheduled, and draft posts from WordPress and updates, imports, or purges deleted articles)
async function syncWordPressArticles() {
  const wpPosts = await fetchAllWordPressPosts();
  const articles = getManagerItems();
  let updatedCount = 0;
  let addedCount = 0;
  let purgedCount = 0;
  
  const matchedWpIds = new Set();
  const todayStr = new Date().toISOString().split('T')[0];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    
    // Find matching post in WP posts
    const match = wpPosts.find(p => {
      if (article.wpPostId && String(p.id) === String(article.wpPostId)) return true;
      const rawTitle = p.title?.rendered || '';
      const decodedWpTitle = decodeWpHtmlEntities(rawTitle);
      const wpTitleNorm = normalizeTitle(decodedWpTitle);
      const artTitleNorm = normalizeTitle(article.title);
      const artKeyphraseNorm = normalizeTitle(article.keyphrase);
      
      // Match link if article already has a proposed link
      if (article.link && normalizeLink(p.link) === normalizeLink(article.link)) {
        return true;
      }
      
      // Match title or keyphrase
      if (wpTitleNorm && (wpTitleNorm === artTitleNorm || wpTitleNorm === artKeyphraseNorm)) {
        return true;
      }
      
      return false;
    });
    
    if (match) {
      matchedWpIds.add(match.id);
      article.wpPostId = match.id;
      let targetStatus = 'telah_dibuat';
      if (match.status === 'future') {
        targetStatus = 'dijadwalkan';
      } else if (match.status === 'draft' || match.status === 'pending') {
        targetStatus = 'draft';
      }
      
      const dateStr = match.date ? match.date.split('T')[0] : null;

      let changed = false;
      if (article.status !== targetStatus) {
        article.status = targetStatus;
        changed = true;
      }
      if (article.link !== match.link) {
        article.link = match.link;
        changed = true;
      }
      if (targetStatus === 'telah_dibuat' && dateStr && article.publishedDate !== dateStr) {
        article.publishedDate = dateStr;
        article.scheduledDate = null;
        changed = true;
      }
      if (targetStatus === 'dijadwalkan' && dateStr && article.scheduledDate !== dateStr) {
        article.scheduledDate = dateStr;
        article.publishedDate = null;
        changed = true;
      }

      if (changed) updatedCount++;
    } else {
      // Post was not found in WordPress posts (e.g. deleted or trashed on WordPress)
      if (wpPosts.length > 0 && (article.status === 'telah_dibuat' || article.status === 'dijadwalkan' || article.wpPostId || (article.link && article.link.includes('panoramalenstrip.com')))) {
        article.status = 'belum_dibuat';
        article.publishedDate = null;
        article.scheduledDate = null;
        article.link = '';
        delete article.wpPostId;
        purgedCount++;
      }
    }

    // Safety check for past scheduled dates
    if (article.status === 'dijadwalkan' && article.scheduledDate) {
      const schDate = article.scheduledDate.split(' ')[0];
      if (schDate < todayStr) {
        article.status = 'belum_dibuat';
        article.scheduledDate = null;
        updatedCount++;
      }
    }
  }

  if (updatedCount > 0 || purgedCount > 0) {
    saveManagerItems(articles);
  }

  // Also sync matching items in queue (data/articles.json)
  const queueItems = getQueueItems();
  let queueChanged = false;
  queueItems.forEach(qItem => {
    const match = wpPosts.find(p => {
      const rawTitle = p.title?.rendered || '';
      const decodedWpTitle = decodeWpHtmlEntities(rawTitle);
      const wpTitleNorm = normalizeTitle(decodedWpTitle);
      const qTitleNorm = normalizeTitle(qItem.title);
      const qKpNorm = normalizeTitle(qItem.keyphrase);
      if (qItem.link && normalizeLink(p.link) === normalizeLink(qItem.link)) return true;
      if (wpTitleNorm && (wpTitleNorm === qTitleNorm || wpTitleNorm === qKpNorm)) return true;
      return false;
    });

    if (match) {
      const dateStr = match.date ? match.date.split('T')[0] : null;
      if (match.status === 'future') {
        qItem.status = 'dijadwalkan';
        qItem.scheduledDate = dateStr;
        delete qItem.publishedDate;
        queueChanged = true;
      } else if (match.status === 'publish') {
        qItem.status = 'complete';
        qItem.publishedDate = dateStr;
        delete qItem.scheduledDate;
        queueChanged = true;
      }
      if (match.link && qItem.link !== match.link) {
        qItem.link = match.link;
        queueChanged = true;
      }
    } else {
      // If queue item was scheduled or linked to WP but post was deleted on WP
      if (qItem.status === 'dijadwalkan' || (qItem.link && qItem.link.includes('panoramalenstrip.com'))) {
        if (qItem.article) qItem.status = 'complete';
        else qItem.status = 'pending';
        delete qItem.scheduledDate;
        delete qItem.publishedDate;
        qItem.link = '';
        queueChanged = true;
      }
    }

    // Safety check for past scheduled dates on queue items
    if (qItem.status === 'dijadwalkan' && qItem.scheduledDate) {
      const schDate = qItem.scheduledDate.split(' ')[0];
      if (schDate < todayStr) {
        qItem.status = qItem.article ? 'complete' : 'pending';
        delete qItem.scheduledDate;
        queueChanged = true;
      }
    }
  });

  if (queueChanged) {
    saveQueueItems(queueItems);
  }
  
  return { updatedCount, addedCount, purgedCount, total: articles.length };
}

// Helper to check if request is admin authorized
function checkAdminAuth(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  return token && token === adminSessionToken;
}

// ── Article Manager Endpoints ─────────────────────────────────────
// Get all articles (with background auto-sync check)
app.get('/api/articles', async (req, res) => {
  const items = getManagerItems();
  
  const now = Date.now();
  if (!isSyncing && (now - lastSyncTime > 1000 * 60 * 10)) { // 10 minutes auto-sync check
    isSyncing = true;
    lastSyncTime = now;
    syncWordPressArticles()
      .then(count => {
        if (count > 0) console.log(`Auto-sync complete: updated ${count} articles.`);
      })
      .catch(err => {
        console.error('Auto-sync failed:', err);
      })
      .finally(() => {
        isSyncing = false;
      });
  }
  
  res.json(items);
});

// Add or update an article
app.post('/api/articles', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const item = req.body;
  if (!item) {
    return res.status(400).json({ error: 'Invalid article data' });
  }
  
  const items = getManagerItems();
  
  if (item.id) {
    // Edit existing
    const index = items.findIndex(i => i.id === parseInt(item.id));
    if (index !== -1) {
      items[index] = {
        ...items[index],
        pageRole: item.pageRole !== undefined ? item.pageRole : items[index].pageRole,
        keyphrase: item.keyphrase !== undefined ? item.keyphrase : items[index].keyphrase,
        title: item.title !== undefined ? item.title : items[index].title,
        topic: item.topic !== undefined ? item.topic : items[index].topic,
        intent: item.intent !== undefined ? item.intent : items[index].intent,
        link: item.link !== undefined ? item.link : items[index].link,
        status: item.status !== undefined ? item.status : items[index].status,
        scheduledDate: item.scheduledDate !== undefined ? item.scheduledDate : items[index].scheduledDate,
        publishedDate: item.publishedDate !== undefined ? item.publishedDate : items[index].publishedDate,
        article: item.article !== undefined ? item.article : items[index].article,
        images: item.images !== undefined ? item.images : items[index].images
      };
      
      if (saveManagerItems(items)) {
        res.json({ success: true, item: items[index] });
      } else {
        res.status(500).json({ error: 'Failed to save updated article' });
      }
    } else {
      res.status(404).json({ error: 'Article not found' });
    }
  } else {
    // Add new
    const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
    const newItem = {
      id: nextId,
      pageRole: item.pageRole || '',
      keyphrase: item.keyphrase || '',
      title: item.title || '',
      topic: item.topic || '',
      intent: item.intent || '',
      link: item.link || '',
      status: item.status || 'belum_dibuat',
      scheduledDate: item.scheduledDate || null,
      publishedDate: item.publishedDate || null,
      article: item.article || '',
      images: item.images || []
    };
    items.push(newItem);
    
    if (saveManagerItems(items)) {
      res.json({ success: true, item: newItem });
    } else {
      res.status(500).json({ error: 'Failed to save new article' });
    }
  }
});

function stripInternalMetadata(md) {
  if (!md) return '';
  let clean = md;

  // 1. Strip top-level SEO Metadata block
  clean = clean.replace(/(?:^|\n)>\s*\*\*SEO Metadata:\*\*[\s\S]*?(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/gi, '');
  clean = clean.replace(/(?:^|\n)#{1,4}\s*SEO Metadata[\s\S]*?(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/gi, '');
  clean = clean.replace(/(?:^|\n)\*\*SEO Metadata:\*\*[\s\S]*?(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/gi, '');

  // 2. Strip Image SEO Metadata section up to divider or main title
  clean = clean.replace(/(?:^|\n)#{1,4}\s*🖼️?\s*Image SEO Metadata[\s\S]*?(?=\n---\s*|\n#\s+[^\n]+|$)/gi, '');

  // 3. Strip standalone Image #N metadata headers & tables if any remain before --- or # Title
  clean = clean.replace(/(?:^|\n)#{2,4}\s*Image\s*#?\d+\s*(?:\(Location:[^\)]*\))?[\s\S]*?(?=\n#{2,4}\s*Image|\n---\s*|\n#\s+[^\n]+|$)/gi, '');

  // 4. Strip leading/trailing divider lines
  clean = clean.replace(/^[\s\-=_]+\n+/g, '');

  let trimmed = clean.trim();

  // Safety fallback: If stripping wiped out the body (leaving less than 100 chars out of a larger document)
  if (md.length > 200 && trimmed.length < 100) {
    console.warn('[stripInternalMetadata] Metadata stripping erased main content; applying line-by-line fallback filter.');
    const lines = md.split('\n');
    const filtered = lines.filter(line => {
      const t = line.trim();
      if (t.startsWith('> - **Meta') || t.startsWith('> - **Focus') || t.startsWith('> - **URL') || t.startsWith('> - **Page Role') || t.startsWith('> - **Categories') || t.startsWith('> - **Tags') || t.startsWith('> - **Excerpt') || t.startsWith('> **SEO Metadata:')) return false;
      if (t.includes('| **File Name** |') || t.includes('| **Alt Text** |') || t.includes('| **Title** |') || t.includes('| **Caption** |') || t.includes('| **Description** |') || t.includes('| Element | Generated SEO Content |') || t.includes('| :--- | :--- |')) return false;
      if (t.startsWith('### 🖼️ Image SEO Metadata') || t.startsWith('### Image SEO Metadata') || /^#{2,4}\s*Image\s*#?\d+/i.test(t)) return false;
      return true;
    });
    trimmed = filtered.join('\n').replace(/^[\s\-=_]+\n+/g, '').trim();
  }

  return trimmed;
}

function inlineMarkdownToHtml(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, title, url) => {
      return `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${title}</a>`;
    });
}

function renderTableBlock(lines) {
  if (lines.length < 2) return lines.join('\n');

  let headerCells = [];
  let bodyRows = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^\|?[\s\-:|]+\|?$/.test(trimmed)) {
      return;
    }

    let cells = trimmed.split('|');
    if (trimmed.startsWith('|')) cells.shift();
    if (trimmed.endsWith('|')) cells.pop();
    cells = cells.map(c => c.trim());

    if (cells.length === 0 || cells.every(c => c === '')) return;

    if (headerCells.length === 0) {
      headerCells = cells;
    } else {
      bodyRows.push(cells);
    }
  });

  if (headerCells.length === 0 && bodyRows.length === 0) return lines.join('\n');

  let html = '<!-- wp:table -->\n<figure class="wp-block-table"><table>';

  if (headerCells.length > 0) {
    html += '<thead><tr>';
    headerCells.forEach(c => {
      html += `<th>${inlineMarkdownToHtml(c)}</th>`;
    });
    html += '</tr></thead>';
  }

  if (bodyRows.length > 0) {
    html += '<tbody>';
    bodyRows.forEach(row => {
      html += '<tr>';
      row.forEach(c => {
        html += `<td>${inlineMarkdownToHtml(c)}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
  }

  html += '</table></figure>\n<!-- /wp:table -->';
  return html;
}

function parseMarkdownTables(text) {
  const lines = text.split('\n');
  const outputLines = [];
  let inTable = false;
  let tableLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const isTableLine = trimmed.includes('|') && /^\|?.*\|?$/.test(trimmed) && trimmed.length > 2;

    if (isTableLine) {
      inTable = true;
      tableLines.push(trimmed);
    } else {
      if (inTable) {
        outputLines.push('\n\n' + renderTableBlock(tableLines) + '\n\n');
        inTable = false;
        tableLines = [];
      }
      outputLines.push(line);
    }
  }

  if (inTable && tableLines.length > 0) {
    outputLines.push('\n\n' + renderTableBlock(tableLines) + '\n\n');
  }

  return outputLines.join('\n');
}

function escapeHtmlAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseImageSeoFromMarkdown(rawMarkdown) {
  if (!rawMarkdown) return {};
  const seoMap = {};
  const match = rawMarkdown.match(/###\s*🖼️?\s*Image SEO Metadata([\s\S]*?)(?=\n---\s*|\n#|\n## [^I]|$)/i);
  if (!match) return seoMap;

  const content = match[1];
  const blocks = content.split(/(?=#{2,4}\s*(?:Featured Image|Feature Image|Image\s*#?\d+))/i);

  for (const block of blocks) {
    const isFeatured = /#{2,4}\s*(?:Featured Image|Feature Image|Image\s*#?0)/i.test(block);
    const headerMatch = block.match(/#{2,4}\s*Image\s*#?(\d+)/i);
    const num = isFeatured ? 'featured' : (headerMatch ? parseInt(headerMatch[1], 10) : null);

    if (num === null) continue;

    const getValue = (label) => {
      const regex = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|]+)\\|`, 'i');
      const m = block.match(regex);
      if (!m) return '';
      return m[1].trim().replace(/^`|`$/g, '').trim();
    };

    seoMap[num] = {
      fileName: getValue('File Name'),
      altText: getValue('Alt Text'),
      title: getValue('Title'),
      caption: getValue('Caption'),
      description: getValue('Description')
    };
  }
  return seoMap;
}

function getMimeType(fileNameOrUrl) {
  const ext = path.extname(fileNameOrUrl || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

async function uploadMediaToWordPress({ wpUrl, credentials, imageBuffer, mimeType, fileName, seoMeta }) {
  const endpoint = `${wpUrl}/wp-json/wp/v2/media`;

  try {
    let cleanFileName = (fileName || 'image.jpg').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (!/\.(jpg|jpeg|png|webp|gif|svg)$/i.test(cleanFileName)) {
      cleanFileName += '.jpg';
    }

    const binaryBody = new Uint8Array(imageBuffer);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': mimeType || 'image/jpeg',
        'Content-Disposition': `attachment; filename="${cleanFileName}"`
      },
      body: binaryBody
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[WordPress API] Media upload error status:', response.status, 'details:', errText);
      return { error: `HTTP ${response.status}: ${errText}` };
    }

    const data = await response.json();
    console.log(`[WordPress API] Image uploaded successfully! Media ID: ${data.id}, URL: ${data.source_url}`);

    // Update media SEO metadata (alt text, title, caption, description)
    if (seoMeta && (seoMeta.altText || seoMeta.title || seoMeta.caption || seoMeta.description)) {
      try {
        await fetch(`${endpoint}/${data.id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            alt_text: seoMeta.altText || '',
            title: seoMeta.title || '',
            caption: seoMeta.caption || '',
            description: seoMeta.description || ''
          })
        });
        console.log(`[WordPress API] Updated SEO metadata for media ID: ${data.id}`);
      } catch (metaErr) {
        console.warn(`[WordPress API] Failed to update SEO metadata for media ID: ${data.id}`, metaErr);
      }
    }

    return {
      id: data.id,
      url: data.source_url,
      altText: seoMeta?.altText || data.alt_text || '',
      title: seoMeta?.title || (typeof data.title === 'string' ? data.title : data.title?.rendered) || '',
      caption: seoMeta?.caption || (typeof data.caption === 'string' ? data.caption : data.caption?.rendered) || '',
      description: seoMeta?.description || (typeof data.description === 'string' ? data.description : data.description?.rendered) || ''
    };
  } catch (err) {
    console.error('[WordPress API] Failed to upload media to WordPress:', err);
    return { error: err.message };
  }
}

function markdownToHtml(rawMarkdown, imageMap = {}, options = {}) {
  if (!rawMarkdown) return '';
  
  // 1. Strip internal app metadata (SEO Metadata & Image SEO Metadata)
  const cleanMarkdown = stripInternalMetadata(rawMarkdown);

  // 2. Parse Markdown tables line-by-line into Gutenberg Table Blocks
  const processedMarkdown = parseMarkdownTables(cleanMarkdown);

  // 3. Process Block-level elements (Headings, Lists, Quotes, Separators, Code, Paragraphs)
  const rawBlocks = processedMarkdown.split(/\n\s*\n/);
  const blocks = [];

  // Separate headings from list items/text if not separated by blank lines
  for (let block of rawBlocks) {
    const lines = block.trim().split('\n');
    if (lines.length > 1 && /^#{1,6}\s+/.test(lines[0])) {
      blocks.push(lines[0].trim());
      blocks.push(lines.slice(1).join('\n').trim());
    } else {
      blocks.push(block.trim());
    }
  }

  const resultBlocks = [];

  for (let block of blocks) {
    let trimmed = block.trim();
    if (!trimmed) continue;

    // Already a WordPress block comment (like wp:table) or HTML figure/table element
    if (trimmed.startsWith('<!-- wp:') || trimmed.startsWith('<figure') || trimmed.startsWith('<table') || trimmed.startsWith('<figure class="wp-block-table">')) {
      resultBlocks.push(trimmed);
      continue;
    }

    // Standalone image placeholders like [IMAGE_1], [IMAGE_2], ![IMAGE_1], ![Alt](IMAGE_1), etc.
    const imgMatch = trimmed.match(/^(?:!\[.*?\]\(?)?\[?IMAGE[_\s#]+(\d+)\]?\)?$/i) ||
                     trimmed.match(/^!\[.*?\]\[IMAGE[_\s#]+(\d+)\]$/i) ||
                     trimmed.match(/^\[IMAGE[_\s#]+(\d+)\]$/i);
    if (imgMatch) {
      const imgNum = parseInt(imgMatch[1], 10);
      if (options.excludeImageId !== undefined && options.excludeImageId !== null &&
          (imgNum === options.excludeImageId || imgNum.toString() === options.excludeImageId.toString())) {
        continue;
      }
      const imgData = imageMap[imgNum] || imageMap[imgNum.toString()];
      if (imgData && imgData.url) {
        const wpAttr = imgData.id ? `{"id":${imgData.id},"sizeSlug":"full","linkDestination":"none"}` : `{"sizeSlug":"full","linkDestination":"none"}`;
        const imgClass = imgData.id ? ` class="wp-image-${imgData.id}"` : '';
        const altText = escapeHtmlAttr(imgData.altText || '');
        const captionHtml = imgData.caption ? `<figcaption>${inlineMarkdownToHtml(imgData.caption)}</figcaption>` : '';
        const imageBlock = `<!-- wp:image ${wpAttr} -->\n<figure class="wp-block-image size-full"><img src="${imgData.url}" alt="${altText}"${imgClass}/>${captionHtml}</figure>\n<!-- /wp:image -->`;
        resultBlocks.push(imageBlock);
      }
      continue;
    }

    // Standard markdown image like ![Alt Text](http://...)
    if (/^!\[([^\]]*)\]\(([^)]+)\)$/.test(trimmed)) {
      const match = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const altText = escapeHtmlAttr(match[1]);
      const imgUrl = match[2];
      const imageBlock = `<!-- wp:image {"sizeSlug":"full","linkDestination":"none"} -->\n<figure class="wp-block-image size-full"><img src="${imgUrl}" alt="${altText}"/></figure>\n<!-- /wp:image -->`;
      resultBlocks.push(imageBlock);
      continue;
    }

    // Separator / Horizontal Rule (---, ***, ___)
    if (/^[\-*_]{3,}$/.test(trimmed)) {
      resultBlocks.push(`<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`);
      continue;
    }

    // Code Blocks (``` lang ... ```)
    if (trimmed.startsWith('```')) {
      const codeContent = trimmed.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
      const escapedCode = codeContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      resultBlocks.push(`<!-- wp:code -->\n<pre class="wp-block-code"><code>${escapedCode}</code></pre>\n<!-- /wp:code -->`);
      continue;
    }

    // Headings (Strictly single-line only)
    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+([^\n]+)$/);
      if (match) {
        const level = match[1].length;
        const text = inlineMarkdownToHtml(match[2].trim());
        resultBlocks.push(`<!-- wp:heading {"level":${level}} -->\n<h${level}>${text}</h${level}>\n<!-- /wp:heading -->`);
        continue;
      }
    }

    // Unordered Lists (- item or * item)
    if (/^(?:[-*]\s+.+\n?)+$/s.test(trimmed)) {
      const items = trimmed.split('\n').map(l => l.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
      const listHtml = `<!-- wp:list -->\n<ul>\n${items.map(i => `  <li>${inlineMarkdownToHtml(i)}</li>`).join('\n')}\n</ul>\n<!-- /wp:list -->`;
      resultBlocks.push(listHtml);
      continue;
    }

    // Ordered Lists (1. item or 2. item)
    if (/^(?:\d+\.\s+.+\n?)+$/s.test(trimmed)) {
      const items = trimmed.split('\n').map(l => l.replace(/^\d+\.\s+/, '').trim()).filter(Boolean);
      const listHtml = `<!-- wp:list {"ordered":true} -->\n<ol>\n${items.map(i => `  <li>${inlineMarkdownToHtml(i)}</li>`).join('\n')}\n</ol>\n<!-- /wp:list -->`;
      resultBlocks.push(listHtml);
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.split('\n').map(l => l.replace(/^>\s?/, '').trim()).join('<br>');
      const quoteHtml = `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${inlineMarkdownToHtml(quoteText)}</p></blockquote>\n<!-- /wp:quote -->`;
      resultBlocks.push(quoteHtml);
      continue;
    }

    // Standard Paragraph
    let paragraphContent = trimmed;
    if (/\[IMAGE[_\s#]*\d+\]/i.test(paragraphContent)) {
      paragraphContent = paragraphContent.replace(/\[IMAGE[_\s#]*(\d+)\]/gi, (m, nStr) => {
        const num = parseInt(nStr, 10);
        if (options.excludeImageId !== undefined && options.excludeImageId !== null &&
            (num === options.excludeImageId || num.toString() === options.excludeImageId.toString())) {
          return '';
        }
        const imgData = imageMap[num] || imageMap[num.toString()];
        if (imgData && imgData.url) {
          const altText = escapeHtmlAttr(imgData.altText || '');
          const imgClass = imgData.id ? ` class="wp-image-${imgData.id}"` : '';
          return `<img src="${imgData.url}" alt="${altText}"${imgClass}/>`;
        }
        return '';
      });
    }

    if (paragraphContent.startsWith('<!-- wp:') || paragraphContent.startsWith('<figure') || paragraphContent.startsWith('<table')) {
      resultBlocks.push(paragraphContent);
      continue;
    }

    const paragraphText = inlineMarkdownToHtml(paragraphContent.replace(/\n/g, '<br>'));
    if (paragraphText.trim()) {
      resultBlocks.push(`<!-- wp:paragraph -->\n<p>${paragraphText}</p>\n<!-- /wp:paragraph -->`);
    }
  }

  return resultBlocks.join('\n\n');
}

function parseArticleSeoFromMarkdown(rawMarkdown, fallbackItem = {}) {
  if (!rawMarkdown && !fallbackItem) return {};
  const result = {
    metaTitle: fallbackItem.title || '',
    focusKeyphrase: fallbackItem.keyphrase || '',
    metaDescription: '',
    urlSlug: '',
    pageRole: fallbackItem.pageRole || '',
    categories: '',
    tags: '',
    excerpt: ''
  };

  if (rawMarkdown) {
    const match = rawMarkdown.match(/(?:^|\n)>\s*\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i) ||
                  rawMarkdown.match(/(?:^|\n)#{1,4}\s*SEO Metadata([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i) ||
                  rawMarkdown.match(/(?:^|\n)\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i);

    if (match) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        const titleM = line.match(/\*\*Meta Title:\*\*\s*(.+)/i);
        if (titleM) result.metaTitle = titleM[1].trim();

        const kpM = line.match(/\*\*Focus Keyphrase:\*\*\s*(.+)/i);
        if (kpM) result.focusKeyphrase = kpM[1].trim();

        const descM = line.match(/\*\*Meta Description:\*\*\s*(.+)/i);
        if (descM) result.metaDescription = descM[1].trim();

        const slugM = line.match(/\*\*URL Slug:\*\*\s*(.+)/i);
        if (slugM) result.urlSlug = slugM[1].trim().toLowerCase().replace(/^\/+|\/+$/g, '');

        const roleM = line.match(/\*\*Page Role:\*\*\s*(.+)/i);
        if (roleM && roleM[1].trim() !== 'undefined') result.pageRole = roleM[1].trim();

        const catM = line.match(/\*\*Categories:\*\*\s*(.+)/i);
        if (catM && catM[1].trim() !== '[Your Categories]' && catM[1].trim() !== 'undefined') result.categories = catM[1].trim();

        const tagsM = line.match(/\*\*Tags:\*\*\s*(.+)/i);
        if (tagsM && tagsM[1].trim() !== '[Your Tags]' && tagsM[1].trim() !== 'undefined') result.tags = tagsM[1].trim();

        const excerptM = line.match(/\*\*Excerpt:\*\*\s*(.+)/i);
        if (excerptM && excerptM[1].trim() !== '[Your Excerpt]' && excerptM[1].trim() !== 'undefined') result.excerpt = excerptM[1].trim();
      }
    }
  }

  // Fallbacks
  if (!result.focusKeyphrase && fallbackItem.keyphrase) {
    result.focusKeyphrase = fallbackItem.keyphrase;
  }
  if (!result.tags && fallbackItem.tags) {
    result.tags = fallbackItem.tags;
  }
  if (!result.tags) {
    const defaultTags = [];
    if (result.focusKeyphrase) defaultTags.push(result.focusKeyphrase);
    const textToScan = `${rawMarkdown || ''} ${fallbackItem.title || ''} ${fallbackItem.topic || ''}`.toLowerCase();
    if (textToScan.includes('bromo')) defaultTags.push('Mount Bromo', 'East Java');
    if (textToScan.includes('milky way') || textToScan.includes('milkyway')) defaultTags.push('Milky Way', 'Astrophotography');
    if (textToScan.includes('ijen')) defaultTags.push('Kawah Ijen');
    if (textToScan.includes('tumpak sewu')) defaultTags.push('Tumpak Sewu');
    defaultTags.push('Indonesia Travel', 'Photography Tour');
    result.tags = Array.from(new Set(defaultTags)).join(', ');
  }

  return result;
}

async function getOrCreateWpTagId(wpUrl, credentials, tagName) {
  if (!tagName) return null;
  const cleanName = tagName.trim();
  if (!cleanName) return null;

  try {
    // 1. Search for existing tag
    const searchRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(cleanName)}`, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (searchRes.ok) {
      const existing = await searchRes.json();
      const exactMatch = existing.find(t => t.name.toLowerCase() === cleanName.toLowerCase());
      if (exactMatch) return exactMatch.id;
    }

    // 2. Create new tag if not existing
    const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({ name: cleanName })
    });
    if (createRes.ok) {
      const newTag = await createRes.json();
      console.log(`[WordPress API] Created new tag "${cleanName}" (ID: ${newTag.id})`);
      return newTag.id;
    } else {
      const errData = await createRes.json().catch(() => ({}));
      if (errData && errData.code === 'term_exists' && errData.data && errData.data.term_id) {
        return errData.data.term_id;
      }
    }
  } catch (err) {
    console.warn(`[WordPress API] Failed to resolve tag "${cleanName}":`, err.message);
  }
  return null;
}

async function postToWordPress({ url, username, password, title, content, action, date, images }) {
  const adminSettings = getAdminSettings();
  const wpUrl = (url || adminSettings.wpUrl || process.env.WP_URL || process.env.WORDPRESS_URL || 'https://panoramalenstrip.com').replace(/\/$/, '');
  const wpUser = username || adminSettings.wpUsername || process.env.WP_USERNAME || process.env.WORDPRESS_USERNAME;
  const wpPass = password || adminSettings.wpAppPassword || process.env.WP_APPLICATION_PASSWORD || process.env.WORDPRESS_APPLICATION_PASSWORD;

  if (!wpUser || !wpPass) {
    console.log('[WordPress API] No credentials provided. Updated local tracking only.');
    return { success: false, reason: 'no_credentials', error: 'WordPress credentials (username & application password) are required in Settings.' };
  }

  const credentials = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
  const endpoint = `${wpUrl}/wp-json/wp/v2/posts`;

  let wpDateStr = date;
  if (date) {
    if (date.includes(' ')) {
      const parts = date.split(' ');
      wpDateStr = `${parts[0]}T${parts[1]}:00`;
    } else if (!date.includes('T')) {
      wpDateStr = `${date}T09:00:00`;
    }
  } else {
    wpDateStr = new Date().toISOString().split('.')[0];
  }

  let featuredMediaId = null;

  const parsedArticleSeo = parseArticleSeoFromMarkdown(content);
  const matchedItem = [...getQueueItems(), ...getManagerItems()].find(i => 
    (title && i.title && i.title.trim().toLowerCase() === title.trim().toLowerCase())
  ) || {};

  // Process and upload body images with SEO metadata
  const imageMap = {};
  const parsedSeoMap = parseImageSeoFromMarkdown(content);
  let imagesList = Array.isArray(images) && images.length > 0 ? images : [];
  if (imagesList.length === 0 && matchedItem.images && Array.isArray(matchedItem.images)) {
    imagesList = matchedItem.images;
  }

  const rawSlug = parsedArticleSeo.urlSlug || matchedItem.slug || matchedItem.urlSlug || '';
  const cleanSlug = rawSlug ? rawSlug.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/(^-|-$)/g, '') : (title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : '');

  // If imagesList is empty, attempt lookup from saved queue or manager items
  if (imagesList.length === 0) {
    const allItems = [...getQueueItems(), ...getManagerItems()];
    const match = allItems.find(i => 
      (title && i.title && i.title.trim().toLowerCase() === title.trim().toLowerCase()) ||
      (title && i.keyphrase && i.keyphrase.trim().toLowerCase() === title.trim().toLowerCase())
    );
    if (match && Array.isArray(match.images) && match.images.length > 0) {
      imagesList = match.images;
    }
  }

  const imageIdsToProcess = new Set([
    ...imagesList.map(img => img.id || 1),
    ...Object.keys(parsedSeoMap).map(k => parseInt(k, 10))
  ]);

  if (content) {
    const matches = content.matchAll(/\[IMAGE[_\s#]*(\d+)\]/gi);
    for (const m of matches) {
      imageIdsToProcess.add(parseInt(m[1], 10));
    }
  }

  if (imageIdsToProcess.size === 0 && imagesList.length > 0) {
    imagesList.forEach((_, idx) => imageIdsToProcess.add(idx + 1));
  }

  for (const num of Array.from(imageIdsToProcess).sort((a, b) => a - b)) {
    const imgObj = imagesList.find(i => i.id === num) || imagesList[num - 1] || {};
    const parsedSeo = parsedSeoMap[num] || {};

    const seoMeta = {
      fileName: imgObj.fileName || parsedSeo.fileName || `image-${num}.jpg`,
      altText: imgObj.altText || parsedSeo.altText || '',
      title: imgObj.title || parsedSeo.title || '',
      caption: imgObj.caption || parsedSeo.caption || '',
      description: imgObj.description || parsedSeo.description || ''
    };

    let imageBuffer = null;
    let mimeType = getMimeType(seoMeta.fileName || imgObj.imageUrl || imgObj.url);
    const imgUrlCandidate = imgObj.imageUrl || imgObj.url || imgObj.src || '';

    // Search local filesystem in SETTINGS_DIR/uploads and project directories
    const uploadsDirs = [
      path.join(SETTINGS_DIR, 'uploads'),
      path.join(process.cwd(), 'data', 'uploads'),
      path.join(process.cwd(), 'uploads')
    ];

    const possibleFileNames = [
      imgUrlCandidate ? path.basename(imgUrlCandidate.split('?')[0]) : '',
      imgObj.fileName,
      seoMeta.fileName,
      parsedSeo.fileName,
      `image-${num}.jpg`,
      `image-${num}.png`,
      `image-${num}.jpeg`
    ].filter(Boolean);

    for (const uDir of uploadsDirs) {
      if (imageBuffer) break;
      if (!fs.existsSync(uDir)) continue;

      for (const fn of possibleFileNames) {
        const p = path.join(uDir, fn);
        if (fs.existsSync(p)) {
          try {
            imageBuffer = fs.readFileSync(p);
            mimeType = getMimeType(fn);
            break;
          } catch (e) {
            console.warn('[WordPress API] Error reading local image file:', p, e.message);
          }
        }
      }
    }

    const base64Data = imgObj.imageBase64 || imgObj.base64 || (imgUrlCandidate.startsWith('data:') ? imgUrlCandidate : null);
    if (!imageBuffer && base64Data) {
      const match = base64Data.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageBuffer = Buffer.from(match[2], 'base64');
      } else {
        imageBuffer = Buffer.from(base64Data, 'base64');
      }
    }

    if (!imageBuffer && imgUrlCandidate && imgUrlCandidate.startsWith('http')) {
      try {
        console.log(`[WordPress API] Fetching remote image for upload: ${imgUrlCandidate}`);
        const fetchRes = await fetch(imgUrlCandidate, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (fetchRes.ok) {
          const arrayBuf = await fetchRes.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuf);
          const ct = fetchRes.headers.get('content-type');
          if (ct) mimeType = ct;
        }
      } catch (e) {
        console.warn(`[WordPress API] Failed to fetch remote image ${imgUrlCandidate}:`, e.message);
      }
    }

    if (imageBuffer) {
      console.log(`[WordPress API] Uploading image #${num} (${seoMeta.fileName}) to WordPress...`);
      const uploadedMedia = await uploadMediaToWordPress({
        wpUrl,
        credentials,
        imageBuffer,
        mimeType,
        fileName: seoMeta.fileName,
        seoMeta
      });

      if (uploadedMedia && uploadedMedia.id) {
        imageMap[num] = uploadedMedia;
        const firstImgObj = imagesList.length > 0 ? imagesList[0] : null;
        const firstImgId = firstImgObj ? (firstImgObj.id !== undefined ? firstImgObj.id : 1) : 1;
        if (num === firstImgId || !featuredMediaId) {
          featuredMediaId = uploadedMedia.id;
        }
      } else if (uploadedMedia && uploadedMedia.error) {
        console.warn(`[WordPress API] Media upload failed for #${num}:`, uploadedMedia.error);
      }
    }

    // Fallback if WP upload failed or imageBuffer was not available but URL exists
    if (!imageMap[num]) {
      let finalFallbackUrl = imgUrlCandidate || (seoMeta.fileName ? `${wpUrl}/uploads/${seoMeta.fileName}` : '');
      if (finalFallbackUrl && !finalFallbackUrl.startsWith('http') && !finalFallbackUrl.startsWith('data:')) {
        finalFallbackUrl = `${wpUrl}/${finalFallbackUrl.replace(/^\//, '')}`;
      }
      if (finalFallbackUrl) {
        imageMap[num] = {
          id: null,
          url: finalFallbackUrl,
          ...seoMeta
        };
      }
    }
  }

  // 2. Convert markdown to HTML inserting uploaded images at exact placements (excluding the first image which is featured image)
  const firstImgObj = imagesList.length > 0 ? imagesList[0] : null;
  const firstImgId = firstImgObj ? (firstImgObj.id !== undefined ? firstImgObj.id : 1) : null;
  const htmlContent = content ? markdownToHtml(content, imageMap, { excludeImageId: firstImgId }) : '';

  // 3. Extract Yoast SEO fields & page role
  const focusKw = parsedArticleSeo.focusKeyphrase || matchedItem.keyphrase || '';
  const metaDesc = parsedArticleSeo.metaDescription || matchedItem.metaDescription || '';
  const pageRole = parsedArticleSeo.pageRole || matchedItem.pageRole || '';
  const isCornerstone = /pillar/i.test(pageRole) ? "1" : "0";
  const excerptText = parsedArticleSeo.excerpt || matchedItem.excerpt || '';

  // 4. Fetch existing categories & tags in parallel from WordPress
  let categoryIds = [];
  let tagIds = [];

  try {
    const [catRes, tagsRes] = await Promise.all([
      fetch(`${wpUrl}/wp-json/wp/v2/categories?per_page=100`, {
        headers: { 'Authorization': `Basic ${credentials}`, 'User-Agent': 'Mozilla/5.0' }
      }).catch(() => null),
      fetch(`${wpUrl}/wp-json/wp/v2/tags?per_page=100`, {
        headers: { 'Authorization': `Basic ${credentials}`, 'User-Agent': 'Mozilla/5.0' }
      }).catch(() => null)
    ]);

    // Process Categories
    if (catRes && catRes.ok) {
      const existingCategories = await catRes.json();
      const textToMatch = `${title || ''} ${focusKw || ''} ${parsedArticleSeo.tags || ''} ${content || ''}`.toLowerCase();
      for (const cat of existingCategories) {
        if (!cat || !cat.name || cat.name.toLowerCase() === 'uncategorized') continue;
        const catName = cat.name.toLowerCase();
        const catSlug = (cat.slug || '').toLowerCase().replace(/-/g, ' ');
        if (textToMatch.includes(catName) || textToMatch.includes(catSlug)) {
          categoryIds.push(cat.id);
        }
      }
      if (categoryIds.length > 0) {
        console.log(`[WordPress API] Matched ${categoryIds.length} existing categories for post:`, categoryIds);
      }
    }

    // Process Tags (instant lookup for existing tags, direct POST for new generated tags)
    const existingTagsMap = new Map();
    if (tagsRes && tagsRes.ok) {
      const tagsList = await tagsRes.json();
      tagsList.forEach(t => existingTagsMap.set(t.name.toLowerCase().trim(), t.id));
    }

    const rawTagsStr = parsedArticleSeo.tags || matchedItem.tags || '';
    const tagNames = rawTagsStr ? rawTagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    for (const name of tagNames) {
      const lowerName = name.toLowerCase().trim();
      if (existingTagsMap.has(lowerName)) {
        tagIds.push(existingTagsMap.get(lowerName));
      } else {
        // Post new tag directly to WordPress
        try {
          const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Basic ${credentials}`,
              'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({ name: name })
          });
          const resData = await createRes.json();
          if (createRes.ok && resData.id) {
            tagIds.push(resData.id);
            existingTagsMap.set(lowerName, resData.id);
            console.log(`[WordPress API] Created new tag "${name}" (ID: ${resData.id})`);
          } else if (resData && resData.code === 'term_exists' && resData.data && resData.data.term_id) {
            tagIds.push(resData.data.term_id);
            existingTagsMap.set(lowerName, resData.data.term_id);
          }
        } catch (err) {
          console.warn(`[WordPress API] Error posting tag "${name}":`, err.message);
        }
      }
    }
    if (tagIds.length > 0) {
      console.log(`[WordPress API] Assigned ${tagIds.length} tag IDs to post:`, tagIds);
    }
  } catch (catErr) {
    console.warn('[WordPress API] Could not fetch categories/tags from WordPress:', catErr.message);
  }

  const finalMetaTitle = parsedArticleSeo.metaTitle || matchedItem.metaTitle || title || '';
  const yoastMetaObj = {
    ...(focusKw ? { _yoast_wpseo_focuskw: focusKw, rank_math_focus_keyword: focusKw } : {}),
    ...(metaDesc ? { _yoast_wpseo_metadesc: metaDesc, rank_math_description: metaDesc } : {}),
    _yoast_wpseo_is_cornerstone: isCornerstone,
    ...(finalMetaTitle ? { _yoast_wpseo_title: finalMetaTitle, rank_math_title: finalMetaTitle } : {})
  };

  const payload = {
    title: title || finalMetaTitle,
    status: action === 'publish' ? 'publish' : 'future',
    date: wpDateStr,
    ...(categoryIds.length > 0 ? { categories: categoryIds } : {}),
    ...(tagIds.length > 0 ? { tags: tagIds } : {}),
    ...(cleanSlug ? { slug: cleanSlug } : {}),
    ...(excerptText ? { excerpt: excerptText } : {}),
    ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    content: htmlContent || '',
    meta: yoastMetaObj
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[WordPress API] Post creation error:', response.status, errText);
      return { success: false, error: errText };
    }

    const data = await response.json();
    console.log(`[WordPress API] Successfully created/scheduled post on WordPress! ID: ${data.id}, Link: ${data.link}`);

    // Follow-up POST to update Yoast SEO Meta fields directly on post ID endpoint
    try {
      await fetch(`${endpoint}/${data.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
          ...(cleanSlug ? { slug: cleanSlug } : {}),
          meta: yoastMetaObj
        })
      });
      console.log(`[WordPress API] Updated Yoast SEO meta for post ID: ${data.id} (FocusKW: "${focusKw}", Cornerstone: ${isCornerstone})`);
    } catch (yoastErr) {
      console.warn(`[WordPress API] Failed to update Yoast SEO meta on post ID: ${data.id}`, yoastErr.message);
    }

    return { success: true, wpPost: data };
  } catch (err) {
    console.error('[WordPress API] Failed to post to WordPress API:', err);
    return { success: false, error: err.message };
  }
}

// Endpoint for publishing/scheduling articles (accessible from Queue & Calendar)
app.post('/api/articles/schedule-publish', async (req, res) => {
  const { articleId, title, keyphrase, link, action, date, content, wpCredentials, images } = req.body;
  if (!title && !keyphrase && !articleId) {
    return res.status(400).json({ error: 'Article identifier is required' });
  }

  const managerItems = getManagerItems();
  const queueItems = getQueueItems();

  let queueItem = null;
  let managerItem = null;

  if (articleId) {
    queueItem = queueItems.find(i => String(i.id) === String(articleId));
  }

  if (title) {
    const cleanTitle = title.trim().toLowerCase();
    if (!queueItem) {
      queueItem = queueItems.find(i => i.title && i.title.trim().toLowerCase() === cleanTitle);
    }
    managerItem = managerItems.find(i => i.title && i.title.trim().toLowerCase() === cleanTitle);
  }

  if (!queueItem && keyphrase) {
    const cleanKp = keyphrase.trim().toLowerCase();
    queueItem = queueItems.find(i => i.keyphrase && i.keyphrase.trim().toLowerCase() === cleanKp);
  }

  if (!managerItem && queueItem && queueItem.managerId) {
    managerItem = managerItems.find(i => String(i.id) === String(queueItem.managerId));
  }

  if (!managerItem && keyphrase) {
    const cleanKp = keyphrase.trim().toLowerCase();
    managerItem = managerItems.find(i => i.keyphrase && i.keyphrase.trim().toLowerCase() === cleanKp);
  }

  if (!managerItem && articleId && !title && !queueItem) {
    managerItem = managerItems.find(i => String(i.id) === String(articleId));
  }

  const targetDate = date || new Date().toISOString().split('T')[0];

  // Resolve full article content: prioritize passed content, then queueItem.article, then managerItem.article
  let articleContent = content || (queueItem && queueItem.article ? queueItem.article : (managerItem && managerItem.article ? managerItem.article : ''));

  // If articleContent is still empty, search all queue items by title match
  if (!articleContent && title) {
    const cleanTitle = title.trim().toLowerCase();
    const fallbackMatch = queueItems.find(q => q.title && q.title.trim().toLowerCase() === cleanTitle && q.article);
    if (fallbackMatch) {
      articleContent = fallbackMatch.article;
    }
  }

  const articleImages = (images && images.length > 0) ? images : (queueItem && queueItem.images && queueItem.images.length > 0 ? queueItem.images : (managerItem && managerItem.images ? managerItem.images : []));

  // Attempt WP REST API post/scheduling
  const wpResult = await postToWordPress({
    url: wpCredentials ? wpCredentials.url : null,
    username: wpCredentials ? wpCredentials.username : null,
    password: wpCredentials ? wpCredentials.password : null,
    title: title || (queueItem ? queueItem.title : (managerItem ? managerItem.title : 'New Article')),
    content: articleContent,
    action,
    date: targetDate,
    images: articleImages
  });

  let wpLink = link || (wpResult.success && wpResult.wpPost ? wpResult.wpPost.link : '');

  // Sync status in queue items file if queue item was found
  if (queueItem) {
    const queueIndex = queueItems.findIndex(i => String(i.id) === String(queueItem.id));
    if (queueIndex !== -1) {
      if (action === 'publish') {
        queueItems[queueIndex].status = 'complete';
        queueItems[queueIndex].publishedDate = targetDate;
        delete queueItems[queueIndex].scheduledDate;
      } else {
        queueItems[queueIndex].status = 'dijadwalkan';
        queueItems[queueIndex].scheduledDate = targetDate;
        delete queueItems[queueIndex].publishedDate;
      }
      if (wpLink) queueItems[queueIndex].link = wpLink;
      saveQueueItems(queueItems);
    }
  }

  // Sync status in manager items file if manager item present or create new entry
  if (managerItem) {
    const managerIndex = managerItems.findIndex(i => String(i.id) === String(managerItem.id));
    if (managerIndex !== -1) {
      if (action === 'publish') {
        managerItems[managerIndex].status = 'telah_dibuat';
        managerItems[managerIndex].publishedDate = targetDate;
        managerItems[managerIndex].scheduledDate = null;
      } else {
        managerItems[managerIndex].status = 'dijadwalkan';
        managerItems[managerIndex].scheduledDate = targetDate;
        managerItems[managerIndex].publishedDate = null;
      }
      if (wpLink) managerItems[managerIndex].link = wpLink;
      saveManagerItems(managerItems);
      return res.json({ success: true, item: managerItems[managerIndex], wpSynced: wpResult.success, wpLink, wpError: wpResult.error });
    }
  }

  // Create new article entry in manager
  const nextId = managerItems.length > 0 ? Math.max(...managerItems.map(i => i.id)) + 1 : 1;
  const newItem = {
    id: nextId,
    pageRole: 'Cluster',
    keyphrase: keyphrase || title || 'New Article',
    title: title || keyphrase || 'New Article',
    topic: '',
    intent: 'Informational',
    link: wpLink || '',
    status: action === 'publish' ? 'telah_dibuat' : 'dijadwalkan',
    scheduledDate: action === 'publish' ? null : targetDate,
    publishedDate: action === 'publish' ? targetDate : null
  };
  managerItems.push(newItem);
  saveManagerItems(managerItems);
  return res.json({ success: true, item: newItem, wpSynced: wpResult.success, wpLink, wpError: wpResult.error });
});

// Delete an article
app.delete('/api/articles/:id', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }
  
  let items = getManagerItems();
  const initialLength = items.length;
  items = items.filter(i => i.id !== id);
  
  if (items.length === initialLength) {
    return res.status(404).json({ error: 'Article not found' });
  }
  
  if (saveManagerItems(items)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

// Import CSV endpoint
app.post('/api/articles/import-csv', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  let csvContent = '';
  const { useDefault, fileContent } = req.body;
  
  if (useDefault) {
    const defaultPath = '/home/ramadhani/plan keyword - New Plan.csv';
    if (fs.existsSync(defaultPath)) {
      csvContent = fs.readFileSync(defaultPath, 'utf8');
    } else {
      return res.status(404).json({ error: 'Default CSV file not found on server.' });
    }
  } else {
    csvContent = fileContent || '';
  }
  
  if (!csvContent) {
    return res.status(400).json({ error: 'CSV content is empty' });
  }
  
  const lines = csvContent.split(/\r?\n/);
  const items = getManagerItems();
  let addedCount = 0;
  let updatedCount = 0;
  
  let nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
  
  const startIdx = (lines[0] && lines[0].toLowerCase().includes('page role')) ? 1 : 0;
  
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const cols = parseCSVLine(line);
    const keyphrase = cols[1] || '';
    const title = cols[2] || '';
    
    if (!keyphrase && !title) continue;
    
    const pageRole = cols[0] || '';
    const topic = cols[3] || '';
    const intent = cols[4] || '';
    const link = cols[5] || '';
    const status = (link && link.startsWith('http')) ? 'telah_dibuat' : 'belum_dibuat';
    
    const existingIndex = items.findIndex(item => 
      (keyphrase && item.keyphrase.toLowerCase() === keyphrase.toLowerCase()) ||
      (title && item.title.toLowerCase() === title.toLowerCase())
    );
    
    if (existingIndex !== -1) {
      const existing = items[existingIndex];
      existing.pageRole = pageRole || existing.pageRole;
      existing.topic = topic || existing.topic;
      existing.intent = intent || existing.intent;
      if (link) {
        existing.link = link;
        existing.status = 'telah_dibuat';
      }
      updatedCount++;
    } else {
      items.push({
        id: nextId++,
        pageRole,
        keyphrase,
        title,
        topic,
        intent,
        link,
        status
      });
      addedCount++;
    }
  }
  
  if (saveManagerItems(items)) {
    res.json({ success: true, addedCount, updatedCount, totalCount: items.length });
  } else {
    res.status(500).json({ error: 'Failed to save imported articles' });
  }
});

// Explicit Sync endpoint
app.post('/api/articles/sync', async (req, res) => {
  try {
    const result = await syncWordPressArticles();
    res.json({
      success: true,
      updatedCount: typeof result === 'object' ? result.updatedCount : result,
      addedCount: typeof result === 'object' ? result.addedCount : 0,
      total: typeof result === 'object' ? result.total : 0
    });
  } catch (error) {
    console.error('WordPress sync failed:', error);
    res.status(500).json({ error: 'Sync failed: ' + error.message });
  }
});

// ── Queue Database Endpoints ─────────────────────────────────────
// Get all queue items
app.get('/api/queue', (req, res) => {
  res.json(getQueueItems());
});

// Add or update a queue item
app.post('/api/queue', (req, res) => {
  const item = req.body;
  if (!item || item.id === undefined) {
    return res.status(400).json({ error: 'Invalid item data' });
  }
  
  const items = getQueueItems();
  const index = items.findIndex(i => String(i.id) === String(item.id));
  if (index !== -1) {
    items[index] = item;
  } else {
    items.push(item);
  }
  
  if (saveQueueItems(items)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to save item to server database' });
  }
});

// Delete a specific queue item
app.delete('/api/queue/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }
  
  let items = getQueueItems();
  items = items.filter(i => i.id !== id);
  
  if (saveQueueItems(items)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to delete item from server database' });
  }
});

// Clear all queue items
app.delete('/api/queue', (req, res) => {
  if (saveQueueItems([])) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to clear database' });
  }
});

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function sendSSE(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

app.post('/api/generate', async (req, res) => {
  const { apiKey, openaiApiKey, title, topic, keyphrase, pageRole, starterArticle, model, expertQuotations, images, internalLinks, customPrompt, targetAudience, brand } = req.body;

  if (!apiKey && !openaiApiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Load global admin settings
  const adminSettings = getAdminSettings();
  const tone = adminSettings.tone || 'Professional';
  const targetLanguage = adminSettings.targetLanguage || 'English';
  const finalCustomPrompt = customPrompt || adminSettings.customPrompt || '';
  const finalTargetAudience = targetAudience || adminSettings.targetAudience || '';
  const finalBrand = brand || adminSettings.brand || '';
  const finalCtaLink = adminSettings.ctaLink || 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21';
  const wordCountMode = adminSettings.wordCountMode || 'total';
  const wordCountDivisor = adminSettings.wordCountDivisor || 10;
  const rawTarget = adminSettings.targetWordCount || 3000;
  const targetWordCount = wordCountMode === 'total'
    ? Math.max(50, Math.round(rawTarget / wordCountDivisor))
    : rawTarget;
  const numBodySections = Math.max(1, wordCountDivisor - 2);

  try {
    const modelName = model || 'gemini-3.5-flash';

    const toneInstruction = tone ? `Write in a ${tone.toLowerCase()} tone and style.` : 'Write in a professional tone.';
    let customPromptExtra = finalCustomPrompt ? `\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n${finalCustomPrompt}\n----------------------------------------------\n` : '';
    customPromptExtra += `\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in ${targetLanguage}, regardless of the language used in the inputs or starter text.`;
    customPromptExtra += `\n\n--- INCLUSIVE & RESPECTFUL LANGUAGE RULE (STRICT) ---\nYou MUST strictly write using inclusive, respectful, empathetic, and non-discriminatory language throughout the article.\n- Gender Neutrality: Use gender-neutral terminology (e.g. 'travelers', 'photographers', 'guests', 'people', 'they/them/their') instead of gender-biased or exclusionary pronouns/phrases (e.g. 'he/him', 'guys').\n- Respect & Dignity: Avoid any non-inclusive, stereotypical, ableist, ageist, culturally insensitive, or exclusionary phrasing. Ensure all individuals, cultures, and backgrounds are treated with dignity and respect.\n------------------------------------------------------\n`;
    
    if (finalTargetAudience) customPromptExtra += `\nTarget Audience: ${finalTargetAudience}`;
    if (finalBrand) customPromptExtra += `\nBrand: ${finalBrand}`;
    if (finalCtaLink) {
      customPromptExtra += `\n\n--- CALL TO ACTION (CTA) LINK RULES ---\nWhen writing Calls to Action (CTAs), always use the following destination URL for any conversion CTA links: "${finalCtaLink}". Format it as standard Markdown: [Anchor Text](${finalCtaLink}). Do NOT use dummy/hash links like "#" or placeholder URLs.\n---------------------------------------\n`;
    }
    
    if (expertQuotations && expertQuotations.length > 0) {
      customPromptExtra += `\n\n--- EXPERT QUOTATIONS TO INCLUDE ---\nThe user has provided the following expert quotations. Please weave them naturally into the article where appropriate. Format the expert's name as a clickable Markdown link if a URL is provided:\n`;
      expertQuotations.forEach(q => {
        const namePart = q.url ? `[${q.name || 'Expert'}](${q.url})` : (q.name || 'Expert');
        customPromptExtra += `- ${namePart}: "${q.quote}"\n`;
      });
      customPromptExtra += `------------------------------------\n`;
    }

    const starterContext = starterArticle
      ? `\n\nThe user has provided a starter/reference article. Use it as context for direction, style, and background knowledge. Here it is:\n\n---START REFERENCE---\n${starterArticle}\n---END REFERENCE---\n\n`
      : '';

    let promptTokens = 0;
    let candidatesTokens = 0;
    let totalTokens = 0;

    const addUsage = (response) => {
      if (response && response.usageMetadata) {
        promptTokens += response.usageMetadata.promptTokenCount || 0;
        candidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
        totalTokens += response.usageMetadata.totalTokenCount || 0;
      }
    };

    const imageSeoResults = [];
    const imagesToProcess = [];
    if (Array.isArray(images) && images.length > 0) {
      imagesToProcess.push(...images);
    }

    if (imagesToProcess.length > 0) {
      sendSSE(res, 'progress', { step: 'image-seo', message: `Analyzing ${imagesToProcess.length} images...`, percent: 2 });
      
      for (let i = 0; i < imagesToProcess.length; i++) {
        const img = imagesToProcess[i];
        
        let mimeType = 'image/jpeg';
        let imgData;
        
        if (img.imageUrl) {
          const filePath = path.join(SETTINGS_DIR, 'uploads', path.basename(img.imageUrl));
          const ext = path.extname(filePath).replace('.', '').toLowerCase();
          mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          imgData = fs.readFileSync(filePath).toString('base64');
        } else {
          let rawData = img.imageBase64;
          const match = rawData.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
          imgData = rawData;
          if (match) {
            mimeType = match[1];
            imgData = match[2];
          }
        }
        
        const imageSeoPrompt = `You are an expert SEO specialist, professional photographer, and travel blogger.
Generate SEO-optimized image metadata (Alt Text, Title, Caption, Description, and File Name) for this image.

Inputs:
- Location: ${img.location || 'Not specified'}
- Scene description: ${img.scene || 'Not specified'}
- Is Featured Image: ${img.isFeatured ? 'Yes (WordPress Featured Media)' : 'No'}

Requirements:
1. The entire output (alt text, title, caption, description, and file name) MUST be written entirely in ${targetLanguage}, regardless of the input language used for location or scene description.
2. **File Name**: Generate an SEO-optimized file name for the image in lowercase, using hyphens instead of spaces, and ending with .jpg (e.g., golden-pavilion-temple-kyoto.jpg).

Format the output EXACTLY as a JSON object with keys "altText", "title", "caption", "description", and "fileName". Do not include markdown fences, JSON tags, or extra commentary.`;

        try {
          const seoResponse = await generateContent({
            model: modelName,
            prompt: imageSeoPrompt,
            apiKey,
            openaiApiKey,
            image: {
              data: imgData,
              mimeType: mimeType
            }
          });
          addUsage(seoResponse);
          
          let rawText = seoResponse.text.trim();
          if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          }
          
          let parsedSeo;
          try {
            parsedSeo = JSON.parse(rawText);
            if (!parsedSeo.fileName) {
              parsedSeo.fileName = (parsedSeo.title || 'image-' + img.id)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '') + '.jpg';
            }
          } catch (err) {
            console.error('Failed to parse image SEO json, falling back:', err);
            parsedSeo = {
              altText: `Image of ${img.scene || 'scene'} in ${img.location || 'location'}.`,
              title: `Image ${img.id}`,
              caption: `Beautiful view of ${img.scene || 'scene'} at ${img.location || 'location'}.`,
              description: `A photograph capturing the essence of ${img.scene || 'scene'} located at ${img.location || 'location'}.`,
              fileName: `image-${img.id}.jpg`
            };
          }
          
          imageSeoResults.push({
            id: img.id,
            isFeatured: img.isFeatured || false,
            imageUrl: img.imageUrl,
            imageBase64: img.imageBase64,
            location: img.location,
            scene: img.scene,
            ...parsedSeo
          });
        } catch (err) {
          console.error(`Failed to analyze image ${img.id}:`, err);
          imageSeoResults.push({
            id: img.id,
            title: `Image ${img.id}`,
            caption: `Beautiful view of ${img.scene || 'scene'} at ${img.location || 'location'}.`,
            description: `A photograph capturing the essence of ${img.scene || 'scene'} located at ${img.location || 'location'}.`,
            fileName: `image-${img.id}.jpg`
          });
        }
      }
    }

    if (imageSeoResults.length > 0) {
      customPromptExtra += `\n\n--- AVAILABLE IMAGES FOR THIS ARTICLE (INFORMATION ONLY) ---\nThese are the images uploaded by the user. Do NOT write placeholders for them in the text unless explicitly requested by the section requirements.\n`;
      imageSeoResults.forEach(img => {
        customPromptExtra += `- Image #${img.id}: Location: "${img.location}", Scene Description: "${img.scene}", Alt Text: "${img.altText}"\n`;
      });
      customPromptExtra += `------------------------------------------------------------\n`;
    }

    // Distribute internal links across article sections (Intro: -1, Body sections: 0..N-1, Conclusion: N)
    const linksByPart = {};
    linksByPart['-1'] = [];
    for (let sIdx = 0; sIdx < numBodySections; sIdx++) {
      linksByPart[sIdx.toString()] = [];
    }
    linksByPart[numBodySections.toString()] = [];

    if (internalLinks && internalLinks.length > 0) {
      const partIndices = [-1];
      for (let sIdx = 0; sIdx < numBodySections; sIdx++) {
        partIndices.push(sIdx);
      }
      partIndices.push(numBodySections);

      internalLinks.forEach(link => {
        const count = Math.max(1, link.count || 1);
        
        // Shuffle part indices so we distribute link occurrences pseudo-randomly
        const shuffledParts = [...partIndices];
        for (let i = shuffledParts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledParts[i], shuffledParts[j]] = [shuffledParts[j], shuffledParts[i]];
        }

        // Assign to the first 'count' parts (wrap around if count exceeds number of parts)
        for (let c = 0; c < count; c++) {
          const partIdx = shuffledParts[c % shuffledParts.length];
          linksByPart[partIdx.toString()].push({
            title: link.title,
            url: link.url
          });
        }
      });
      console.log('Distributed internal links:', JSON.stringify(linksByPart));
    }

    const getPartInternalLinksPrompt = (partLinks) => {
      if (!partLinks || partLinks.length === 0) return '';
      
      return `\n\n--- INTERNAL LINKS TO INCLUDE IN THIS SECTION ---\nYou MUST naturally weave the following internal link(s) into the body text (paragraphs) of this section.
Instructions:
1. Format each link as standard Markdown: [Anchor Text](URL)
2. The Anchor Text should fit naturally in the sentence. It does NOT need to be the exact article title.
3. NEVER write the anchor text as the exact link/URL address. Use descriptive, contextually relevant anchor keywords or phrases instead.
4. Weave each link into this section's text exactly 1 time in a separate paragraph.

Internal links to insert:
${partLinks.map(link => `- Target Title: "${link.title}" -> Link URL: "${link.url}" (Insert exactly 1 time)`).join('\n')}
-------------------------------------------------\n`;
    };

    // ── Step 1: Generate Outline ──────────────────────────────────────
    sendSSE(res, 'progress', { step: 'outline', message: 'Generating article outline...', percent: 5 });

    const outlinePrompt = `You are an expert long-form content strategist and SEO writer.${customPromptExtra}

Create a detailed article outline for:
- Title: "${title}"
- Topic / Core Question: "${topic}"
- Focus Keyphrase: "${keyphrase}"
${toneInstruction}${starterContext}

Target Word Count Specifications:
- Total Target Word Count: ${rawTarget} words
- Number of Components: ${wordCountDivisor} (1 Introduction + ${numBodySections} Sections + 1 Conclusion)
- Target Length per Section: ~${targetWordCount} words

Based on these word count requirements, design exactly ${numBodySections} section headings that comprehensively cover this topic. The sections should flow logically, each building on the previous one. Ensure each section is scoped to allow writing precisely ~${targetWordCount} words of deep, focused content.
For each section, determine if any of the available images best fit that section. If so, assign the image ID to that section.

IMPORTANT: Return ONLY a valid JSON object with the following keys:
- "sections": a JSON array of exactly ${numBodySections} objects, each containing:
  - "heading": the heading string
  - "description": the description string
  - "assignedImageId": (number or null) the ID of the image that fits this section best
- "introImageId": (number or null) the ID of the image that fits the introduction best
- "conclusionImageId": (number or null) the ID of the image that fits the conclusion best

Example output format:
{
  "introImageId": null,
  "conclusionImageId": null,
  "sections": [
    {"heading": "Heading 1", "description": "Description 1", "assignedImageId": 1},
    {"heading": "Heading 2", "description": "Description 2", "assignedImageId": null}
  ]
}

No markdown fences, no extra text.`;

    const outlineResponse = await generateContent({
      model: modelName,
      prompt: outlinePrompt,
      apiKey,
      openaiApiKey
    });
    addUsage(outlineResponse);

    let outlineText = outlineResponse.text.trim();
    if (outlineText.startsWith('```')) {
      outlineText = outlineText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let sections;
    let introImageId = null;
    let conclusionImageId = null;

    try {
      let parsedOutline = JSON.parse(outlineText);
      if (Array.isArray(parsedOutline)) {
        sections = parsedOutline;
      } else if (parsedOutline && parsedOutline.sections) {
        sections = parsedOutline.sections;
        introImageId = parsedOutline.introImageId || null;
        conclusionImageId = parsedOutline.conclusionImageId || null;
      } else {
        throw new Error('Invalid outline structure');
      }
    } catch (e) {
      const match = outlineText.match(/\[[\s\S]*\]/);
      if (match) {
        sections = JSON.parse(match[0]);
      } else {
        const objMatch = outlineText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          let parsedOutline = JSON.parse(objMatch[0]);
          sections = parsedOutline.sections || [];
          introImageId = parsedOutline.introImageId || null;
          conclusionImageId = parsedOutline.conclusionImageId || null;
        } else {
          throw new Error('Failed to parse outline. Please try again.');
        }
      }
    }

    const imageAssignments = {}; 
    const unassignedImages = (imageSeoResults || []).map(img => img.id);
    const assignedIds = new Set();
    
    const assignImage = (index, imageId) => {
      if (imageId && unassignedImages.includes(imageId) && !assignedIds.has(imageId)) {
        if (!imageAssignments[index]) imageAssignments[index] = [];
        imageAssignments[index].push(imageId);
        assignedIds.add(imageId);
        const idx = unassignedImages.indexOf(imageId);
        if (idx !== -1) unassignedImages.splice(idx, 1);
      }
    };
    
    if (introImageId) assignImage(-1, introImageId);
    if (conclusionImageId) assignImage(numBodySections, conclusionImageId);
    
    if (sections && Array.isArray(sections)) {
      sections.forEach((sec, idx) => {
        if (sec.assignedImageId) {
          assignImage(idx, sec.assignedImageId);
        } else if (sec.assignedImageIds && Array.isArray(sec.assignedImageIds)) {
          sec.assignedImageIds.forEach(id => assignImage(idx, id));
        }
      });
    }
    
    let distributeIdx = 0;
    while (unassignedImages.length > 0) {
      const imgId = unassignedImages[0];
      assignImage(distributeIdx % numBodySections, imgId);
      distributeIdx++;
    }

    sendSSE(res, 'outline', { sections: sections.map(s => s.heading), percent: 10 });

    // ── Step 2: Generate Introduction ─────────────────────────────────
    sendSSE(res, 'progress', { step: 'introduction', message: 'Writing introduction...', percent: 12 });

    let introImageInstruction = '';
    if (imageAssignments['-1'] && imageAssignments['-1'].length > 0) {
      const ids = imageAssignments['-1'];
      introImageInstruction = `\n- Image Placement: You MUST place the image placeholder \`[IMAGE_${ids[0]}]\` on its own line (with empty lines before and after it) where it fits best relative to the introduction text content.\n`;
    }

    const introPrompt = `You are an expert article writer.${customPromptExtra}${getPartInternalLinksPrompt(linksByPart['-1'])}

Write a compelling introduction (~${targetWordCount} words) for an article titled "${title}".

Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}${starterContext}

The article will cover these sections:
${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

Requirements:
- Hook the reader immediately with a surprising fact, question, or bold statement
- Introduce the topic and explain why it matters
- Naturally include the focus keyphrase "${keyphrase}" 1-2 times
- Preview what the reader will learn
- Write in Markdown format (no heading needed, just body text)
- Aim for ~${targetWordCount} words minimum
- Do NOT include a heading — just the introduction body text${introImageInstruction}`;

    const introResponse = await generateContent({
      model: modelName,
      prompt: introPrompt,
      apiKey,
      openaiApiKey
    });
    addUsage(introResponse);

    let fullArticle = `# ${title}\n\n${introResponse.text.trim()}\n\n`;
    sendSSE(res, 'section_done', { index: -1, name: 'Introduction', wordCount: countWords(fullArticle), percent: 18 });

    // ── Step 3: Generate Each Section ─────────────────────────────────
    const totalSections = sections.length;
    for (let i = 0; i < totalSections; i++) {
      const section = sections[i];
      const percent = 18 + ((i + 1) / totalSections) * 68;

      sendSSE(res, 'progress', {
        step: 'section',
        current: i + 1,
        total: totalSections,
        message: `Writing: ${section.heading}`,
        percent: Math.round(percent),
      });

      let sectionImageInstruction = '';
      if (imageAssignments[i] && imageAssignments[i].length > 0) {
        const ids = imageAssignments[i];
        sectionImageInstruction = `\n- Image Placement: You MUST place the image placeholder \`[IMAGE_${ids[0]}]\` on its own line (with empty lines before and after it) where it fits best relative to this section's content.\n`;
      }

      const sectionPrompt = `You are an expert article writer continuing to write an article.${customPromptExtra}${getPartInternalLinksPrompt(linksByPart[i.toString()])}

Article Title: "${title}"
Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}

You are writing section ${i + 1} of ${totalSections}.
Section Heading: "${section.heading}"
Section Description: "${section.description || ''}"

Previous sections covered:
${sections.slice(0, i).map((s, j) => `${j + 1}. ${s.heading}`).join('\n') || '(This is the first section)'}

Upcoming sections:
${sections.slice(i + 1).map((s, j) => `${i + j + 2}. ${s.heading}`).join('\n') || '(This is the last section)'}

Requirements:
- Write ~${targetWordCount} words of high-quality, detailed content for this section
- Naturally include the focus keyphrase "${keyphrase}" at least once
- Use subheadings (### level) if the section benefits from them
- Include specific examples, data, or actionable advice where appropriate
- Write in Markdown format
- Do NOT include the main section heading (## ${section.heading}) — I will add it myself
- Ensure smooth transitions and flow${sectionImageInstruction}`;

      const sectionResponse = await generateContent({
        model: modelName,
        prompt: sectionPrompt,
        apiKey,
        openaiApiKey
      });
      let sectionText = sectionResponse.text.trim();
      sectionText = sectionText.replace(/^(?:##\s*)+/gi, '').trim();
      const firstLine = sectionText.split('\n')[0];
      if (firstLine && firstLine.toLowerCase().includes(section.heading.toLowerCase())) {
        const remaining = sectionText.split('\n').slice(1).join('\n').trim();
        if (remaining) sectionText = remaining;
      }

      fullArticle += `## ${section.heading}\n\n${sectionText}\n\n`;

      sendSSE(res, 'section_done', {
        index: i,
        name: section.heading,
        wordCount: countWords(fullArticle),
        percent: Math.round(percent),
      });
    }

    // ── Step 4: Generate Conclusion ───────────────────────────────────
    sendSSE(res, 'progress', { step: 'conclusion', message: 'Writing conclusion...', percent: 90 });

    let conclusionImageInstruction = '';
    if (imageAssignments[numBodySections.toString()] && imageAssignments[numBodySections.toString()].length > 0) {
      const ids = imageAssignments[numBodySections.toString()];
      conclusionImageInstruction = `\n- Image Placement: You MUST place the image placeholder \`[IMAGE_${ids[0]}]\` on its own line (with empty lines before and after it) where it fits best relative to the conclusion text content.\n`;
    }

    const conclusionPrompt = `You are an expert article writer.${customPromptExtra}${getPartInternalLinksPrompt(linksByPart[numBodySections.toString()])}

Write a strong conclusion (~${targetWordCount} words) for the article titled "${title}".

Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}

The article covered these sections:
${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

Requirements:
- Summarize the key takeaways
- Reinforce the main message and answer the core question
- Include the focus keyphrase "${keyphrase}" naturally 1-2 times
- End with a compelling call-to-action or thought-provoking statement
- Write in Markdown format
- Do NOT include a heading — just the conclusion body text
- Aim for ~${targetWordCount} words${conclusionImageInstruction}`;

    const conclusionResponse = await generateContent({
      model: modelName,
      prompt: conclusionPrompt,
      apiKey,
      openaiApiKey
    });
    addUsage(conclusionResponse);

    fullArticle += `## Conclusion\n\n${conclusionResponse.text.trim()}\n`;

    // ── Step 5: Generate SEO Metadata ─────────────────────────────────
    sendSSE(res, 'progress', { step: 'seo', message: 'Generating SEO metadata...', percent: 95 });

    const seoPrompt = `You are an expert SEO specialist.
    
Based on the following article titled "${title}" with the focus keyphrase "${keyphrase}", generate the SEO metadata.

Target Audience: ${targetAudience || 'General audience'}
Brand: ${brand || 'None'}

ARTICLE CONTENT:
${fullArticle}

REQUIREMENTS:
1. Meta Title (50–60 chars, including Primary Keyword)
2. Focus Keyphrase: ${keyphrase || 'Primary Keyword'}
3. Meta Description (Max 140 chars: [Keyword] + [Value Prop] + [Click Trigger])
4. URL Slug (Max 60 chars, hyphens, includes keyword)
5. Page Role: ${pageRole || 'Cluster'}
6. Tags (Comma-separated)
7. Excerpt (Brief summary)

Format the output EXACTLY like this:
> **SEO Metadata:**
> - **Meta Title:** [Your Title]
> - **Focus Keyphrase:** ${keyphrase || '[Focus Keyphrase]'}
> - **Meta Description:** [Your Description]
> - **URL Slug:** [Your Slug]
> - **Page Role:** ${pageRole || 'Cluster'}
> - **Tags:** [Your Tags]
> - **Excerpt:** [Your Excerpt]`;

    const seoResponse = await generateContent({
      model: modelName,
      prompt: seoPrompt,
      apiKey,
      openaiApiKey
    });
    addUsage(seoResponse);

    let imageSeoMarkdown = '';
    if (imageSeoResults.length > 0) {
      imageSeoMarkdown = `\n### 🖼️ Image SEO Metadata\n\n`;
      imageSeoResults.forEach(img => {
        const headerName = img.isFeatured ? 'Featured Image' : `Image #${img.id}`;
        imageSeoMarkdown += `#### ${headerName} (Location: ${img.location || 'Not Specified'})\n`;
        imageSeoMarkdown += `| Element | Generated SEO Content |\n| :--- | :--- |\n`;
        imageSeoMarkdown += `| **File Name** | \`${img.fileName}\` |\n`;
        imageSeoMarkdown += `| **Alt Text** | ${img.altText} |\n`;
        imageSeoMarkdown += `| **Title** | ${img.title} |\n`;
        imageSeoMarkdown += `| **Caption** | ${img.caption} |\n`;
        imageSeoMarkdown += `| **Description** | ${img.description} |\n\n`;
      });
    }

    if (imageSeoMarkdown) {
      fullArticle = `${seoResponse.text.trim()}\n\n${imageSeoMarkdown}\n---\n\n${fullArticle}`;
    } else {
      fullArticle = `${seoResponse.text.trim()}\n\n---\n\n${fullArticle}`;
    }

    const finalWordCount = countWords(fullArticle);

    sendSSE(res, 'complete', {
      article: fullArticle,
      wordCount: finalWordCount,
      percent: 100,
      images: imageSeoResults,
      tokenUsage: {
        promptTokens,
        candidatesTokens,
        totalTokens
      }
    });
  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during generation.' });
  } finally {
    res.end();
  }
});

// ── Update Section Endpoint ───────────────────────────────────────
app.post('/api/update-section', async (req, res) => {
  const { apiKey, openaiApiKey, title, wpUrl, targetSubtitle, starterWritings, model, expertQuotations, customPrompt, targetAudience, brand } = req.body;

  if (!apiKey && !openaiApiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Load global admin settings
  const adminSettings = getAdminSettings();
  const targetLanguage = adminSettings.targetLanguage || 'English';
  const finalCustomPrompt = customPrompt || adminSettings.customPrompt || '';
  const finalTargetAudience = targetAudience || adminSettings.targetAudience || '';
  const finalBrand = brand || adminSettings.brand || '';
  const finalCtaLink = adminSettings.ctaLink || 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21';
  const wordCountMode = adminSettings.wordCountMode || 'total';
  const wordCountDivisor = adminSettings.wordCountDivisor || 10;
  const rawTarget = adminSettings.targetWordCount || 3000;
  const targetWordCount = wordCountMode === 'total'
    ? Math.max(50, Math.round(rawTarget / wordCountDivisor))
    : rawTarget;

  try {
    const modelName = model || 'gemini-3.5-flash';

    sendSSE(res, 'progress', { step: 'fetch', message: 'Fetching existing WordPress article...', percent: 10 });

    // Fetch existing article
    const wpResponse = await fetch(wpUrl);
    if (!wpResponse.ok) throw new Error('Failed to fetch WordPress article from URL.');
    const html = await wpResponse.text();
    const $ = cheerio.load(html);
    
    // Clean up html before extracting text
    $('script, style, nav, footer, header, aside, .sidebar, .widget, iframe').remove();
    const articleContext = $('body').text().replace(/\s+/g, ' ').trim();

    sendSSE(res, 'progress', { step: 'generate', message: 'Generating updated section...', percent: 40 });

    let customPromptExtra = finalCustomPrompt ? `\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n${finalCustomPrompt}\n----------------------------------------------\n` : '';
    customPromptExtra += `\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in ${targetLanguage}, regardless of the language used in the inputs or starter text.`;
    customPromptExtra += `\n\n--- INCLUSIVE & RESPECTFUL LANGUAGE RULE (STRICT) ---\nYou MUST strictly write using inclusive, respectful, empathetic, and non-discriminatory language throughout the article.\n- Gender Neutrality: Use gender-neutral terminology (e.g. 'travelers', 'photographers', 'guests', 'people', 'they/them/their') instead of gender-biased or exclusionary pronouns/phrases (e.g. 'he/him', 'guys').\n- Respect & Dignity: Avoid any non-inclusive, stereotypical, ableist, ageist, culturally insensitive, or exclusionary phrasing. Ensure all individuals, cultures, and backgrounds are treated with dignity and respect.\n------------------------------------------------------\n`;
    
    if (finalTargetAudience) customPromptExtra += `\nTarget Audience: ${finalTargetAudience}`;
    if (finalBrand) customPromptExtra += `\nBrand: ${finalBrand}`;
    if (finalCtaLink) {
      customPromptExtra += `\n\n--- CALL TO ACTION (CTA) LINK RULES ---\nWhen writing or updating Calls to Action (CTAs), always use the following destination URL for any conversion CTA links: "${finalCtaLink}". Format it as standard Markdown: [Anchor Text](${finalCtaLink}). Do NOT use dummy/hash links like "#" or placeholder URLs.\n---------------------------------------\n`;
    }
    
    if (expertQuotations && expertQuotations.length > 0) {
      customPromptExtra += `\n\n--- EXPERT QUOTATIONS TO INCLUDE ---\nThe user has provided the following expert quotations. Please weave them naturally into the section where appropriate. Format the expert's name as a clickable Markdown link if a URL is provided:\n`;
      expertQuotations.forEach(q => {
        const namePart = q.url ? `[${q.name || 'Expert'}](${q.url})` : (q.name || 'Expert');
        customPromptExtra += `- ${namePart}: "${q.quote}"\n`;
      });
      customPromptExtra += `------------------------------------\n`;
    }

    const updatePrompt = `You are an expert article writer and editor.${customPromptExtra}

I have an existing article titled "${title}". 

Here is the full existing article for context:
--- START ARTICLE CONTEXT ---
${articleContext.substring(0, 25000)}
--- END ARTICLE CONTEXT ---

I need you to write/rewrite a specific section with the following H2 heading: "${targetSubtitle}"

Here is the draft/starter content for this section provided by the user:
--- START DRAFT ---
${starterWritings || '(No starter writings provided. Please write this section from scratch based on the context.)'}
--- END DRAFT ---

Requirements:
- Improve, expand, and rewrite this section to flow perfectly with the rest of the article.
- Maintain the tone and style of the existing article, while strictly following any custom instructions provided.
- Write a comprehensive, high-quality section (aim for ~${targetWordCount} words).
- Format the output in Markdown.
- Ensure the section begins with the H2 heading: ## ${targetSubtitle}`;

    const updateResponse = await generateContent({
      model: modelName,
      prompt: updatePrompt,
      apiKey,
      openaiApiKey
    });

    const generatedText = updateResponse.text.trim();
    const finalWordCount = countWords(generatedText);
    const usage = updateResponse.usageMetadata || {};

    sendSSE(res, 'complete', {
      article: generatedText,
      wordCount: finalWordCount,
      percent: 100,
      tokenUsage: {
        promptTokens: usage.promptTokenCount || 0,
        candidatesTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0
      }
    });
  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during update generation.' });
  } finally {
    res.end();
  }
});

// ── Insert Internal Link Endpoint ──────────────────────────────────
app.post('/api/insert-link', async (req, res) => {
  const { apiKey, openaiApiKey, articleText, links, model } = req.body;

  if (!apiKey && !openaiApiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  if (!articleText) {
    return res.status(400).json({ error: 'Article text is required' });
  }
  if (!links || !Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: 'Links array is required and must not be empty' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const modelName = model || 'gemini-3.5-flash';

    sendSSE(res, 'progress', { step: 'analyze', message: 'Analyzing article structure...', percent: 20 });

    sendSSE(res, 'progress', { step: 'insert', message: `Weaving ${links.length} internal link(s) naturally into the article...`, percent: 50 });

    const insertPrompt = `You are an expert article editor.
I have an existing article. I need you to naturally insert/weave the following internal links into the body of this article.

Links to insert:
${links.map((link, idx) => `- Link #${idx + 1}: Title/Topic: "${link.title}" -> URL: "${link.url}" (Insert exactly ${link.count || 1} time(s) in separate paragraphs)`).join('\n')}

Instructions:
1. Find suitable paragraphs or sentences in the article body (NOT inside the title, H2 headings, SEO metadata block, or Image tables) where linking to these internal articles fits naturally.
2. Weave each link into a sentence using a natural anchor phrase. You do NOT have to use the exact title as the anchor text; use descriptive, contextually relevant keywords.
3. The link format MUST be standard Markdown: [Anchor Text](URL) (e.g. [Kyoto travel guide](URL)).
4. NEVER write the anchor text as the exact link/URL address.
5. Distribute these links across different relevant parts of the article. Do not bundle them all in one place.
6. Weave each link into the article exactly the number of times requested.
7. Do NOT make any other changes to the article text, titles, headings, structure, image tags, or metadata. Preserve everything else exactly.
8. Output the entire updated article.

ARTICLE CONTENT:
${articleText}`;

    const response = await generateContent({
      model: modelName,
      prompt: insertPrompt,
      apiKey,
      openaiApiKey
    });

    const generatedText = response.text.trim();
    const finalWordCount = countWords(generatedText);
    const usage = response.usageMetadata || {};

    sendSSE(res, 'complete', {
      article: generatedText,
      wordCount: finalWordCount,
      percent: 100,
      tokenUsage: {
        promptTokens: usage.promptTokenCount || 0,
        candidatesTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0
      }
    });
  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during link insertion.' });
  } finally {
    res.end();
  }
});

// ── Generate Image SEO Metadata Endpoint ──────────────────────────
app.post('/api/generate-image-meta', async (req, res) => {
  const { apiKey, openaiApiKey, imageBase64, imageUrl, model, location, scene } = req.body;

  if (!apiKey && !openaiApiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  if (!imageBase64 && !imageUrl) {
    return res.status(400).json({ error: 'Image is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Load global admin settings
  const adminSettings = getAdminSettings();
  const customPrompt = adminSettings.customPrompt || '';
  const targetLanguage = adminSettings.targetLanguage || 'English';

  try {
    const modelName = model || 'gemini-3.5-flash';

    sendSSE(res, 'progress', { step: 'analyze', message: 'Analyzing image and inputs...', percent: 20 });

    // Parse image data
    let mimeType = 'image/jpeg';
    let data;

    if (imageUrl) {
      const filePath = path.join(SETTINGS_DIR, 'uploads', path.basename(imageUrl));
      const ext = path.extname(filePath).replace('.', '').toLowerCase();
      mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      data = fs.readFileSync(filePath).toString('base64');
    } else {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
      data = imageBase64;
      if (match) {
        mimeType = match[1];
        data = match[2];
      }
    }

    sendSSE(res, 'progress', { step: 'generate', message: 'Generating SEO elements with Gemini...', percent: 50 });

    const promptText = `You are an expert SEO specialist, professional photographer, and travel blogger.
Generate SEO-optimized image metadata (Alt Text, Title, Caption, Description, and File Name) for this image.

Inputs:
- Location: ${location || 'Not specified'}
- Scene description: ${scene || 'Not specified'}
- Prompt Strategy / Custom Instructions: ${customPrompt || 'None'}

Requirements:
1. **Alt Text**: Descriptive, search-engine friendly (under 125 characters), focuses on key subjects.
2. **Title**: Short, descriptive, SEO-friendly title for the media file (under 60 characters).
3. **Caption**: Reader-facing caption that provides context or tells a story (1-2 sentences).
4. **Description**: Detailed description/excerpt for media attachment page (2-4 sentences, SEO-optimized with synonyms).
5. **Language**: The entire output (alt text, title, caption, description, and file name) MUST be written entirely in ${targetLanguage}, regardless of the input language used for location or scene description.
6. **File Name**: An SEO-optimized file name for the image in lowercase, using hyphens instead of spaces, and ending with .jpg (e.g., sunset-over-paris-eiffel-tower.jpg).

Format the output EXACTLY as a JSON object with keys "altText", "title", "caption", "description", and "fileName". Do not include markdown fences, JSON tags, or extra commentary.
Example:
{
  "altText": "A close up photo of...",
  "title": "Sunset over Paris",
  "caption": "A stunning sunset...",
  "description": "Captured from the Eiffel Tower...",
  "fileName": "sunset-over-paris-eiffel-tower.jpg"
}`;

    const response = await generateContent({
      model: modelName,
      prompt: promptText,
      apiKey,
      openaiApiKey,
      image: {
        data: data,
        mimeType: mimeType
      }
    });

    let rawText = response.text.trim();
    
    // Clean markdown code blocks if the model wrapped JSON
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsedMeta;
    try {
      parsedMeta = JSON.parse(rawText);
      if (!parsedMeta.fileName) {
        parsedMeta.fileName = (parsedMeta.title || 'image-seo')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') + '.jpg';
      }
    } catch (e) {
      // Fallback parser if JSON parsing fails
      console.warn("JSON parsing failed, trying fallback regex", e);
      const altMatch = rawText.match(/"altText":\s*"([^"]+)"/);
      const titleMatch = rawText.match(/"title":\s*"([^"]+)"/);
      const capMatch = rawText.match(/"caption":\s*"([^"]+)"/);
      const descMatch = rawText.match(/"description":\s*"([^"]+)"/);
      const fileMatch = rawText.match(/"fileName":\s*"([^"]+)"/);

      parsedMeta = {
        altText: altMatch ? altMatch[1] : 'Image Alt Text',
        title: titleMatch ? titleMatch[1] : 'Image Title',
        caption: capMatch ? capMatch[1] : 'Image Caption',
        description: descMatch ? descMatch[1] : 'Image Description',
        fileName: fileMatch ? fileMatch[1] : 'image-seo.jpg'
      };
    }

    sendSSE(res, 'progress', { step: 'format', message: 'Formatting metadata report...', percent: 85 });

    // Format metadata as beautiful Markdown
    const markdownOutput = `# 🖼️ Image SEO Metadata

| Metadata Element | Generated SEO Content |
| :--- | :--- |
| **File Name** | \`${parsedMeta.fileName}\` |
| **Alt Text** | ${parsedMeta.altText} |
| **Title** | ${parsedMeta.title} |
| **Caption** | ${parsedMeta.caption} |
| **Description** | ${parsedMeta.description} |

---

### 📋 Copyable Elements

* **File Name**
  > \`${parsedMeta.fileName}\`

* **Alt Text**
  > \`${parsedMeta.altText}\`

* **Title**
  > \`${parsedMeta.title}\`

* **Caption**
  > \`${parsedMeta.caption}\`

* **Description**
  > \`${parsedMeta.description}\``;

    const usage = response.usageMetadata || {};

    sendSSE(res, 'complete', {
      article: markdownOutput,
      wordCount: countWords(markdownOutput),
      percent: 100,
      imageMeta: parsedMeta,
      tokenUsage: {
        promptTokens: usage.promptTokenCount || 0,
        candidatesTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0
      }
    });

  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during image SEO generation.' });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Article Generator API running at http://0.0.0.0:${PORT}`);
});
