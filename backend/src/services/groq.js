const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'llama-3.3-70b-versatile';

const LANGUAGE_PROMPTS = {
  en: 'Transcription of a voice message in English.',
  fr: "Transcription d'un message vocal en français.",
  es: 'Transcripción de un mensaje de voz en español.',
};

async function transcribeAudio(audioPath, language, apiKey) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), { filename: 'audio.ogg' });
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'text');

  if (language) {
    form.append('language', language);
  }

  const prompt = LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS.en;
  form.append('prompt', prompt);

  const res = await axios.post(WHISPER_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
  });

  return res.data.trim();
}

async function summarizeTranscript(transcript, apiKey) {
  const res = await axios.post(
    CHAT_URL,
    {
      model: LLM_MODEL,
      messages: [
        {
          role: 'system',
          content: `You process WhatsApp voice message transcripts.
If the transcript looks like a wrong language (Welsh, Icelandic, gibberish, etc.), say: "⚠️ Transcription incorrecte (langue non reconnue)".
Otherwise, summarize in exactly one concise line in the same language as the transcript.`,
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 120,
      temperature: 0.3,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const summary = res.data.choices[0].message.content.trim();
  const languageOk = !summary.includes('⚠️');

  return { summary, languageOk };
}

module.exports = { transcribeAudio, summarizeTranscript };
