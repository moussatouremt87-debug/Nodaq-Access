/**
 * Scaleway Speech-to-Text — transcribe audio to text
 * API: https://api.scaleway.ai/v1/audio/transcriptions (OpenAI-compatible)
 */

const SCALEWAY_STT_URL = "https://api.scaleway.ai/v1/audio/transcriptions";
const STT_MODEL = "openai/whisper-large-v3-turbo";

export interface TranscribeResult {
  text: string;
}

/**
 * Transcribe an audio buffer to text using Scaleway's Whisper endpoint.
 * @param audioBuffer  Raw audio bytes (webm/opus, mp4/aac, wav, etc.)
 * @param mimeType     MIME type of the audio (e.g. "audio/webm;codecs=opus")
 * @param filename     Suggested filename (extension matters for Whisper)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  filename = "audio.webm",
): Promise<TranscribeResult> {
  const apiKey = process.env.SCALEWAY_API_KEY;
  if (!apiKey) throw new Error("SCALEWAY_API_KEY is not set");

  const formData = new FormData();
  // Blob constructor accepts BufferSource; convert Buffer → Uint8Array for TypeScript
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    filename,
  );
  formData.append("model", STT_MODEL);
  formData.append("language", "fr");
  formData.append("response_format", "json");

  const res = await fetch(SCALEWAY_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Scaleway STT error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  if (!text) throw new Error("STT returned empty transcription");
  return { text };
}
