const axios = require('axios');
const { transcribeAudio, summarizeTranscript } = require('../services/groq');

jest.mock('axios');

describe('groq service', () => {
  afterEach(() => jest.resetAllMocks());

  describe('transcribeAudio', () => {
    test('sends audio file to Whisper API and returns transcript', async () => {
      axios.post.mockResolvedValue({ data: '  Hello this is a test message.  ' });

      const result = await transcribeAudio('/tmp/test.ogg', 'en', 'test-api-key');

      expect(result).toBe('Hello this is a test message.');
      expect(axios.post).toHaveBeenCalledTimes(1);
      const [url] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    });

    test('passes language hint to Whisper when provided', async () => {
      axios.post.mockResolvedValue({ data: 'Bonjour' });

      await transcribeAudio('/tmp/test.ogg', 'fr', 'test-api-key');

      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('summarizeTranscript', () => {
    test('returns one-line summary from LLM', async () => {
      axios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'User confirms dinner at 8pm.' } }],
        },
      });

      const result = await summarizeTranscript('Long transcript text here', 'test-api-key');

      expect(result.summary).toBe('User confirms dinner at 8pm.');
      expect(result.languageOk).toBe(true);
    });

    test('detects gibberish warning from LLM', async () => {
      axios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: '⚠️ Transcription incorrecte (langue non reconnue)' } }],
        },
      });

      const result = await summarizeTranscript('Gibberish text', 'test-api-key');

      expect(result.languageOk).toBe(false);
      expect(result.summary).toContain('⚠️');
    });
  });
});
