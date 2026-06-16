import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve built frontend files in production
app.use(express.static('dist'));

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function sendSSE(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

app.post('/api/generate', async (req, res) => {
  const { apiKey, title, topic, keyphrase, starterArticle, model, tone, styleInstructions, customPrompt, targetAudience, brand, expertQuotations } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-2.5-flash';

    const toneInstruction = tone ? `Write in a ${tone.toLowerCase()} tone and style.` : 'Write in a professional tone.';
    const styleExtra = styleInstructions ? `\nAdditional style instructions from the user: ${styleInstructions}` : '';
    let customPromptExtra = customPrompt ? `\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n${customPrompt}\n----------------------------------------------\n` : '';
    customPromptExtra += `\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in English, regardless of the language used in the inputs or starter text.`;
    
    if (targetAudience) customPromptExtra += `\nTarget Audience: ${targetAudience}`;
    if (brand) customPromptExtra += `\nBrand: ${brand}`;
    
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

    // ── Step 1: Generate Outline ──────────────────────────────────────
    sendSSE(res, 'progress', { step: 'outline', message: 'Generating article outline...', percent: 5 });

    const outlinePrompt = `You are an expert long-form content strategist and SEO writer.${customPromptExtra}

Create a detailed article outline for:
- Title: "${title}"
- Topic / Core Question: "${topic}"
- Focus Keyphrase: "${keyphrase}"
${toneInstruction}${styleExtra}${starterContext}

Generate exactly 8 section headings that comprehensively cover this topic. The sections should flow logically, each building on the previous one.

IMPORTANT: Return ONLY a valid JSON array of objects with "heading" and "description" fields. No markdown fences, no extra text.
Example: [{"heading":"What is X?","description":"Overview of X and why it matters"}]`;

    const outlineResponse = await ai.models.generateContent({
      model: modelName,
      contents: outlinePrompt,
      config: { temperature: 0.7 },
    });

    let outlineText = outlineResponse.text.trim();
    if (outlineText.startsWith('```')) {
      outlineText = outlineText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let sections;
    try {
      sections = JSON.parse(outlineText);
    } catch {
      const match = outlineText.match(/\[[\s\S]*\]/);
      if (match) sections = JSON.parse(match[0]);
      else throw new Error('Failed to parse outline. Please try again.');
    }

    sendSSE(res, 'outline', { sections: sections.map(s => s.heading), percent: 10 });

    // ── Step 2: Generate Introduction ─────────────────────────────────
    sendSSE(res, 'progress', { step: 'introduction', message: 'Writing introduction...', percent: 12 });

    const introPrompt = `You are an expert article writer.${customPromptExtra}

Write a compelling introduction (300-400 words) for an article titled "${title}".

Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}${styleExtra}${starterContext}

The article will cover these sections:
${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

Requirements:
- Hook the reader immediately with a surprising fact, question, or bold statement
- Introduce the topic and explain why it matters
- Naturally include the focus keyphrase "${keyphrase}" 1-2 times
- Preview what the reader will learn
- Write in Markdown format (no heading needed, just body text)
- Aim for 300-400 words minimum
- Do NOT include a heading — just the introduction body text`;

    const introResponse = await ai.models.generateContent({
      model: modelName,
      contents: introPrompt,
      config: { temperature: 0.7 },
    });

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

      const sectionPrompt = `You are an expert article writer continuing to write an article.${customPromptExtra}

Article Title: "${title}"
Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}${styleExtra}

You are writing section ${i + 1} of ${totalSections}.
Section Heading: "${section.heading}"
Section Description: "${section.description}"

Previous sections covered:
${sections.slice(0, i).map((s, j) => `${j + 1}. ${s.heading}`).join('\n') || '(This is the first section)'}

Upcoming sections:
${sections.slice(i + 1).map((s, j) => `${i + j + 2}. ${s.heading}`).join('\n') || '(This is the last section)'}

Requirements:
- Write 300-400 words of high-quality, detailed content for this section
- Naturally include the focus keyphrase "${keyphrase}" at least once
- Use subheadings (### level) if the section benefits from them
- Include specific examples, data, or actionable advice where appropriate
- Write in Markdown format
- Do NOT include the main section heading (## ${section.heading}) — I will add it myself
- Ensure smooth transitions and flow`;

      const sectionResponse = await ai.models.generateContent({
        model: modelName,
        contents: sectionPrompt,
        config: { temperature: 0.7 },
      });

      fullArticle += `## ${section.heading}\n\n${sectionResponse.text.trim()}\n\n`;

      sendSSE(res, 'section_done', {
        index: i,
        name: section.heading,
        wordCount: countWords(fullArticle),
        percent: Math.round(percent),
      });
    }

    // ── Step 4: Generate Conclusion ───────────────────────────────────
    sendSSE(res, 'progress', { step: 'conclusion', message: 'Writing conclusion...', percent: 90 });

    const conclusionPrompt = `You are an expert article writer.${customPromptExtra}

Write a strong conclusion (250-350 words) for the article titled "${title}".

Topic / Core Question: "${topic}"
Focus Keyphrase: "${keyphrase}"
${toneInstruction}${styleExtra}

The article covered these sections:
${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

Requirements:
- Summarize the key takeaways
- Reinforce the main message and answer the core question
- Include the focus keyphrase "${keyphrase}" naturally 1-2 times
- End with a compelling call-to-action or thought-provoking statement
- Write in Markdown format
- Do NOT include a heading — just the conclusion body text
- Aim for 250-350 words`;

    const conclusionResponse = await ai.models.generateContent({
      model: modelName,
      contents: conclusionPrompt,
      config: { temperature: 0.7 },
    });

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
2. Meta Description (Max 140 chars: [Keyword] + [Value Prop] + [Click Trigger])
3. URL Slug (Max 60 chars, hyphens, includes keyword)
4. Tags (Comma-separated)
5. Excerpt (Brief summary)

Format the output EXACTLY like this:
> **SEO Metadata:**
> - **Meta Title:** [Your Title]
> - **Meta Description:** [Your Description]
> - **URL Slug:** [Your Slug]
> - **Tags:** [Your Tags]
> - **Excerpt:** [Your Excerpt]`;

    const seoResponse = await ai.models.generateContent({
      model: modelName,
      contents: seoPrompt,
      config: { temperature: 0.7 },
    });

    fullArticle = `${seoResponse.text.trim()}\n\n---\n\n${fullArticle}`;

    const finalWordCount = countWords(fullArticle);

    sendSSE(res, 'complete', {
      article: fullArticle,
      wordCount: finalWordCount,
      percent: 100,
    });
  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during generation.' });
  } finally {
    res.end();
  }
});

// ── Update Section Endpoint ───────────────────────────────────────
app.post('/api/update-section', async (req, res) => {
  const { apiKey, title, wpUrl, targetSubtitle, starterWritings, customPrompt, model, targetAudience, brand, expertQuotations } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-2.5-flash';

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

    let customPromptExtra = customPrompt ? `\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n${customPrompt}\n----------------------------------------------\n` : '';
    customPromptExtra += `\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in English, regardless of the language used in the inputs or starter text.`;
    
    if (targetAudience) customPromptExtra += `\nTarget Audience: ${targetAudience}`;
    if (brand) customPromptExtra += `\nBrand: ${brand}`;
    
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
- Write a comprehensive, high-quality section (aim for 300-400 words).
- Format the output in Markdown.
- Ensure the section begins with the H2 heading: ## ${targetSubtitle}`;

    const updateResponse = await ai.models.generateContent({
      model: modelName,
      contents: updatePrompt,
      config: { temperature: 0.7 },
    });

    const generatedText = updateResponse.text.trim();
    const finalWordCount = countWords(generatedText);

    sendSSE(res, 'complete', {
      article: generatedText,
      wordCount: finalWordCount,
      percent: 100,
    });
  } catch (error) {
    sendSSE(res, 'error', { message: error.message || 'An unexpected error occurred during update generation.' });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Article Generator API running at http://0.0.0.0:${PORT}`);
});
